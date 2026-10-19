#include "hs_display.h"
#include "bsp/display.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include <stdio.h>
#include <string.h>
LV_FONT_DECLARE(hs_font);
static lv_obj_t *message, *network;
static portMUX_TYPE screen_guard=portMUX_INITIALIZER_UNLOCKED;
static hs_display_snapshot_t current;
void hs_display_snapshot(hs_display_snapshot_t *snapshot) {
  portENTER_CRITICAL(&screen_guard);*snapshot=current;portEXIT_CRITICAL(&screen_guard);
}
esp_err_t hs_display_init(void) {
  if (!bsp_display_start()) return ESP_FAIL;
  if (!bsp_display_lock(-1)) return ESP_FAIL;
  lv_obj_t *screen = lv_screen_active();
  lv_obj_set_style_bg_color(screen, lv_color_hex(0xf4f7ef), 0);
  lv_obj_set_style_text_font(screen, &hs_font, 0);
  lv_obj_t *title = lv_label_create(screen);
  lv_label_set_text(title, "FreshMate / HomeStash");
  lv_obj_align(title, LV_ALIGN_TOP_LEFT, 32, 28);
  network = lv_label_create(screen);
  lv_obj_align(network, LV_ALIGN_TOP_LEFT, 32, 90);
  lv_label_set_text(network, "网络未连接");
  message = lv_label_create(screen);
  lv_obj_set_width(message, 730);
  lv_obj_align(message, LV_ALIGN_TOP_LEFT, 32, 165);
  lv_label_set_text(message, "按 SET 开始录音，再按停止。最长六十秒。");
  bsp_display_unlock();
  hs_display_text("按 SET 开始录音，再按停止。最长六十秒。");
  hs_display_network("",false);
  return ESP_OK;
}
void hs_display_text(const char *text) {
  if (!message || !bsp_display_lock(-1)) return;
  lv_label_set_text(message, text);
  portENTER_CRITICAL(&screen_guard);
  snprintf(current.text,sizeof(current.text),"%s",text);current.revision++;
  portEXIT_CRITICAL(&screen_guard);
  bsp_display_unlock();
  ESP_LOGI("FreshMate", "LCD: %s",text);
}
void hs_display_network(const char *ssid, bool connected) {
  if (!network || !bsp_display_lock(-1)) return;
  lv_label_set_text_fmt(network, "%s %s", connected ? "网络已连接" : "网络未连接", ssid);
  portENTER_CRITICAL(&screen_guard);
  snprintf(current.network,sizeof(current.network),"%s %s",connected ? "网络已连接" : "网络未连接",ssid);current.revision++;
  portEXIT_CRITICAL(&screen_guard);
  bsp_display_unlock();
}
