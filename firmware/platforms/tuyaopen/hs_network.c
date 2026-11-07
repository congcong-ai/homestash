#include "hs_network.h"
#include "hs_build_config.h"
#include "hs_display.h"
#include "hs_runtime.h"
#include "tal_kv.h"
#include "tal_mutex.h"
#include "tal_wifi.h"
#include "wifi_profiles.h"
#include <stdio.h>
#include <string.h>
typedef struct {
  int kind;
  bool remember;
  hs_wifi_ap_t ap;
  char password[65];
} request_t;
typedef struct {
  char ssid[33], password[65];
} saved_t;
static MUTEX_HANDLE lock;
static hs_queue_t requests;
static hs_wifi_status_t state;
static saved_t saved;
static bool paused;
void hs_t5_discover_core(void);
static void changed(const char *message) {
  snprintf(state.message, sizeof(state.message), "%s", message);
  state.revision++;
}
static void event(WF_EVENT_E e, void *arg) {
  (void)arg;
  tal_mutex_lock(lock);
  state.connected = e == WFE_CONNECTED;
  state.connecting = false;
  changed(state.connected ? "网络已连接" : "网络未连接");
  tal_mutex_unlock(lock);
}
void hs_wifi_status(hs_wifi_status_t *out) {
  tal_mutex_lock(lock);
  *out = state;
  tal_mutex_unlock(lock);
}
static hs_err_t submit(request_t *r) {
  return hs_queue_send(requests, r, 0) ? HS_OK : HS_ERR_INVALID_STATE;
}
hs_err_t hs_wifi_connect_remember(const hs_wifi_ap_t *ap, const char *password,
                                  bool remember) {
  if (!ap || !password || !memchr(ap->ssid, 0, sizeof(ap->ssid)) ||
      !ap->ssid[0] || strlen(password) > 64 || ap->enterprise ||
      (!ap->open && strlen(password) < 8))
    return HS_ERR_INVALID_ARG;
  request_t r = {.kind = 1, .remember = remember, .ap = *ap};
  snprintf(r.password, sizeof(r.password), "%s", password);
  hs_err_t e = submit(&r);
  memset(&r, 0, sizeof(r));
  return e;
}
hs_err_t hs_wifi_connect(const hs_wifi_ap_t *ap, const char *p) {
  return hs_wifi_connect_remember(ap, p, true);
}
hs_err_t hs_wifi_scan(void) {
  request_t r = {.kind = 2};
  return submit(&r);
}
hs_err_t hs_wifi_disconnect(void) {
  request_t r = {.kind = 3};
  return submit(&r);
}
hs_err_t hs_wifi_cancel_connection(void) { return hs_wifi_disconnect(); }
hs_err_t hs_wifi_reconnect(void) {
  request_t r = {.kind = 4};
  return submit(&r);
}
hs_err_t hs_wifi_automatic(void) { return hs_wifi_reconnect(); }
hs_err_t hs_wifi_pause(bool pause) {
  (void)pause;
  return HS_ERR_NOT_SUPPORTED;
}
void hs_wifi_profiles_start(void) {}
void hs_wifi_profiles_connected(void) {}
void hs_wifi_profiles_disconnected(void) {}
static void worker(void *arg) {
  (void)arg;
  request_t r;
  int64_t retry = 0;
  int64_t last_discovery=0;
  unsigned ip_revision = (unsigned)-1;
  for (;;) {
    if (!hs_queue_receive(requests, &r, 1000)) {
      hs_wifi_status_t s;
      hs_wifi_status(&s);
      hs_display_network(s.ssid, s.connected);
      if(s.connected&&(s.connection_revision!=ip_revision||hs_time_us()-last_discovery>10000000)){
        hs_t5_discover_core();last_discovery=hs_time_us();
      }
      if(s.connected&&s.connection_revision!=ip_revision){
        NW_IP_S ip={0};if(tal_wifi_get_ip(WF_STATION,&ip)==OPRT_OK){
          HS_LOGI("network","station ip=%s gateway=%s mask=%s",ip.ip,ip.gw,ip.mask);ip_revision=s.connection_revision;
        }
      }
      if (!paused && !s.connected && !s.connecting && hs_time_us() >= retry &&
          saved.ssid[0]) {
        r = (request_t){.kind = 4};
        retry = hs_time_us() + 30000000;
      } else
        continue;
    }
    if (r.kind == 2) {
      AP_IF_S *aps = NULL;
      uint32_t n = 0;
      tal_mutex_lock(lock);
      state.scanning = true;
      tal_mutex_unlock(lock);
      OPERATE_RET e = tal_wifi_all_ap_scan(&aps, &n);
      tal_mutex_lock(lock);
      state.scanning = false;
      state.count = 0;
      if (e == OPRT_OK) {
        for (uint32_t i = 0; i < n && state.count < HS_WIFI_SCAN_LIMIT; i++) {
          hs_wifi_ap_t *ap = &state.aps[state.count++];
          memset(ap, 0, sizeof(*ap));
          size_t len = aps[i].s_len > 32 ? 32 : aps[i].s_len;
          memcpy(ap->ssid, aps[i].ssid, len);
          ap->rssi = aps[i].rssi;
          ap->open = aps[i].security == WAAM_OPEN;
          ap->remembered = !strcmp(ap->ssid, saved.ssid);
        }
      }
      changed(e == OPRT_OK ? "扫描完成" : "扫描失败");
      tal_mutex_unlock(lock);
      if (aps)
        tal_wifi_release_ap(aps);
      continue;
    }
    if (r.kind == 3) {
      paused = true;
      tal_wifi_station_disconnect();
      continue;
    }
    if (r.kind == 4) {
      if (!saved.ssid[0])
        continue;
      snprintf(r.ap.ssid, sizeof(r.ap.ssid), "%s", saved.ssid);
      snprintf(r.password, sizeof(r.password), "%s", saved.password);
      r.remember = false;
    }
    paused = false;
    tal_mutex_lock(lock);
    state.connecting = true;
    state.connected = false;
    state.connection_saved = false;
    state.connection_revision++;
    snprintf(state.ssid, sizeof(state.ssid), "%s", r.ap.ssid);
    changed("正在连接网络");
    tal_mutex_unlock(lock);
    tal_wifi_station_disconnect();
    OPERATE_RET e =
        tal_wifi_station_connect((int8_t *)r.ap.ssid, (int8_t *)r.password);
    bool connected = false;
    for (unsigned i = 0; e == OPRT_OK && i < 150; i++) {
      WF_STATION_STAT_E status;
      if (tal_wifi_station_get_status(&status) == OPRT_OK &&
          status == WSS_GOT_IP) {
        connected = true;
        break;
      }
      hs_delay_ms(100);
    }
    bool stored = false;
    if (connected && r.remember) {
      saved_t next = {0};
      snprintf(next.ssid, sizeof(next.ssid), "%s", r.ap.ssid);
      snprintf(next.password, sizeof(next.password), "%s", r.password);
      if (!tal_kv_set("hs.wifi.v1", (const uint8_t *)&next, sizeof(next))) {
        saved = next;
        stored = true;
      }
      memset(&next, 0, sizeof(next));
    }
    tal_mutex_lock(lock);
    state.connected = connected;
    state.connecting = false;
    state.connection_saved = stored;
    state.automatic = true;
    changed(connected ? "网络已连接" : "连接失败，将自动重试已保存网络");
    tal_mutex_unlock(lock);
    memset(&r, 0, sizeof(r));
    retry = hs_time_us() + 30000000;
  }
}
hs_err_t hs_network_init(void) {
  if (tal_mutex_create_init(&lock) != OPRT_OK)
    return HS_ERR_NO_MEM;
  requests = hs_queue_create(4, sizeof(request_t));
  if (!requests)
    return HS_ERR_NO_MEM;
  uint8_t *bytes = NULL;
  size_t n = 0;
  if (!tal_kv_get("hs.wifi.v1", &bytes, &n) && n == sizeof(saved)) {
    memcpy(&saved, bytes, n);
    if (!memchr(saved.ssid, 0, sizeof(saved.ssid)) ||
        !memchr(saved.password, 0, sizeof(saved.password)))
      memset(&saved, 0, sizeof(saved));
  }
  if (bytes)
    tal_kv_free(bytes);
  if (!saved.ssid[0]) {
    snprintf(saved.ssid, sizeof(saved.ssid), "%s", HS_WIFI_SSID);
    snprintf(saved.password, sizeof(saved.password), "%s", HS_WIFI_PASSWORD);
  }
  if (tal_wifi_init(event) != OPRT_OK ||
      tal_wifi_set_work_mode(WWM_STATION) != OPRT_OK)
    return HS_FAIL;
  return hs_task_start(worker, "hs-wifi", 6144, 3) ? HS_OK : HS_FAIL;
}
