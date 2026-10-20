#pragma once
#include <stdbool.h>
#include "esp_err.h"
esp_err_t hs_display_init(void);
void hs_display_text(const char *text);
void hs_display_network(const char *ssid, bool connected);
#include <stdint.h>
typedef struct { char text[1024]; char network[96]; uint32_t revision; } hs_display_snapshot_t;
void hs_display_snapshot(hs_display_snapshot_t *snapshot);
void hs_display_navigation(void (*navigate)(int));
void hs_display_select_page(int page);

esp_err_t hs_display_backlight(bool enabled);

esp_err_t hs_display_suspend(void);
esp_err_t hs_display_resume(void);
