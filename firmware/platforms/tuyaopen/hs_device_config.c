#include "hs_device_config.h"
#include "hs_build_config.h"
#include "hs_endpoint.h"
#include "hs_runtime.h"
#include "tal_kv.h"
#include "tal_mutex.h"
#include <stdio.h>
#include <string.h>
static MUTEX_HANDLE lock;
static hs_device_config_t current;
hs_err_t hs_device_config_validate(const char *url, const char *id,
                                   const char *token) {
  hs_endpoint_t endpoint;
  if (!hs_endpoint_parse(url, &endpoint) || !id || !token || !*id ||
      strlen(id) > 64 || strlen(token) < 32 || strlen(token) > 128)
    return HS_ERR_INVALID_ARG;
  for (const char *p = id; *p; p++)
    if (!((*p >= 'a' && *p <= 'z') || (*p >= '0' && *p <= '9') || *p == '-'))
      return HS_ERR_INVALID_ARG;
  for (const unsigned char *p = (const unsigned char *)token; *p; p++)
    if (*p <= 32 || *p >= 127)
      return HS_ERR_INVALID_ARG;
  if (endpoint.tls && !HS_CORE_CA[0])
    return HS_ERR_NOT_SUPPORTED;
  return HS_OK;
}
void hs_device_config_get(hs_device_config_t *out) {
  tal_mutex_lock(lock);
  *out = current;
  tal_mutex_unlock(lock);
}
hs_err_t hs_device_config_save(const char *url, const char *id,
                               const char *token) {
  hs_err_t e = hs_device_config_validate(url, id, token);
  if (e)
    return e;
  tal_mutex_lock(lock);
  hs_device_config_t next = {0};
  snprintf(next.core_url, sizeof(next.core_url), "%s", url);
  size_t n = strlen(next.core_url);
  while (n && next.core_url[n - 1] == '/')
    next.core_url[--n] = 0;
  snprintf(next.device_id, sizeof(next.device_id), "%s", id);
  snprintf(next.token, sizeof(next.token), "%s", token);
  next.revision = current.revision + 1;
  e = tal_kv_set("hs.device.v1", (const uint8_t *)&next, sizeof(next)) == 0
          ? HS_OK
          : HS_FAIL;
  if (!e)
    current = next;
  memset(&next, 0, sizeof(next));
  tal_mutex_unlock(lock);
  return e;
}
hs_err_t hs_device_config_init(void) {
  if (tal_mutex_create_init(&lock) != OPRT_OK)
    return HS_ERR_NO_MEM;
  uint8_t *bytes = NULL;
  size_t n = 0;
  if (!tal_kv_get("hs.device.v1", &bytes, &n) && n == sizeof(current)) {
    hs_device_config_t saved;
    memcpy(&saved, bytes, n);
    tal_kv_free(bytes);
    bytes = NULL;
    if (memchr(saved.core_url, 0, sizeof(saved.core_url)) &&
        memchr(saved.device_id, 0, sizeof(saved.device_id)) &&
        memchr(saved.token, 0, sizeof(saved.token)) &&
        hs_device_config_validate(saved.core_url, saved.device_id,
                                  saved.token) == HS_OK) {
      current = saved;
      return HS_OK;
    }
  }
  if (bytes)
    tal_kv_free(bytes);
  return hs_device_config_validate(HS_CORE_URL, HS_DEVICE_ID,
                                   HS_DEVICE_TOKEN) == HS_OK
             ? hs_device_config_save(HS_CORE_URL, HS_DEVICE_ID, HS_DEVICE_TOKEN)
             : HS_OK;
}
