#include "hs_runtime.h"
#include "esp_log.h"
#include "esp_random.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "nvs_flash.h"
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
static TickType_t ticks(uint32_t ms) {
  return ms == HS_WAIT_FOREVER ? portMAX_DELAY : pdMS_TO_TICKS(ms);
}
hs_queue_t hs_queue_create(unsigned n, size_t size) {
  return xQueueCreate(n, size);
}
bool hs_queue_send(hs_queue_t q, const void *item, uint32_t ms) {
  return xQueueSend(q, item, ticks(ms)) == pdTRUE;
}
bool hs_queue_send_front(hs_queue_t q, const void *item, uint32_t ms) {
  return xQueueSendToFront(q, item, ticks(ms)) == pdTRUE;
}
bool hs_queue_receive(hs_queue_t q, void *item, uint32_t ms) {
  return xQueueReceive(q, item, ticks(ms)) == pdTRUE;
}
bool hs_task_start(void (*entry)(void *), const char *name, unsigned bytes,
                   unsigned priority) {
  return xTaskCreate(entry, name, bytes, NULL, priority, NULL) == pdPASS;
}
void hs_delay_ms(uint32_t ms) { vTaskDelay(ticks(ms)); }
int64_t hs_time_us(void) { return esp_timer_get_time(); }
hs_err_t hs_random_bytes(void *data, size_t n) {
  if (!data && n)
    return HS_ERR_INVALID_ARG;
  esp_fill_random(data, n);
  return HS_OK;
}
hs_err_t hs_platform_init(void) { return nvs_flash_init(); }
void hs_restart(void) { esp_restart(); }
const char *hs_error_name(hs_err_t error) { return esp_err_to_name(error); }
void hs_log(const char *level, const char *tag, const char *format, ...) {
  va_list args;
  va_start(args, format);
  esp_log_level_t severity = level[0] == 'E'   ? ESP_LOG_ERROR
                             : level[0] == 'W' ? ESP_LOG_WARN
                                               : ESP_LOG_INFO;
  esp_log_write(severity, tag, "%s (%lu) %s: ", level,
                (unsigned long)esp_log_timestamp(), tag);
  esp_log_writev(severity, tag, format, args);
  esp_log_write(severity, tag, "\n");
  va_end(args);
}
void hs_require(bool ok, const char *expression) {
  if (!ok) {
    hs_log("E", "FreshMate", "初始化失败：%s", expression);
    abort();
  }
}

int hs_console_read_byte(void) { return getchar(); }
