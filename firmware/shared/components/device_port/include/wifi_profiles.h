#pragma once
#include <stdbool.h>
#include "hs_error.h"
#define HS_WIFI_SCAN_LIMIT 16
typedef struct {
  char ssid[33];
  int rssi;
  bool open, enterprise, configured, remembered;
} hs_wifi_ap_t;
typedef struct {
  hs_wifi_ap_t aps[HS_WIFI_SCAN_LIMIT];
  unsigned count, revision, connection_revision;
  bool connection_saved;
  bool scanning, connecting, connected, automatic;
  char ssid[33], message[160];
} hs_wifi_status_t;
void hs_wifi_profiles_start(void);
void hs_wifi_profiles_connected(void);
void hs_wifi_profiles_disconnected(void);
void hs_wifi_status(hs_wifi_status_t *status);
hs_err_t hs_wifi_scan(void);
hs_err_t hs_wifi_connect(const hs_wifi_ap_t *ap, const char *password);
hs_err_t hs_wifi_automatic(void);

/* 维护期间由管理任务停用网络；恢复时优先使用已保存网络。 */
hs_err_t hs_wifi_pause(bool paused);

hs_err_t hs_wifi_reconnect(void);
hs_err_t hs_wifi_cancel_connection(void);

hs_err_t hs_wifi_connect_remember(const hs_wifi_ap_t *ap,const char *password,bool remember);
hs_err_t hs_wifi_disconnect(void);
