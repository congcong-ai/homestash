#include "hs_transport.h"
#include "cJSON.h"
#include "hs_board.h"
#include "hs_build_config.h"
#include "hs_device_config.h"
#include "hs_display.h"
#include "hs_endpoint.h"
#include "hs_fs.h"
#include "hs_runtime.h"
#include "hs_storage.h"
#include "http_client_interface.h"
#include "tal_memory.h"
#include <stdio.h>
#include <string.h>
http_client_status_t hs_http_download(const http_client_request_t *,http_client_response_t *,const char *,size_t);
http_client_status_t hs_http_request(const http_client_request_t *,http_client_response_t *);
#define MAX_WAV 1920044
unsigned hs_t5_core_address_revision(void);
static bool command_capture;
void hs_transport_yard_command_mode(bool enabled){command_capture=enabled;}
static hs_err_t request_to_file_once(const char *destination,const char *route, const char *method, const char *type,
                        const void *body, size_t length,
                        http_client_response_t *response) {
  hs_device_config_t config;
  hs_device_config_get(&config);
  hs_endpoint_t endpoint;
  char path[512], auth[160];
  if (!config.token[0] || !hs_endpoint_parse(config.core_url, &endpoint)) {
    hs_display_backend(false);HS_LOGI("transport","device configuration unavailable");return HS_ERR_INVALID_STATE;
  }
  if (endpoint.tls && !HS_CORE_CA[0])
    return HS_ERR_NOT_SUPPORTED;
  int n = snprintf(path, sizeof(path), "%s%s", endpoint.prefix, route);
  if (n < 0 || (size_t)n >= sizeof(path))
    return HS_ERR_INVALID_ARG;
  snprintf(auth, sizeof(auth), "Bearer %s", config.token);
  http_client_header_t headers[] = {{"Authorization", auth},
                                    {"X-Device-ID", config.device_id},
                                    {"Content-Type", type}, {"X-Speech-Mode", command_capture?"interruption":"dialogue"}};
  http_client_request_t r = {
      .host = endpoint.host,
      .port = endpoint.port,
      .path = path,
      .cacert = endpoint.tls ? (const uint8_t *)HS_CORE_CA : NULL,
      .cacert_len = endpoint.tls ? sizeof(HS_CORE_CA) : 0,
      .method = method,
      .headers = headers,
      .headers_count = 4,
      .body = body,
      .body_length = length,
      .timeout_ms = strstr(route,"/yard/activity") ? 1000 : strstr(route, "/captures/") ? 120000 : 5000};
  HS_LOGI("transport","begin host=%s port=%u route=%s",endpoint.host,(unsigned)endpoint.port,route);
  http_client_status_t status = destination?hs_http_download(&r,response,destination,MAX_WAV):hs_http_request(&r, response);
  HS_LOGI("transport","route=%s result=%d http=%d",route,(int)status,(int)response->status_code);
  memset(auth, 0, sizeof(auth));
  memset(&config, 0, sizeof(config));
  hs_display_backend(status == HTTP_CLIENT_SUCCESS && response->status_code == 200);
  if (status != HTTP_CLIENT_SUCCESS)
    return HS_ERR_HTTP_CONNECT;
  return response->status_code == 200 ? HS_OK : HS_FAIL;
}
static hs_err_t request_to_file(const char *destination,const char *route,const char *method,const char *type,const void *body,size_t length,http_client_response_t *response){
 unsigned revision=hs_t5_core_address_revision();
 hs_err_t e=request_to_file_once(destination,route,method,type,body,length,response);
 if(e&&revision!=hs_t5_core_address_revision()){
   http_client_free(response);memset(response,0,sizeof(*response));
   e=request_to_file_once(destination,route,method,type,body,length,response);
 }
 return e;
}
static hs_err_t request(const char *route,const char *method,const char *type,const void *body,size_t length,http_client_response_t *response){return request_to_file(NULL,route,method,type,body,length,response);}
static hs_err_t text(const http_client_response_t *r, const char *field,
                     char *message, size_t size) {
  if (!message || !size || !r->body || !r->body_length || r->body_length > 8192)
    return HS_FAIL;
  cJSON *j = cJSON_ParseWithLength((const char *)r->body, r->body_length);
  cJSON *value = cJSON_GetObjectItemCaseSensitive(j, field);
  hs_err_t e = HS_FAIL;
  if (cJSON_IsString(value) && strlen(value->valuestring) < size) {
    snprintf(message, size, "%s", value->valuestring);
    e = HS_OK;
  }
  cJSON_Delete(j);
  return e;
}
static bool yard_stop_requested;
bool hs_transport_yard_stop_requested(void){return yard_stop_requested;}
static bool yard_photo_requested;
bool hs_transport_yard_photo_requested(void){return yard_photo_requested;}
hs_err_t hs_transport_capture(const char *id, char *message, size_t size) {
  yard_photo_requested=false;yard_stop_requested=false;
  char path[HS_OUTBOX_PATH_SIZE], route[128];
  hs_file_info_t st;
  if (hs_outbox_path(id, "wav", path, sizeof(path)) || hs_fs_info(path, &st) ||
      st.size < 46 || st.size > MAX_WAV || hs_outbox_validate_wav(path))
    return HS_FAIL;
  uint8_t *bytes = tal_psram_malloc((size_t)st.size);
  if (!bytes)
    return HS_ERR_NO_MEM;
  hs_file_t f = hs_fs_open(path, "rb");
  if (!f) {
    tal_psram_free(bytes);
    return HS_FAIL;
  }
  size_t n = hs_fs_read(bytes, (size_t)st.size, f);
  int closed = hs_fs_close(f);
  http_client_response_t response = {0};
  hs_err_t e = HS_FAIL;
  if (n == (size_t)st.size && !closed) {
    snprintf(route, sizeof(route), "/device/v1/captures/%s", id);
    e = request(route, "POST", "audio/wav", bytes, n, &response);
    if (!e){
      char action[24]={0};text(&response,"action",action,sizeof(action));yard_photo_requested=!strcmp(action,"photo");yard_stop_requested=!strcmp(action,"stop");
      e = text(&response, "message", message, size);
    }
  }
  http_client_free(&response);
  tal_psram_free(bytes);
  return e;
}
hs_err_t hs_transport_reply(const char *id) {
  char path[HS_OUTBOX_PATH_SIZE], route[128];
  if (hs_outbox_path(id, "wav", path, sizeof(path)))
    return HS_ERR_INVALID_ARG;
  snprintf(route, sizeof(route), "/device/v1/captures/%s/audio", id);
  http_client_response_t r = {0};
  hs_err_t e=request_to_file(HS_REPLY ".tmp",route,"GET","application/json",NULL,0,&r);
  if(!e&&hs_outbox_validate_wav(HS_REPLY ".tmp"))e=HS_FAIL;
  if(!e&&hs_outbox_replace_cache(HS_REPLY ".tmp",HS_REPLY))e=HS_FAIL;
  if (e)
    hs_fs_remove(HS_REPLY ".tmp");
  http_client_free(&r);
  return e;
}
hs_err_t hs_transport_screen(int page, char *message, size_t size) {
  static const char *pages[] = {"home",    "inventory", "freshness",
                                "recipes", "cooking",   "shopping"};
  if (page < 0 || page >= 6)
    return HS_ERR_INVALID_ARG;
  char route[96];
  snprintf(route, sizeof(route), "/device/v1/screen?page=%s", pages[page]);
  http_client_response_t r = {0};
  hs_err_t e = request(route, "GET", "application/json", NULL, 0, &r);
  if (!e)
    e = text(&r, "text", message, size);
  http_client_free(&r);
  return e;
}
hs_err_t hs_transport_heartbeat(void) {
  hs_display_snapshot_t screen;
  hs_display_snapshot(&screen);
  const hs_board_descriptor_t *board = hs_board_descriptor();
  cJSON *j = cJSON_CreateObject();
  if (!j)
    return HS_ERR_NO_MEM;
  cJSON_AddStringToObject(j, "screen", screen.text);
  cJSON_AddStringToObject(j, "network", screen.network);
  cJSON_AddNumberToObject(j, "screenRevision", screen.revision);
  cJSON_AddNumberToObject(j, "uptimeMs", hs_time_us() / 1000);
  cJSON_AddStringToObject(j, "firmwareVersion", PROJECT_VERSION);
  cJSON_AddNumberToObject(j, "freeHeapBytes", tal_system_get_free_heap_size());
  cJSON *hardware = cJSON_AddObjectToObject(j, "hardware");
  cJSON_AddStringToObject(hardware, "boardId", board->id);
  cJSON_AddStringToObject(hardware, "chip", board->chip);
  cJSON *caps = cJSON_AddArrayToObject(hardware, "capabilities");
  static const char *names[] = {"audio_input", "audio_output",
                                "camera",      "display",
                                "touch",       "buttons",
                                "wifi",        "ble_provisioning",
                                "ota",         "persistent_storage",
                                "timer_sleep"};
  for (unsigned i = 0; i < sizeof(names) / sizeof(*names); i++)
    if (board->capabilities & (1u << i))
      cJSON_AddItemToArray(caps, cJSON_CreateString(names[i]));
  char *body = cJSON_PrintUnformatted(j);
  cJSON_Delete(j);
  if (!body)
    return HS_ERR_NO_MEM;
  http_client_response_t r = {0};
  hs_err_t e = request("/device/v1/heartbeat", "POST", "application/json", body,
                       strlen(body), &r);
  cJSON_free(body);
  http_client_free(&r);
  return e;
}
hs_err_t hs_transport_photo(const char *id, char *message, size_t size) {
  (void)id;
  (void)message;
  (void)size;
  return HS_ERR_NOT_SUPPORTED;
}

/* 产品设置复用设备鉴权，不引入新凭据或公共照片目录。 */
hs_err_t hs_transport_yard_silent(bool *silent) {
  http_client_response_t r={0};
  hs_err_t e=request("/device/v1/yard/settings","GET","application/json",NULL,0,&r);
  if(!e){
    cJSON *j=cJSON_ParseWithLength((const char *)r.body,r.body_length);
    cJSON *v=j?cJSON_GetObjectItemCaseSensitive(j,"silent"):NULL;
    if(cJSON_IsBool(v))*silent=cJSON_IsTrue(v);else e=HS_FAIL;
    cJSON *a=cJSON_GetObjectItemCaseSensitive(j,"avatar");
    cJSON *vrs=cJSON_GetObjectItemCaseSensitive(a,"version"),*rev=cJSON_GetObjectItemCaseSensitive(a,"revision"),*theme=cJSON_GetObjectItemCaseSensitive(a,"theme"),*mode=cJSON_GetObjectItemCaseSensitive(a,"mode");
    if(cJSON_IsNumber(vrs)&&vrs->valuedouble==1&&cJSON_IsNumber(rev)&&rev->valuedouble>=0&&rev->valuedouble<=2147483647&&rev->valuedouble==rev->valueint&&cJSON_IsNumber(theme)&&theme->valuedouble==theme->valueint&&cJSON_IsString(mode)&&(!strcmp(mode->valuestring,"standard")||!strcmp(mode->valuestring,"fullscreen")))hs_t5_avatar_config((unsigned)rev->valueint,theme->valueint,!strcmp(mode->valuestring,"fullscreen"));
    cJSON_Delete(j);
  }
  http_client_free(&r);return e;
}

/* 小院真实照片独立协议，不经过库存识别或模型。 */
hs_err_t hs_transport_yard_photo(const char *id,const char *operation,const void *bytes,size_t length,char *message,size_t size){
 char route[160];http_client_response_t r={0};
 snprintf(route,sizeof(route),"/device/v1/yard/photos/%s/%s",id,operation);
 hs_err_t e=request(route,"POST",bytes?"image/jpeg":"application/json",bytes?bytes:"{}",bytes?length:2,&r);
 if(!e&&message&&size){if(r.body&&r.body_length<size){memcpy(message,r.body,r.body_length);message[r.body_length]=0;}else e=HS_FAIL;}
 http_client_free(&r);return e;
}

hs_err_t hs_transport_yard_photo_poll(bool ready,char *message,size_t size){
 http_client_response_t r={0};const char *body=ready?"{\"ready\":true}":"{\"ready\":false}";
 hs_err_t e=request("/device/v1/yard/photos/00000000-0000-4000-8000-000000000000/status","POST","application/json",body,strlen(body),&r);
 if(!e&&r.body&&r.body_length<size){memcpy(message,r.body,r.body_length);message[r.body_length]=0;}else e=HS_FAIL;
 http_client_free(&r);return e;
}

int hs_recording_next(char id[37],char path[160]);
int hs_recording_sent(const char *id);
hs_err_t hs_transport_recording_sync(void){
 char id[37],path[160],route[160];if(hs_recording_next(id,path))return HS_OK;
 hs_file_info_t st;if(hs_fs_info(path,&st)||st.size<46||st.size>MAX_WAV)return HS_FAIL;
 unsigned char *bytes=tal_psram_malloc(st.size);if(!bytes)return HS_ERR_NO_MEM;
 hs_file_t f=hs_fs_open(path,"rb");if(!f){tal_psram_free(bytes);return HS_FAIL;}
 size_t n=hs_fs_read(bytes,st.size,f);int closed=hs_fs_close(f);http_client_response_t r={0};hs_err_t e=HS_FAIL;
 if(n==(size_t)st.size&&!closed){snprintf(route,sizeof(route),"/device/v1/yard/recordings/%s",id);e=request(route,"POST","audio/wav",bytes,n,&r);if(!e){char returned[40];if(text(&r,"id",returned,sizeof(returned))||strcmp(returned,id)||hs_recording_sent(id))e=HS_FAIL;}}
 http_client_free(&r);tal_psram_free(bytes);return e;
}

int hs_photo_next(char id[37],char path[160]);
hs_err_t hs_transport_photo_archive_sync(void){
 char id[37],path[160],route[160];if(hs_photo_next(id,path))return HS_OK;
 hs_file_info_t st;if(hs_fs_info(path,&st)||st.size<4||st.size>350000)return HS_FAIL;
 unsigned char *bytes=tal_psram_malloc(st.size);if(!bytes)return HS_ERR_NO_MEM;
 hs_file_t f=hs_fs_open(path,"rb");if(!f){tal_psram_free(bytes);return HS_FAIL;}
 size_t n=hs_fs_read(bytes,st.size,f);int closed=hs_fs_close(f);http_client_response_t r={0};hs_err_t e=HS_FAIL;
 if(n==(size_t)st.size&&!closed){snprintf(route,sizeof(route),"/device/v1/yard/photo-archive/%s",id);e=request(route,"POST","image/jpeg",bytes,n,&r);if(!e){char returned[40];if(text(&r,"id",returned,sizeof(returned))||strcmp(returned,id)||hs_recording_sent(id))e=HS_FAIL;}}
 http_client_free(&r);tal_psram_free(bytes);return e;
}

hs_err_t hs_transport_yard_active(void){http_client_response_t r={0};hs_err_t e=request("/device/v1/yard/activity","POST","application/json","{}",2,&r);http_client_free(&r);return e;}
