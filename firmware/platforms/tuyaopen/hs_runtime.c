#include "hs_runtime.h"
#include "board_com_api.h"
#include "tal_kv.h"
#include "tal_log.h"
#include "tal_memory.h"
#include "tal_mutex.h"
#include "tal_semaphore.h"
#include "tal_system.h"
#include "tal_thread.h"
#include "tkl_output.h"
#include "tal_uart.h"
#include "components/system.h"
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static bool product_uart_ready;
static MUTEX_HANDLE uart_log_lock;
typedef struct {
  MUTEX_HANDLE lock;
  SEM_HANDLE items, slots;
  unsigned head, count, capacity;
  size_t size;
  unsigned char data[];
} queue_t;
hs_queue_t hs_queue_create(unsigned n, size_t size) {
  if (!n || !size || size > (SIZE_MAX - sizeof(queue_t)) / n)
    return NULL;
  queue_t *q = tal_calloc(1, sizeof(*q) + n * size);
  if (!q)
    return NULL;
  if (tal_mutex_create_init(&q->lock) != OPRT_OK ||
      tal_semaphore_create_init(&q->items, 0, n) != OPRT_OK ||
      tal_semaphore_create_init(&q->slots, n, n) != OPRT_OK) {
    if (q->lock)
      tal_mutex_release(q->lock);
    if (q->items)
      tal_semaphore_release(q->items);
    if (q->slots)
      tal_semaphore_release(q->slots);
    tal_free(q);
    return NULL;
  }
  q->capacity = n;
  q->size = size;
  return q;
}
static bool enqueue(queue_t *q, const void *item, uint32_t ms, bool front) {
  if (!q || !item || tal_semaphore_wait(q->slots, ms) != OPRT_OK)
    return false;
  tal_mutex_lock(q->lock);
  if (front)
    q->head = (q->head + q->capacity - 1) % q->capacity;
  unsigned at = front ? q->head : (q->head + q->count) % q->capacity;
  memcpy(q->data + at * q->size, item, q->size);
  q->count++;
  tal_mutex_unlock(q->lock);
  tal_semaphore_post(q->items);
  return true;
}
bool hs_queue_send(hs_queue_t q, const void *item, uint32_t ms) {
  return enqueue(q, item, ms, false);
}
bool hs_queue_send_front(hs_queue_t q, const void *item, uint32_t ms) {
  return enqueue(q, item, ms, true);
}
bool hs_queue_receive(hs_queue_t handle, void *item, uint32_t ms) {
  queue_t *q = handle;
  if (!q || !item || tal_semaphore_wait(q->items, ms) != OPRT_OK)
    return false;
  tal_mutex_lock(q->lock);
  memcpy(item, q->data + q->head * q->size, q->size);
  q->head = (q->head + 1) % q->capacity;
  q->count--;
  tal_mutex_unlock(q->lock);
  tal_semaphore_post(q->slots);
  return true;
}
bool hs_task_start(void (*entry)(void *), const char *name, unsigned bytes,
                   unsigned priority) {
  THREAD_HANDLE h = NULL;
  THREAD_CFG_T cfg = {bytes, priority, (char *)name};
  return tal_thread_create_and_start(&h, NULL, NULL, entry, NULL, &cfg) ==
         OPRT_OK;
}
void hs_delay_ms(uint32_t ms) { tal_system_sleep(ms); }
static MUTEX_HANDLE clock_lock;
static uint32_t last_ms;
static uint64_t elapsed_ms;
int64_t hs_time_us(void) {
  tal_mutex_lock(clock_lock);
  uint32_t now = (uint32_t)tal_system_get_millisecond();
  elapsed_ms += (uint32_t)(now - last_ms);
  last_ms = now;
  int64_t result = (int64_t)elapsed_ms * 1000;
  tal_mutex_unlock(clock_lock);
  return result;
}
hs_err_t hs_random_bytes(void *data, size_t n) {
  if (!data && n)
    return HS_ERR_INVALID_ARG;
  unsigned char *p = data;
  for (size_t i = 0; i < n; i++)
    p[i] = (unsigned char)tal_system_get_random(256);
  return HS_OK;
}
hs_err_t hs_platform_init(void) {
  if (tal_mutex_create_init(&clock_lock) != OPRT_OK)
    return HS_ERR_NO_MEM;
  if (tal_mutex_create_init(&uart_log_lock) != OPRT_OK) return HS_ERR_NO_MEM;
  tal_log_init(TAL_LOG_LEVEL_WARN, 1024, (TAL_LOG_OUTPUT_CB)tkl_log_output);
  if (tal_kv_init(&(tal_kv_cfg_t){.seed = "homestash-t5-v1",
                                  .key = "hs-config-v1"}) != 0)
    return HS_FAIL;
  if (board_register_hardware() != OPRT_OK)
    return HS_FAIL;
  /* 小院 IMU 使用P00/P01。关闭原厂UART1日志，产品日志直接写UART0，保留配置RX。
   * S1 TX1/RX1须OFF隔离CH342F；TX0/RX0保留ON。 */
  bk_set_printf_enable(0);
  TAL_UART_CFG_T uart = {.rx_buffer_size = 2048,
                        .base_cfg = {.baudrate = 115200,
                              .databits = TUYA_UART_DATA_LEN_8BIT,
                              .stopbits = TUYA_UART_STOP_LEN_1BIT,
                              .parity = TUYA_UART_PARITY_TYPE_NONE,
                              .flowctrl = TUYA_UART_FLOWCTRL_NONE}};
  product_uart_ready = tal_uart_init(TUYA_UART_NUM_0, &uart) == OPRT_OK;
  return product_uart_ready ? HS_OK : HS_FAIL;
}
void hs_restart(void) { tal_system_reset(); }
int hs_console_read_byte(void) {
  unsigned char c;
  return tal_uart_read(TUYA_UART_NUM_0, &c, 1) == 1 ? c : EOF;
}
const char *hs_error_name(hs_err_t e) {
  switch (e) {
  case HS_OK:
    return "成功";
  case HS_ERR_NOT_SUPPORTED:
    return "尚未支持";
  case HS_ERR_INVALID_ARG:
    return "参数无效";
  case HS_ERR_INVALID_STATE:
    return "状态无效";
  case HS_ERR_NO_MEM:
    return "内存不足";
  default:
    return "操作失败";
  }
}
void hs_log(const char *level, const char *tag, const char *format, ...) {
  char msg[1200];
  int offset = snprintf(msg, sizeof(msg), "%s %s: ", level, tag);
  if (offset < 0 || (size_t)offset >= sizeof(msg))
    return;
  va_list args;
  va_start(args, format);
  vsnprintf(msg + offset, sizeof(msg) - (size_t)offset, format, args);
  va_end(args);
  if (product_uart_ready) {
    tal_mutex_lock(uart_log_lock);
    tal_uart_write(TUYA_UART_NUM_0, (const uint8_t *)msg, strlen(msg));
    tal_uart_write(TUYA_UART_NUM_0, (const uint8_t *)"\r\n", 2);
    tal_mutex_unlock(uart_log_lock);
  } else { tkl_log_output(msg); tkl_log_output("\r\n"); }
}
void hs_require(bool condition, const char *expression) {
  if (!condition) {
    hs_log("E", "FreshMate", "初始化失败：%s", expression);
    for (;;)
      hs_delay_ms(1000);
  }
}
