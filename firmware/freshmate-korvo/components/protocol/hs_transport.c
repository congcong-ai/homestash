#include "hs_transport.h"
#include "hs_power.h"
#include "esp_heap_caps.h"
#include "hs_storage.h"
#include "hs_camera.h"
#include "hs_outbox.h"
#include "hs_device_config.h"
#include "esp_app_desc.h"
#include "esp_ota_ops.h"
#include "esp_http_client.h"
#include "esp_crt_bundle.h"
#include "cJSON.h"
#include <stdio.h>
#include <unistd.h>
#include <errno.h>
#include "esp_log.h"
#include "esp_timer.h"
#include "hs_display.h"
#include <string.h>
#include <sys/stat.h>
esp_http_client_handle_t hs_transport_client(const char *route,int timeout_ms) {
  hs_device_config_t config;hs_device_config_get(&config);
  if(!config.token[0] || !config.core_url[0]) return NULL;
  char url[512],auth[160];
  if(snprintf(url,sizeof(url),"%s%s",config.core_url,route)>=sizeof(url)) return NULL;
  esp_http_client_config_t c={.url=url,.timeout_ms=timeout_ms,.crt_bundle_attach=esp_crt_bundle_attach,.disable_auto_redirect=true};
  esp_http_client_handle_t h=esp_http_client_init(&c);
  if(h) {
    snprintf(auth,sizeof(auth),"Bearer %s",config.token);
    esp_http_client_set_header(h,"Authorization",auth);
    esp_http_client_set_header(h,"X-Device-ID",config.device_id);
  }
  memset(auth,0,sizeof(auth));memset(&config,0,sizeof(config));return h;
}
esp_err_t hs_transport_capture(const char *id, char *message, size_t size) {
  char route[128], path[HS_OUTBOX_PATH_SIZE]; struct stat st;
  if(hs_outbox_path(id,"wav",path,sizeof(path))) return ESP_FAIL;
  if(stat(path,&st) || st.st_size<44 || st.st_size>1920044) return ESP_FAIL;
  FILE *f=fopen(path,"rb"); if(!f) return ESP_FAIL;
  snprintf(route,sizeof(route),"/device/v1/captures/%s",id);
  esp_http_client_handle_t h=hs_transport_client(route,5000);
  if(!h) { fclose(f); return ESP_ERR_INVALID_STATE; }
  esp_http_client_set_method(h,HTTP_METHOD_POST);
  esp_http_client_set_header(h,"Content-Type","audio/wav");
  esp_err_t result=esp_http_client_open(h,st.st_size);
  if(result==ESP_OK) esp_http_client_set_timeout_ms(h,120000);
  char buffer[2048]; size_t n;
  while(result==ESP_OK && (n=fread(buffer,1,sizeof(buffer),f))>0) {
    size_t offset=0;
    while(offset<n) { int sent=esp_http_client_write(h,buffer+offset,n-offset); if(sent<=0){result=ESP_FAIL;break;} offset+=sent; }
  }
  if(ferror(f)) result=ESP_FAIL;
  fclose(f);
  if(result==ESP_OK) {
    esp_http_client_fetch_headers(h);
    int length=esp_http_client_read_response(h,buffer,sizeof(buffer)-1);
    if(esp_http_client_get_status_code(h)!=200 || length<=0) result=ESP_FAIL;
    else {
      buffer[length]=0; cJSON *j=cJSON_Parse(buffer); cJSON *m=cJSON_GetObjectItemCaseSensitive(j,"message");
      if(cJSON_IsString(m)) snprintf(message,size,"%s",m->valuestring); else result=ESP_FAIL;
      cJSON_Delete(j);
    }
  }
  esp_http_client_cleanup(h); return result;
}
esp_err_t hs_transport_photo(const char *id, char *message, size_t size) {
  char route[128], path[HS_OUTBOX_PATH_SIZE]; struct stat st;
  if(hs_camera_path(id,path,sizeof(path))!=ESP_OK) return ESP_FAIL;
  if(stat(path,&st) || st.st_size<24 || st.st_size>3*1024*1024) return ESP_FAIL;
  FILE *f=fopen(path,"rb"); if(!f) return ESP_FAIL;
  snprintf(route,sizeof(route),"/device/v1/images/%s",id);
  esp_http_client_handle_t h=hs_transport_client(route,5000);
  if(!h) { fclose(f); return ESP_ERR_INVALID_STATE; }
  esp_http_client_set_method(h,HTTP_METHOD_POST);
  esp_http_client_set_header(h,"Content-Type","image/jpeg");
  esp_err_t result=esp_http_client_open(h,st.st_size);
  if(result==ESP_OK) esp_http_client_set_timeout_ms(h,120000);
  char buffer[2048]; size_t n;
  while(result==ESP_OK && (n=fread(buffer,1,sizeof(buffer),f))>0) {
    size_t offset=0;
    while(offset<n) { int sent=esp_http_client_write(h,buffer+offset,n-offset); if(sent<=0){result=ESP_FAIL;break;} offset+=sent; }
  }
  if(ferror(f)) result=ESP_FAIL;
  fclose(f);
  if(result==ESP_OK) {
    esp_http_client_fetch_headers(h);
    int length=esp_http_client_read_response(h,buffer,sizeof(buffer)-1);
    if(esp_http_client_get_status_code(h)!=200 || length<=0) result=ESP_FAIL;
    else {
      buffer[length]=0; cJSON *j=cJSON_Parse(buffer); cJSON *m=cJSON_GetObjectItemCaseSensitive(j,"message");
      if(cJSON_IsString(m)) snprintf(message,size,"%s",m->valuestring); else result=ESP_FAIL;
      cJSON_Delete(j);
    }
  }
  esp_http_client_cleanup(h); return result;
}
esp_err_t hs_transport_reply(const char *id) {
  char route[128],buffer[2048];
  snprintf(route,sizeof(route),"/device/v1/captures/%s/audio",id);
  esp_http_client_handle_t h=hs_transport_client(route,5000); if(!h) return ESP_FAIL;
  esp_err_t result=esp_http_client_open(h,0);
  if(result==ESP_OK) esp_http_client_set_timeout_ms(h,120000);
  FILE *f=NULL; size_t total=0;
  if(result==ESP_OK) {
    esp_http_client_fetch_headers(h);
    if(esp_http_client_get_status_code(h)!=200) result=ESP_FAIL;
    else if(!(f=fopen(HS_REPLY ".tmp","wb"))) result=ESP_FAIL;
  }
  while(result==ESP_OK) {
    int n=esp_http_client_read(h,buffer,sizeof(buffer));
    if(n<0){result=ESP_FAIL;break;} if(!n)break;
    total+=n;
    if(total>1920044 || fwrite(buffer,1,n,f)!=(size_t)n){result=ESP_FAIL;break;}
  }
  if(result==ESP_OK && (!esp_http_client_is_complete_data_received(h) || total<44)) result=ESP_FAIL;
  if(f) {if(fflush(f) || fsync(fileno(f))) result=ESP_FAIL; if(fclose(f)) result=ESP_FAIL;}
  esp_http_client_cleanup(h);
  if(result==ESP_OK && hs_outbox_replace_cache(HS_REPLY ".tmp",HS_REPLY)) {
    ESP_LOGE("FreshMate", "播报缓存替换失败 errno=%d",errno);result=ESP_FAIL;
  }
  ESP_LOGI("FreshMate", "播报下载 id=%s bytes=%u result=%s",id,(unsigned)total,esp_err_to_name(result));
  if(result!=ESP_OK) remove(HS_REPLY ".tmp");
  return result;
}
esp_err_t hs_transport_heartbeat(void) {
  esp_http_client_handle_t h=hs_transport_client("/device/v1/heartbeat",5000); if(!h) return ESP_FAIL;
  esp_http_client_set_method(h,HTTP_METHOD_POST);
  esp_http_client_set_header(h,"Content-Type","application/json");
  hs_display_snapshot_t snapshot;hs_display_snapshot(&snapshot);
  cJSON *body=cJSON_CreateObject();if(!body) {esp_http_client_cleanup(h);return ESP_ERR_NO_MEM;}
  cJSON_AddStringToObject(body,"screen",snapshot.text);
  cJSON_AddStringToObject(body,"network",snapshot.network);
  cJSON_AddNumberToObject(body,"screenRevision",snapshot.revision);
  cJSON_AddNumberToObject(body,"uptimeMs",esp_timer_get_time()/1000);
  cJSON_AddStringToObject(body,"powerState",hs_power_state());
  cJSON_AddNumberToObject(body,"freeHeapBytes",heap_caps_get_free_size(MALLOC_CAP_INTERNAL));
  cJSON_AddNumberToObject(body,"minimumFreeHeapBytes",heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL));
  esp_ota_img_states_t ota_state;
  cJSON_AddStringToObject(body,"otaState",esp_ota_get_state_partition(esp_ota_get_running_partition(),&ota_state)!=ESP_OK?"factory":ota_state==ESP_OTA_IMG_VALID?"valid":ota_state==ESP_OTA_IMG_PENDING_VERIFY?"pending_verify":"other");
  cJSON_AddStringToObject(body,"firmwareVersion",esp_app_get_description()->version);
  cJSON_AddStringToObject(body,"firmwarePartition",esp_ota_get_running_partition()->label);
  char elf[65];esp_app_get_elf_sha256(elf,sizeof(elf));
  cJSON_AddStringToObject(body,"firmwareElf",elf);
  char *json=cJSON_PrintUnformatted(body);cJSON_Delete(body);
  if(!json) {esp_http_client_cleanup(h);return ESP_ERR_NO_MEM;}
  esp_http_client_set_post_field(h,json,strlen(json));
  esp_http_client_set_timeout_ms(h,5000);
  esp_err_t e=esp_http_client_perform(h);
  if(e==ESP_OK && esp_http_client_get_status_code(h)!=200) e=ESP_FAIL;
  esp_http_client_cleanup(h);cJSON_free(json);return e;
}

esp_err_t hs_transport_screen(int page,char *message,size_t size) {
  static const char *pages[]={"home","inventory","freshness","recipes","cooking","shopping"};
  if(page<0 || page>=6) return ESP_ERR_INVALID_ARG;
  char route[128],buffer[2048];
  snprintf(route,sizeof(route),"/device/v1/screen?page=%s",pages[page]);
  esp_http_client_handle_t h=hs_transport_client(route,5000);if(!h) return ESP_FAIL;
  esp_err_t result=esp_http_client_open(h,0);
  if(result==ESP_OK && esp_http_client_fetch_headers(h)>=0 && esp_http_client_get_status_code(h)==200) {
    int n=esp_http_client_read_response(h,buffer,sizeof(buffer)-1);
    if(n<=0 || !esp_http_client_is_complete_data_received(h)) result=ESP_FAIL;
    else {
      buffer[n]=0;cJSON *j=cJSON_Parse(buffer);cJSON *text=cJSON_GetObjectItemCaseSensitive(j,"text");
      if(cJSON_IsString(text) && strlen(text->valuestring)<size) snprintf(message,size,"%s",text->valuestring);
      else result=ESP_FAIL;
      cJSON_Delete(j);
    }
  } else result=ESP_FAIL;
  esp_http_client_cleanup(h);return result;
}
