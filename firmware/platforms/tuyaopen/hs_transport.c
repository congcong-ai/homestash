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
#define MAX_WAV 1920044
static hs_err_t request(const char *route, const char *method, const char *type,
                        const void *body, size_t length,
                        http_client_response_t *response) {
  hs_device_config_t config;
  hs_device_config_get(&config);
  hs_endpoint_t endpoint;
  char path[512], auth[160];
  if (!config.token[0] || !hs_endpoint_parse(config.core_url, &endpoint))
    return HS_ERR_INVALID_STATE;
  if (endpoint.tls && !HS_CORE_CA[0])
    return HS_ERR_NOT_SUPPORTED;
  int n = snprintf(path, sizeof(path), "%s%s", endpoint.prefix, route);
  if (n < 0 || (size_t)n >= sizeof(path))
    return HS_ERR_INVALID_ARG;
  snprintf(auth, sizeof(auth), "Bearer %s", config.token);
  http_client_header_t headers[] = {{"Authorization", auth},
                                    {"X-Device-ID", config.device_id},
                                    {"Content-Type", type}};
  http_client_request_t r = {
      .host = endpoint.host,
      .port = endpoint.port,
      .path = path,
      .cacert = endpoint.tls ? (const uint8_t *)HS_CORE_CA : NULL,
      .cacert_len = endpoint.tls ? sizeof(HS_CORE_CA) : 0,
      .method = method,
      .headers = headers,
      .headers_count = 3,
      .body = body,
      .body_length = length,
      .timeout_ms = length || strstr(route, "/audio") ? 120000 : 5000};
  http_client_status_t status = http_client_request(&r, response);
  memset(auth, 0, sizeof(auth));
  memset(&config, 0, sizeof(config));
  if (status != HTTP_CLIENT_SUCCESS)
    return HS_ERR_HTTP_CONNECT;
  return response->status_code == 200 ? HS_OK : HS_FAIL;
}
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
hs_err_t hs_transport_capture(const char *id, char *message, size_t size) {
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
    if (!e)
      e = text(&response, "message", message, size);
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
  hs_err_t e = request(route, "GET", "application/json", NULL, 0, &r);
  if (!e && (r.body_length < 46 || r.body_length > MAX_WAV))
    e = HS_FAIL;
  if (!e) {
    hs_file_t f = hs_fs_open(HS_REPLY ".tmp", "wb");
    if (!f)
      e = HS_FAIL;
    else {
      if (hs_fs_write(r.body, r.body_length, f) != r.body_length ||
          hs_fs_sync(f))
        e = HS_FAIL;
      if (hs_fs_close(f))
        e = HS_FAIL;
    }
    if (!e && hs_outbox_replace_cache(HS_REPLY ".tmp", HS_REPLY))
      e = HS_FAIL;
  }
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
    cJSON_Delete(j);
  }
  http_client_free(&r);return e;
}
