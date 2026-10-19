#pragma once
#include <stdbool.h>
#include "esp_err.h"
#define HS_WIFI_SCAN_LIMIT 16
typedef struct {
  char ssid[33];
  int rssi;
  bool open, enterprise, configured;
} hs_wifi_ap_t;
typedef struct {
  hs_wifi_ap_t aps[HS_WIFI_SCAN_LIMIT];
  unsigned count, revision;
  bool scanning, connecting, connected, automatic;
  char ssid[33], message[160];
} hs_wifi_status_t;
void hs_wifi_profiles_start(void);
void hs_wifi_profiles_connected(void);
void hs_wifi_profiles_disconnected(void);
void hs_wifi_status(hs_wifi_status_t *status);
esp_err_t hs_wifi_scan(void);
esp_err_t hs_wifi_connect(const hs_wifi_ap_t *ap, const char *password);
esp_err_t hs_wifi_automatic(void);
