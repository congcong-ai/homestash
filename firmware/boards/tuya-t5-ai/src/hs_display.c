#include "hs_display.h"
#include "board_com_api.h"
#include "hs_runtime.h"
#include "lv_vendor.h"
#include "lvgl.h"
#include "tal_mutex.h"
#include "tdd_disp_ili9488.h"
#include "tdd_touch_gt1151.h"
#include <stdio.h>
#include <string.h>
LV_FONT_DECLARE(hs_font);
static MUTEX_HANDLE lock;
static hs_display_snapshot_t snapshot;
static void (*navigate)(int);
static lv_obj_t *content, *network, *buttons[6];
static unsigned rendered;
static int selected;
/* 独立登记同一块原厂 LCD，要求 SDK 在初始化时分配旋转缓冲区。
 * 仅在 LVGL 初始化之后修改 rotation 会缺少该缓冲区。引脚来自 V1.02 BSP。 */
static hs_err_t register_landscape(void) {
  DISP_RGB_DEVICE_CFG_T cfg = {0};
  cfg.sw_spi_cfg.spi_clk = TUYA_GPIO_NUM_49;
  cfg.sw_spi_cfg.spi_csx = TUYA_GPIO_NUM_48;
  cfg.sw_spi_cfg.spi_sda = TUYA_GPIO_NUM_50;
  cfg.sw_spi_cfg.spi_dc = TUYA_GPIO_NUM_MAX;
  cfg.sw_spi_cfg.spi_rst = TUYA_GPIO_NUM_53;
  cfg.bl.type = TUYA_DISP_BL_TP_GPIO;
  cfg.bl.gpio.pin = TUYA_GPIO_NUM_9;
  cfg.bl.gpio.active_level = TUYA_GPIO_LEVEL_HIGH;
  cfg.width = 320;
  cfg.height = 480;
  cfg.pixel_fmt = TUYA_PIXEL_FMT_RGB565;
  cfg.rotation = TUYA_DISPLAY_ROTATION_90;
  cfg.power.pin = TUYA_GPIO_NUM_MAX;
  if (tdd_disp_rgb_ili9488_register("homestash-t5-lcd", &cfg) != OPRT_OK)
    return HS_FAIL;
  /* SDK 按同一个名字查找显示与触摸设备，保留物理坐标给 LVGL 旋转。 */
  TDD_TOUCH_GT1151_INFO_T touch = {
      .i2c_cfg = {.port = TUYA_I2C_NUM_0,
                  .scl_pin = TUYA_GPIO_NUM_13,
                  .sda_pin = TUYA_GPIO_NUM_15},
      .tp_cfg = {.x_max = 320, .y_max = 480}};
  return tdd_touch_i2c_gt1151_register("homestash-t5-lcd", &touch) == OPRT_OK
             ? HS_OK
             : HS_FAIL;
}
static void clicked(lv_event_t *e) {
  int page = (int)(intptr_t)lv_event_get_user_data(e);
  tal_mutex_lock(lock);
  void (*callback)(int) = navigate;
  tal_mutex_unlock(lock);
  if (callback)
    callback(page);
}
static void refresh(lv_timer_t *timer) {
  (void)timer;
  hs_display_snapshot_t s;
  hs_display_snapshot(&s);
  if (s.revision != rendered) {
    lv_label_set_text(content, s.text);
    lv_label_set_text(network, s.network);
    rendered = s.revision;
  }
  tal_mutex_lock(lock);
  int current = selected;
  tal_mutex_unlock(lock);
  for (int i = 0; i < 6; i++)
    lv_obj_set_style_bg_color(
        buttons[i], lv_color_hex(i == current ? 0x275A49 : 0xE8EEEA), 0);
}
hs_err_t hs_display_init(void) {
  if (tal_mutex_create_init(&lock) != OPRT_OK)
    return HS_ERR_NO_MEM;
  if (register_landscape() != HS_OK)
    return HS_FAIL;
  lv_vendor_init("homestash-t5-lcd");
  lv_obj_t *screen = lv_screen_active();
  if (!screen)
    return HS_FAIL;
  int width = lv_display_get_horizontal_resolution(NULL);
  int height = lv_display_get_vertical_resolution(NULL);
  if (width < 240 || height < 240)
    return HS_ERR_NOT_SUPPORTED;
  int columns = width >= 480 ? 6 : 3;
  int rows = (6 + columns - 1) / columns;
  int button_width = (width - 12 - (columns - 1) * 5) / columns;
  int panel_top = 46 + rows * 54 + 2;
  lv_obj_remove_flag(screen, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_set_style_bg_color(screen, lv_color_hex(0xF5F7F3), 0);
  lv_obj_set_style_text_font(screen, &hs_font, 0);
  lv_obj_set_style_text_color(screen, lv_color_hex(0x263B32), 0);
  network = lv_label_create(screen);
  lv_obj_set_pos(network, 12, 8);
  lv_obj_set_width(network, width - 24);
  lv_label_set_long_mode(network, LV_LABEL_LONG_DOT);
  lv_label_set_text(network, "网络未连接");
  static const char *names[] = {"小院", "食灵", "接话", "留影", "回忆", "设置"};
  for (int i = 0; i < 6; i++) {
    buttons[i] = lv_button_create(screen);
    lv_obj_set_pos(buttons[i], 6 + (i % columns) * (button_width + 5),
                   46 + (i / columns) * 54);
    lv_obj_set_size(buttons[i], button_width, 48);
    lv_obj_set_style_radius(buttons[i], 10, 0);
    lv_obj_add_event_cb(buttons[i], clicked, LV_EVENT_CLICKED,
                        (void *)(intptr_t)i);
    lv_obj_t *label = lv_label_create(buttons[i]);
    lv_label_set_text(label, names[i]);
    lv_obj_center(label);
  }
  lv_obj_t *panel = lv_obj_create(screen);
  lv_obj_set_pos(panel, 6, panel_top);
  lv_obj_set_size(panel, width - 12, height - panel_top - 6);
  lv_obj_set_style_pad_all(panel, 10, 0);
  content = lv_label_create(panel);
  lv_obj_set_width(content, width - 40);
  lv_label_set_long_mode(content, LV_LABEL_LONG_WRAP);
  lv_label_set_text(content, "正在启动，请稍候。");
  lv_timer_create(refresh, 100, NULL);
  lv_vendor_start(5, 8192);
  HS_LOGI("display", "resolution=%dx%d navigation=%dx%d", width, height,
          columns, rows);
  return HS_OK;
}
void hs_display_text(const char *text) {
  tal_mutex_lock(lock);
  snprintf(snapshot.text, sizeof(snapshot.text), "%s", text ? text : "");
  snapshot.revision++;
  tal_mutex_unlock(lock);
}
void hs_display_network(const char *ssid, bool connected) {
  tal_mutex_lock(lock);
  char next[96];
  snprintf(next, sizeof(next), connected ? "已连接：%s" : "网络未连接",
           ssid ? ssid : "");
  if (strcmp(next, snapshot.network)) {
    snprintf(snapshot.network, sizeof(snapshot.network), "%s", next);
    snapshot.revision++;
  }
  tal_mutex_unlock(lock);
}
void hs_display_snapshot(hs_display_snapshot_t *out) {
  tal_mutex_lock(lock);
  *out = snapshot;
  tal_mutex_unlock(lock);
}
void hs_display_navigation(void (*callback)(int)) {
  tal_mutex_lock(lock);
  navigate = callback;
  tal_mutex_unlock(lock);
}
void hs_display_select_page(int page) {
  tal_mutex_lock(lock);
  if (page >= 0 && page < 6)
    selected = page;
  tal_mutex_unlock(lock);
}
hs_err_t hs_display_backlight(bool enabled) {
  (void)enabled;
  return HS_ERR_NOT_SUPPORTED;
}
hs_err_t hs_display_suspend(void) { return HS_ERR_NOT_SUPPORTED; }
hs_err_t hs_display_resume(void) { return HS_ERR_NOT_SUPPORTED; }
void hs_display_backend(bool connected) { (void)connected; }
void hs_display_dialogue(int state) { (void)state; }
