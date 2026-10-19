#include "hs_transport.h"
#include "hs_storage.h"
#include "hs_outbox.h"
#include "local-network-config.h"
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
static esp_http_client_handle_t client(const char *id, const char *suffix, char *url, size_t size) {
  if (!strlen(CONFIG_HS_DEVICE_TOKEN) || !strlen(CONFIG_HS_CORE_URL)) return NULL;
  snprintf(url,size,"%s/device/v1/captures/%s%s",CONFIG_HS_CORE_URL,id,suffix);
  esp_http_client_config_t c={.url=url,.timeout_ms=5000,.crt_bundle_attach=esp_crt_bundle_attach,.disable_auto_redirect=true};
  esp_http_client_handle_t h=esp_http_client_init(&c);
  if (!h) return NULL;
  char auth[256]; snprintf(auth,sizeof(auth),"Bearer %s",CONFIG_HS_DEVICE_TOKEN);
  esp_http_client_set_header(h,"Authorization",auth);
  esp_http_client_set_header(h,"X-Device-ID",CONFIG_HS_DEVICE_ID);
  return h;
}
esp_err_t hs_transport_capture(const char *id, char *message, size_t size) {
  char url[512], path[HS_OUTBOX_PATH_SIZE]; struct stat st;
  if(hs_outbox_path(id,"wav",path,sizeof(path))) return ESP_FAIL;
  if(stat(path,&st) || st.st_size<44 || st.st_size>1920044) return ESP_FAIL;
  FILE *f=fopen(path,"rb"); if(!f) return ESP_FAIL;
  esp_http_client_handle_t h=client(id,"",url,sizeof(url));
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
esp_err_t hs_transport_reply(const char *id) {
  char url[512],buffer[2048];
  esp_http_client_handle_t h=client(id,"/audio",url,sizeof(url)); if(!h) return ESP_FAIL;
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
  char url[512];
  esp_http_client_handle_t h=client("","",url,sizeof(url)); if(!h) return ESP_FAIL;
  snprintf(url,sizeof(url),"%s/device/v1/heartbeat",CONFIG_HS_CORE_URL);
  esp_http_client_set_url(h,url);
  esp_http_client_set_method(h,HTTP_METHOD_POST);
  esp_http_client_set_header(h,"Content-Type","application/json");
  hs_display_snapshot_t snapshot;hs_display_snapshot(&snapshot);
  cJSON *body=cJSON_CreateObject();if(!body) {esp_http_client_cleanup(h);return ESP_ERR_NO_MEM;}
  cJSON_AddStringToObject(body,"screen",snapshot.text);
  cJSON_AddStringToObject(body,"network",snapshot.network);
  cJSON_AddNumberToObject(body,"screenRevision",snapshot.revision);
  cJSON_AddNumberToObject(body,"uptimeMs",esp_timer_get_time()/1000);
  char *json=cJSON_PrintUnformatted(body);cJSON_Delete(body);
  if(!json) {esp_http_client_cleanup(h);return ESP_ERR_NO_MEM;}
  esp_http_client_set_post_field(h,json,strlen(json));
  esp_http_client_set_timeout_ms(h,5000);
  esp_err_t e=esp_http_client_perform(h);
  if(esp_http_client_get_status_code(h)!=200) e=ESP_FAIL;
  esp_http_client_cleanup(h);cJSON_free(json);return e;
}
