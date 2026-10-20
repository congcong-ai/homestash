#include "hs_ota.h"
#include "hs_transport.h"
#include "hs_device_config.h"
#include "esp_ota_ops.h"
#include "esp_app_desc.h"
#include "esp_log.h"
#include "cJSON.h"
#include "mbedtls/md.h"
#include "psa/crypto.h"
#include "freertos/FreeRTOS.h"
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
typedef struct { char sha[65],version[32]; int size; unsigned config_revision; } release_t;
static release_t checked;
static portMUX_TYPE guard=portMUX_INITIALIZER_UNLOCKED;
static hs_ota_status_t status={.message="尚未检查更新"};
void hs_ota_status(hs_ota_status_t *out) {portENTER_CRITICAL(&guard);*out=status;portEXIT_CRITICAL(&guard);}
static void note(const char *message,int progress,bool available) {
  portENTER_CRITICAL(&guard);snprintf(status.message,sizeof(status.message),"%s",message);status.progress=progress;status.available=available;portEXIT_CRITICAL(&guard);
  ESP_LOGI("HomeStashOTA","%s (%d%%)",message,progress);
}
static void hex(const unsigned char *digest,char out[65]) {for(int i=0;i<32;i++)sprintf(out+i*2,"%02x",digest[i]);}
static esp_err_t manifest(release_t *out) {
  hs_device_config_t config;hs_device_config_get(&config);
  esp_http_client_handle_t h=hs_transport_client("/device/v1/firmware",5000);if(!h)return ESP_ERR_INVALID_STATE;
  char body[1536];esp_err_t err=esp_http_client_open(h,0);
  int n=-1;if(err==ESP_OK && esp_http_client_fetch_headers(h)>=0 && esp_http_client_get_status_code(h)==200)n=esp_http_client_read_response(h,body,sizeof(body)-1);
  bool complete=esp_http_client_is_complete_data_received(h);esp_http_client_cleanup(h);
  if(n<=0 || !complete)return ESP_FAIL;
  body[n]=0;cJSON *j=cJSON_Parse(body);
  cJSON *sha=cJSON_GetObjectItemCaseSensitive(j,"sha256"),*size=cJSON_GetObjectItemCaseSensitive(j,"size"),*version=cJSON_GetObjectItemCaseSensitive(j,"version"),*project=cJSON_GetObjectItemCaseSensitive(j,"project"),*chip=cJSON_GetObjectItemCaseSensitive(j,"chip"),*signature=cJSON_GetObjectItemCaseSensitive(j,"signature");
  err=ESP_FAIL;
  if(!cJSON_IsString(sha) || strlen(sha->valuestring)!=64 || strspn(sha->valuestring,"0123456789abcdef")!=64 || !cJSON_IsNumber(size) || size->valuedouble!=size->valueint || size->valueint<304 || size->valueint>4*1024*1024 || !cJSON_IsString(version) || !version->valuestring[0] || strlen(version->valuestring)>31 || !cJSON_IsString(project) || strcmp(project->valuestring,"homestash_freshmate") || !cJSON_IsString(chip) || strcmp(chip->valuestring,"esp32s31") || !cJSON_IsString(signature) || strlen(signature->valuestring)!=64)goto done;
  char canonical[192],signed_hex[65];unsigned char signed_bytes[32];
  snprintf(canonical,sizeof(canonical),"%s:%d:%s:homestash_freshmate:esp32s31",sha->valuestring,size->valueint,version->valuestring);
  psa_key_attributes_t attributes=PSA_KEY_ATTRIBUTES_INIT;mbedtls_svc_key_id_t key=0;size_t signature_size=0;
  psa_set_key_type(&attributes,PSA_KEY_TYPE_HMAC);psa_set_key_algorithm(&attributes,PSA_ALG_HMAC(PSA_ALG_SHA_256));psa_set_key_usage_flags(&attributes,PSA_KEY_USAGE_SIGN_MESSAGE);
  if(psa_crypto_init()!=PSA_SUCCESS || psa_import_key(&attributes,(unsigned char*)config.token,strlen(config.token),&key)!=PSA_SUCCESS)goto done;
  psa_status_t signed_status=psa_mac_compute(key,PSA_ALG_HMAC(PSA_ALG_SHA_256),(unsigned char*)canonical,strlen(canonical),signed_bytes,sizeof(signed_bytes),&signature_size);
  psa_destroy_key(key);psa_reset_key_attributes(&attributes);
  if(signed_status!=PSA_SUCCESS || signature_size!=32)goto done;
  hex(signed_bytes,signed_hex);unsigned difference=0;for(int i=0;i<64;i++)difference|=signed_hex[i]^signature->valuestring[i];if(difference)goto done;
  memset(out,0,sizeof(*out));strlcpy(out->sha,sha->valuestring,sizeof(out->sha));strlcpy(out->version,version->valuestring,sizeof(out->version));out->size=size->valueint;out->config_revision=config.revision;err=ESP_OK;
done:cJSON_Delete(j);memset(&config,0,sizeof(config));return err;
}
esp_err_t hs_ota_check(void) {
  note("正在检查 Core 发布的固件",0,false);release_t release;
  esp_err_t err=manifest(&release);
  if(err!=ESP_OK){note("检查失败，请确认 Core 地址、设备凭据和固件发布状态",0,false);return err;}
  checked=release;
  portENTER_CRITICAL(&guard);strlcpy(status.version,release.version,sizeof(status.version));portEXIT_CRITICAL(&guard);
  char message[192];snprintf(message,sizeof(message),"可安装 %s，%d 字节。请确认后升级",release.version,release.size);note(message,0,true);return ESP_OK;
}
esp_err_t hs_ota_install(void) {
  hs_ota_status_t snapshot;hs_ota_status(&snapshot);if(!snapshot.available)return ESP_ERR_INVALID_STATE;
  release_t release;esp_err_t err=manifest(&release);
  if(err!=ESP_OK || strcmp(release.sha,checked.sha) || release.config_revision!=checked.config_revision) {note("更新内容或 Core 配置已变化，请重新检查并确认",0,false);return ESP_FAIL;}
  const esp_partition_t *partition=esp_ota_get_next_update_partition(NULL);
  if(!partition || partition->size<(unsigned)release.size || partition==esp_ota_get_running_partition()){note("没有可用 OTA 分区，请先通过 UART 安装 OTA 基础固件",0,false);return ESP_ERR_NOT_FOUND;}
  char route[128];snprintf(route,sizeof(route),"/device/v1/firmware/%s",release.sha);
  esp_http_client_handle_t h=hs_transport_client(route,10000);if(!h)return ESP_FAIL;
  esp_ota_handle_t handle=0;bool active=false;mbedtls_md_context_t digest;mbedtls_md_init(&digest);
  err=esp_http_client_open(h,0);if(err!=ESP_OK)goto done;
  esp_http_client_set_timeout_ms(h,30000);
  int64_t length=esp_http_client_fetch_headers(h);
  if(esp_http_client_get_status_code(h)!=200 || length!=release.size){err=ESP_FAIL;goto done;}
  err=esp_ota_begin(partition,release.size,&handle);if(err!=ESP_OK)goto done;active=true;
  if(mbedtls_md_setup(&digest,mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),0) || mbedtls_md_starts(&digest)){err=ESP_FAIL;goto done;}
  char buffer[4096];int total=0,last=-1;
  for(;;) {
    int n=esp_http_client_read(h,buffer,sizeof(buffer));if(n<0){err=ESP_FAIL;goto done;}if(!n)break;
    total+=n;if(total>release.size){err=ESP_FAIL;goto done;}
    err=esp_ota_write(handle,buffer,n);if(err!=ESP_OK)goto done;
    if(mbedtls_md_update(&digest,(unsigned char*)buffer,n)){err=ESP_FAIL;goto done;}
    int progress=total*100/release.size;if(progress/10!=last){note("正在下载并校验固件，请勿断电",progress,false);last=progress/10;}
  }
  unsigned char bytes[32];char actual[65];
  if(total!=release.size || !esp_http_client_is_complete_data_received(h) || mbedtls_md_finish(&digest,bytes)){err=ESP_FAIL;goto done;}hex(bytes,actual);
  if(strcmp(actual,release.sha)){err=ESP_FAIL;goto done;}
  err=esp_ota_end(handle);active=false;if(err!=ESP_OK)goto done;
  esp_app_desc_t descriptor;err=esp_ota_get_partition_description(partition,&descriptor);
  if(err!=ESP_OK || strcmp(descriptor.project_name,"homestash_freshmate") || strcmp(descriptor.version,release.version)){err=ESP_FAIL;goto done;}
  err=esp_ota_set_boot_partition(partition);
done:
  if(active)esp_ota_abort(handle);
  mbedtls_md_free(&digest);esp_http_client_cleanup(h);
  note(err==ESP_OK?"升级校验成功，即将重启":"升级未完成，保留当前固件；请重新检查后重试",err==ESP_OK?100:0,false);
  return err;
}
void hs_ota_boot_health(bool healthy) {
  const esp_partition_t *running=esp_ota_get_running_partition();esp_ota_img_states_t state;
  if(esp_ota_get_state_partition(running,&state)==ESP_OK && state==ESP_OTA_IMG_PENDING_VERIFY) {
    if(healthy)ESP_ERROR_CHECK(esp_ota_mark_app_valid_cancel_rollback());
    else esp_ota_mark_app_invalid_rollback_and_reboot();
  }
  ESP_LOGI("HomeStashOTA","启动自检 %s，version=%s partition=%s",healthy?"通过":"失败",esp_app_get_description()->version,running->label);
}
