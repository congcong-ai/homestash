/* 未移植的功能明确拒绝；不借用 ESP32 驱动或镜像安装器。 */
#include "hs_camera.h"
#include "hs_demo.h"
#include "hs_display.h"
#include "hs_ota.h"
#include "hs_power.h"
#include "hs_provisioning.h"
#include "hs_settings_ui.h"
#include <string.h>
hs_err_t hs_camera_path(const char *id, char *path, size_t size) {
  (void)id;
  (void)path;
  (void)size;
  return HS_ERR_NOT_SUPPORTED;
}
hs_err_t hs_camera_capture(const char *id) {
  (void)id;
  return HS_ERR_NOT_SUPPORTED;
}
int hs_camera_recover(char id[37]) {
  id[0] = 0;
  return 0;
}
hs_err_t hs_camera_complete(const char *id) {
  (void)id;
  return HS_ERR_NOT_SUPPORTED;
}
void hs_ota_status(hs_ota_status_t *s) {
  memset(s, 0, sizeof(*s));
  strcpy(s->message, "T5 尚未接入 HomeStash OTA，请使用原厂工具烧录。");
}
hs_err_t hs_ota_check(void) { return HS_ERR_NOT_SUPPORTED; }
hs_err_t hs_ota_install(void) { return HS_ERR_NOT_SUPPORTED; }
void hs_ota_boot_health(bool healthy) { (void)healthy; }
void hs_power_activity(bool active) { (void)active; }
const char *hs_power_state(void) { return "active"; }
hs_err_t hs_power_experiment(bool deep, unsigned seconds) {
  (void)deep;
  (void)seconds;
  return HS_ERR_NOT_SUPPORTED;
}
void hs_power_boot(void) {}
hs_err_t hs_provision_init(void) { return HS_ERR_NOT_SUPPORTED; }
hs_err_t hs_provision_start(void) { return HS_ERR_NOT_SUPPORTED; }
void hs_provision_stop(void) {}
bool hs_provision_active(void) { return false; }
void hs_provision_status(hs_provision_status_t *s) {
  memset(s, 0, sizeof(*s));
  strcpy(s->message, "T5 尚未接入蓝牙配网，请使用串口配置网络。");
}
hs_err_t hs_settings_ui_init(void (*action)(int)) {
  (void)action;
  return HS_OK;
}
void hs_settings_ui_busy(bool busy) { (void)busy; }
bool hs_settings_ui_active(void) { return false; }
void hs_settings_ui_show(bool show) {
  if (show)
    hs_display_text("T5 暂通过串口配置网络与 Core。");
}
void hs_demo_run(hs_queue_t inputs) { (void)inputs; }
void hs_demo_open_menu(hs_queue_t inputs) {
  (void)inputs;
  hs_display_text("T5 尚未移植离线演示馆，请使用联网功能。");
}
bool hs_demo_active(void) { return false; }
void hs_demo_ack(void) {}
