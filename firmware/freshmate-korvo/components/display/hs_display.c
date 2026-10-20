#include "hs_display.h"
#include "bsp/display.h"
#include "esp_lv_adapter.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include <stdio.h>
#include <string.h>
LV_FONT_DECLARE(hs_font);
static lv_obj_t *message, *network, *tabs[6];
static void (*navigate_cb)(int);
static void navigate(lv_event_t *e) {
  if(navigate_cb) navigate_cb((int)(intptr_t)lv_event_get_user_data(e));
}
void hs_display_navigation(void (*callback)(int)) {navigate_cb=callback;}
void hs_display_select_page(int page) {
  if(!bsp_display_lock(-1)) return;
  for(int i=0;i<6;i++) lv_obj_set_style_bg_color(tabs[i],lv_color_hex(i==page?0x336b4b:0x637569),0);
  bsp_display_unlock();
}
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
  lv_obj_align(message, LV_ALIGN_TOP_LEFT, 32, 130);
  lv_obj_set_height(message,265);
  lv_label_set_long_mode(message, LV_LABEL_LONG_DOT);
  lv_label_set_text(message, "按 SET 录音，按 MODE 拍照。联网后显示今日摘要。");
  const char *names[]={"今日","库存","临期","推荐","做饭","采购"};
  for(int i=0;i<6;i++) {
    tabs[i]=lv_button_create(screen);
    lv_obj_set_size(tabs[i],116,52);
    lv_obj_align(tabs[i],LV_ALIGN_BOTTOM_LEFT,32+i*123,-10);
    lv_obj_set_style_bg_color(tabs[i],lv_color_hex(i==0?0x336b4b:0x637569),0);
    lv_obj_t *label=lv_label_create(tabs[i]);lv_label_set_text(label,names[i]);lv_obj_center(label);
    lv_obj_add_event_cb(tabs[i],navigate,LV_EVENT_CLICKED,(void*)(intptr_t)i);
  }
  bsp_display_unlock();
  hs_display_text("按 SET 录音，按 MODE 拍照。联网后显示今日摘要。");
  hs_display_network("",false);
  return ESP_OK;
}
void hs_display_text(const char *text) {
  hs_display_snapshot_t previous;hs_display_snapshot(&previous);
  if(!strcmp(previous.text,text)) return;
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

esp_err_t hs_display_backlight(bool enabled) { return enabled?bsp_display_backlight_on():bsp_display_backlight_off(); }

static bool sleep_prepared;
esp_err_t hs_display_suspend(void) {
  esp_err_t err=esp_lv_adapter_sleep_prepare();
  if(err!=ESP_OK)return err;
  sleep_prepared=true;
  hs_display_backlight(false);
  return bsp_display_release_panel();
}
esp_err_t hs_display_resume(void) {
  if(!sleep_prepared)return hs_display_backlight(true);
  esp_lcd_panel_handle_t panel=NULL;
  esp_err_t err=bsp_display_new(NULL,&panel);
  if(err==ESP_OK)err=esp_lv_adapter_sleep_recover(bsp_display_get(),panel,NULL);
  if(err==ESP_OK){sleep_prepared=false;err=hs_display_backlight(true);}
  return err;
}
