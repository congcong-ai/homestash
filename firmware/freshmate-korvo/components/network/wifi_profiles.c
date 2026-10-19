#include "wifi_profiles.h"
#include "hs_display.h"
#include "esp_timer.h"
#include "local-network-config.h"
#include "esp_eap_client.h"
#include "esp_wifi.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "nvs.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>

static EventGroupHandle_t events;
#define CONNECTED 1
#define DISCONNECTED 2
#define COMMAND 4
static const char *tag = "HomeStash网络";
static const char *ssids[] = {CONFIG_HS_WIFI_SSID, CONFIG_HS_WIFI_OFFICE_SSID};
static const char *passwords[] = {CONFIG_HS_WIFI_PASSWORD, CONFIG_HS_WIFI_OFFICE_PASSWORD};
static portMUX_TYPE guard = portMUX_INITIALIZER_UNLOCKED;
static hs_wifi_status_t status = {.automatic = true};
static QueueHandle_t commands;
typedef struct { int kind; hs_wifi_ap_t ap; char password[65]; } request_t;
static char saved_ssid[33], saved_password[65];
static int64_t blocked_until[3];
static void message(const char *text) {
  ESP_LOGI(tag,"%s",text);
  portENTER_CRITICAL(&guard);
  snprintf(status.message, sizeof(status.message), "%s", text);
  portEXIT_CRITICAL(&guard);
}
void hs_wifi_status(hs_wifi_status_t *out) {
  portENTER_CRITICAL(&guard); *out = status; portEXIT_CRITICAL(&guard);
}
void hs_wifi_profiles_connected(void) {
  if (events) xEventGroupSetBits(events, CONNECTED);
}
void hs_wifi_profiles_disconnected(void) {
  if (events) xEventGroupSetBits(events, DISCONNECTED);
}
static esp_err_t submit(request_t *request) {
  if (!commands) return ESP_ERR_INVALID_STATE;
  if (xQueueSend(commands, request, 0) != pdTRUE) return ESP_ERR_TIMEOUT;
  xEventGroupSetBits(events, COMMAND);
  return ESP_OK;
}
esp_err_t hs_wifi_scan(void) { request_t r = {.kind=1}; return submit(&r); }
esp_err_t hs_wifi_automatic(void) { request_t r = {.kind=3}; return submit(&r); }
esp_err_t hs_wifi_connect(const hs_wifi_ap_t *ap, const char *password) {
  if (!ap || !ap->ssid[0] || strlen(ap->ssid)>32 || !password || strlen(password)>64)
    return ESP_ERR_INVALID_ARG;
  request_t r = {.kind=2, .ap=*ap};
  strlcpy(r.password, password, sizeof(r.password));
  return submit(&r);
}

static bool enterprise(int profile) {
#ifdef CONFIG_HS_WIFI_OFFICE_ENTERPRISE
  return profile == 1;
#else
  return false;
#endif
}
static bool verify_ca(void) {
#ifdef CONFIG_HS_WIFI_OFFICE_VERIFY_CA
  return true;
#else
  return false;
#endif
}

static int scan_networks(void) {
  portENTER_CRITICAL(&guard); status.scanning=true; portEXIT_CRITICAL(&guard);
  wifi_scan_config_t scan = {.show_hidden = true};
  wifi_ap_record_t *aps = calloc(64, sizeof(*aps));
  uint16_t count=64;
  esp_err_t err = aps ? esp_wifi_scan_start(&scan, true) : ESP_ERR_NO_MEM;
  if (err==ESP_OK) err=esp_wifi_scan_get_ap_records(&count,aps);
  if (err!=ESP_OK) {
    esp_wifi_clear_ap_list(); free(aps);
    portENTER_CRITICAL(&guard);status.scanning=false;portEXIT_CRITICAL(&guard);
    message("扫描失败，请稍后点击重新扫描"); return -1;
  }
  hs_wifi_ap_t visible[HS_WIFI_SCAN_LIMIT]={0};
  unsigned shown=0;
  int selected=-1, strongest=-128;
  for (unsigned i=0;i<count;i++) {
    if (!aps[i].ssid[0]) continue;
    bool eap=aps[i].authmode==WIFI_AUTH_WPA2_ENTERPRISE;
    bool configured=eap && enterprise(1) && !strcmp((char *)aps[i].ssid,ssids[1]);
    bool duplicate=false;
    for (unsigned j=0;j<shown;j++) if (!strcmp(visible[j].ssid,(char *)aps[i].ssid)) duplicate=true;
    if (!duplicate && shown<HS_WIFI_SCAN_LIMIT) {
      hs_wifi_ap_t *ap=&visible[shown++];
      strlcpy(ap->ssid,(char *)aps[i].ssid,sizeof(ap->ssid));
      ap->rssi=aps[i].rssi;ap->open=aps[i].authmode==WIFI_AUTH_OPEN;
      ap->enterprise=eap;ap->configured=configured;
    }
    for (int p=0;p<3;p++) {
      const char *ssid=p==2?saved_ssid:ssids[p];
      if (p<2 && CONFIG_HS_NETWORK_MODE && p!=CONFIG_HS_NETWORK_MODE-1) continue;
      if (!ssid[0] || strcmp((char *)aps[i].ssid,ssid)) continue;
      bool is_enterprise=p<2 && enterprise(p);
      if (is_enterprise && verify_ca() && sizeof(office_ca)<=1) continue;
      if (is_enterprise!=eap || esp_timer_get_time()<blocked_until[p]) continue;
      int score=aps[i].rssi+(p==2?256:0);
      if (score>strongest) {selected=p;strongest=score;}
    }
  }
  free(aps);
  portENTER_CRITICAL(&guard);
  memcpy(status.aps,visible,sizeof(visible));status.count=shown;
  status.revision++;status.scanning=false;
  portEXIT_CRITICAL(&guard);
  return selected;
}

static esp_err_t configure_profile(int profile) {
  esp_wifi_sta_enterprise_disable();
  esp_eap_client_clear_identity();
  esp_eap_client_clear_username();
  esp_eap_client_clear_password();
  esp_eap_client_clear_ca_cert();
  wifi_config_t config = {0};
  memcpy(config.sta.ssid, ssids[profile], strlen(ssids[profile]));
  if (enterprise(profile)) {
    if (verify_ca() && sizeof(office_ca) <= 1) return ESP_ERR_INVALID_STATE;
    config.sta.threshold.authmode = WIFI_AUTH_WPA2_ENTERPRISE;
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &config));
    ESP_ERROR_CHECK(esp_eap_client_set_identity((const unsigned char *)CONFIG_HS_WIFI_OFFICE_IDENTITY, strlen(CONFIG_HS_WIFI_OFFICE_IDENTITY)));
    ESP_ERROR_CHECK(esp_eap_client_set_username((const unsigned char *)CONFIG_HS_WIFI_OFFICE_USERNAME, strlen(CONFIG_HS_WIFI_OFFICE_USERNAME)));
    ESP_ERROR_CHECK(esp_eap_client_set_password((const unsigned char *)passwords[profile], strlen(passwords[profile])));
    if (verify_ca()) {
      ESP_ERROR_CHECK(esp_eap_client_set_ca_cert(office_ca, sizeof(office_ca)));
      ESP_ERROR_CHECK(esp_eap_client_set_domain_name(CONFIG_HS_WIFI_OFFICE_DOMAIN));
      ESP_ERROR_CHECK(esp_eap_client_set_disable_time_check(false));
    }
    ESP_ERROR_CHECK(esp_eap_client_set_eap_methods(ESP_EAP_TYPE_PEAP | ESP_EAP_TYPE_TTLS));
    ESP_ERROR_CHECK(esp_eap_client_set_ttls_phase2_method(ESP_EAP_TTLS_PHASE2_MSCHAPV2));
    ESP_ERROR_CHECK(esp_wifi_sta_enterprise_enable());
    return ESP_OK;
  } else {
    strlcpy((char *)config.sta.password, passwords[profile], sizeof(config.sta.password));
    config.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;
  }
  return esp_wifi_set_config(WIFI_IF_STA, &config);
}

static esp_err_t configure_manual(const char *ssid, const char *password, bool open) {
  esp_wifi_sta_enterprise_disable();
  esp_eap_client_clear_identity();esp_eap_client_clear_username();
  esp_eap_client_clear_password();esp_eap_client_clear_ca_cert();
  wifi_config_t config={0};
  memcpy(config.sta.ssid,ssid,strlen(ssid));
  memcpy(config.sta.password,password,strlen(password));
  config.sta.threshold.authmode=open?WIFI_AUTH_OPEN:WIFI_AUTH_WPA2_PSK;
  return esp_wifi_set_config(WIFI_IF_STA,&config);
}
static void load_saved(void) {
  nvs_handle_t nvs;
  if (nvs_open("hs_wifi",NVS_READONLY,&nvs)!=ESP_OK) return;
  size_t a=sizeof(saved_ssid),b=sizeof(saved_password);
  if (nvs_get_str(nvs,"ssid",saved_ssid,&a)!=ESP_OK ||
      nvs_get_str(nvs,"password",saved_password,&b)!=ESP_OK) {
    saved_ssid[0]=0;saved_password[0]=0;
  }
  nvs_close(nvs);
}
static bool save_network(const request_t *r) {
  nvs_handle_t nvs;
  if (nvs_open("hs_wifi",NVS_READWRITE,&nvs)!=ESP_OK) return false;
  esp_err_t err=nvs_set_str(nvs,"ssid",r->ap.ssid);
  if (err==ESP_OK) err=nvs_set_str(nvs,"password",r->password);
  if (err==ESP_OK) err=nvs_commit(nvs);
  nvs_close(nvs);
  if (err!=ESP_OK) return false;
  strlcpy(saved_ssid,r->ap.ssid,sizeof(saved_ssid));
  strlcpy(saved_password,r->password,sizeof(saved_password));
  blocked_until[2]=0;
  return true;
}
static void manager(void *arg) {
  (void)arg;
  load_saved();
  bool automatic=true, connecting=false, online=false, persist=false;
  int profile=-1;
  int64_t next_scan=0, deadline=0;
  request_t target={0};
  for (;;) {
    EventBits_t bits=xEventGroupWaitBits(events,7,pdTRUE,pdFALSE,pdMS_TO_TICKS(200));
    if (bits & DISCONNECTED) {
      connecting=false;online=false;
      if (profile>=0) blocked_until[profile]=esp_timer_get_time()+30000000;
      hs_display_network(target.ap.ssid,false);
      message("未连接：连接失败或已断开，可手动选择 WiFi");
      next_scan=esp_timer_get_time()+5000000;
    }
    if ((bits & CONNECTED) && !(bits & DISCONNECTED)) {
      connecting=false;online=true;
      hs_display_network(target.ap.ssid,true);
      bool stored=!persist || save_network(&target);
      persist=false;
      message(stored?"已连接，可手动选择其他 WiFi":"已连接，但保存失败，重启后需重新选择");
      memset(target.password,0,sizeof(target.password));
    }
    request_t r={0};
    bool connect_now=false;
    if (xQueueReceive(commands,&r,0)==pdTRUE) {
      if (r.kind==1) {
        if (connecting) message("正在连接，请稍后重新扫描");
        else scan_networks();
      } else if (r.kind==3) {
        automatic=true;
        // 恢复自动模式时保留当前连接；断开后再重新选择。
        next_scan=0;
        message(online?"已启用自动选择，当前网络保持连接":"正在自动选择已配置网络");
      } else if (r.kind==2) {
        if (r.ap.enterprise && !r.ap.configured) {
          message("该企业网络需要账号和证书，请先在固件中配置");
        } else {
          automatic=false; target=r;
          profile=r.ap.enterprise?1:-1;
          persist=!r.ap.enterprise;connect_now=true;
        }
      }
    }
    if (connecting && esp_timer_get_time()>deadline) {
      esp_wifi_disconnect();connecting=false;online=false;
      if (profile>=0) blocked_until[profile]=esp_timer_get_time()+30000000;
      message("未连接：连接超时，请检查密码或选择其他 WiFi");
      hs_display_network(target.ap.ssid,false);next_scan=esp_timer_get_time()+5000000;
    }
    if (!connect_now && automatic && !connecting && !online && esp_timer_get_time()>=next_scan) {
      profile=scan_networks();next_scan=esp_timer_get_time()+10000000;
      if (profile<0) {
        message("未连接：未发现可用的默认 WiFi，请手动选择");
        hs_display_network("",false);
      } else {
        memset(&target,0,sizeof(target));
        strlcpy(target.ap.ssid,profile==2?saved_ssid:ssids[profile],sizeof(target.ap.ssid));
        if (profile==2) strlcpy(target.password,saved_password,sizeof(target.password));
        target.ap.open=profile==2 && !saved_password[0];
        persist=false;connect_now=true;
      }
    }
    if (connect_now) {
      connecting=false;online=false;
      esp_wifi_stop();
      esp_err_t err=profile>=0 && profile<2?configure_profile(profile):
        configure_manual(target.ap.ssid,target.password,target.ap.open);
      esp_err_t started=esp_wifi_start();
      xEventGroupClearBits(events,CONNECTED|DISCONNECTED);
      esp_wifi_set_ps(WIFI_PS_NONE);
      if (err==ESP_OK && started==ESP_OK) err=esp_wifi_connect();
      else if (started!=ESP_OK) err=started;
      connecting=err==ESP_OK;
      deadline=esp_timer_get_time()+30000000;
      next_scan=esp_timer_get_time()+10000000;
      hs_display_network(target.ap.ssid,false);
      message(connecting?"正在连接，最长等待 30 秒":"未连接：无法启动连接，请重新选择");
    }
    memset(&r,0,sizeof(r));
    portENTER_CRITICAL(&guard);
    status.automatic=automatic;status.connecting=connecting;status.connected=online;
    strlcpy(status.ssid,target.ap.ssid,sizeof(status.ssid));
    portEXIT_CRITICAL(&guard);
  }
}

void hs_wifi_profiles_start(void) {
  if (CONFIG_HS_BUILD_EPOCH > 0) {
    struct timeval now = {.tv_sec = CONFIG_HS_BUILD_EPOCH};
    settimeofday(&now, NULL);
  }
  events=xEventGroupCreate();commands=xQueueCreate(4,sizeof(request_t));
  if (!events || !commands) ESP_ERROR_CHECK(ESP_ERR_NO_MEM);
  ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM));
  ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
  ESP_ERROR_CHECK(esp_wifi_start());
  ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));
  if (xTaskCreate(manager, "hs_wifi", 8192, NULL, 5, NULL) != pdPASS)
    ESP_ERROR_CHECK(ESP_ERR_NO_MEM);
}
