#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
/* 不接受用户信息、查询参数及片段，避免配置注入请求路径或鉴权头。 */
typedef struct {
  char host[256], prefix[351];
  uint16_t port;
  bool tls;
} hs_endpoint_t;
static inline bool hs_endpoint_parse(const char *url, hs_endpoint_t *out) {
  if (!url || !out || strlen(url) > 350)
    return false;
  hs_endpoint_t e = {0};
  const char *host;
  if (!strncmp(url, "http://", 7)) {
    host = url + 7;
    e.port = 80;
  } else if (!strncmp(url, "https://", 8)) {
    host = url + 8;
    e.port = 443;
    e.tls = true;
  } else
    return false;
  for (const unsigned char *p = (const unsigned char *)url; *p; p++)
    if (*p <= 32 || *p >= 127 || *p == '@' || *p == '?' || *p == '#' ||
        *p == '\\')
      return false;
  const char *end = strchr(host, '/');
  if (!end)
    end = host + strlen(host);
  const char *port = NULL, *hostend = end;
  if (host < end && *host == '[') {
    host++;
    hostend = memchr(host, ']', (size_t)(end - host));
    if (!hostend || hostend == host)
      return false;
    if (hostend + 1 < end) {
      if (hostend[1] != ':')
        return false;
      port = hostend + 2;
    }
  } else {
    const char *colon = memchr(host, ':', (size_t)(end - host));
    if (colon) {
      hostend = colon;
      port = colon + 1;
    }
    for (const char *p = host; p < hostend; p++)
      if (!((*p >= 'a' && *p <= 'z') || (*p >= 'A' && *p <= 'Z') ||
            (*p >= '0' && *p <= '9') || *p == '-' || *p == '.'))
        return false;
  }
  if (hostend == host || (size_t)(hostend - host) >= sizeof(e.host))
    return false;
  if (port) {
    unsigned n = 0;
    if (port == end)
      return false;
    for (const char *p = port; p < end; p++) {
      if (*p < '0' || *p > '9')
        return false;
      n = n * 10 + (unsigned)(*p - '0');
      if (n > 65535)
        return false;
    }
    if (!n)
      return false;
    e.port = (uint16_t)n;
  }
  memcpy(e.host, host, (size_t)(hostend - host));
  strcpy(e.prefix, end);
  size_t n = strlen(e.prefix);
  while (n && e.prefix[n - 1] == '/')
    e.prefix[--n] = 0;
  *out = e;
  return true;
}
