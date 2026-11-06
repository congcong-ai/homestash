#pragma once
#include "hs_error.h"
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
/* 超时使用毫秒；HS_WAIT_FOREVER 表示阻塞，0 表示非阻塞。 */
#define HS_WAIT_FOREVER UINT32_MAX
typedef void *hs_queue_t;
hs_queue_t hs_queue_create(unsigned length, size_t item_size);
bool hs_queue_send(hs_queue_t queue, const void *item, uint32_t timeout_ms);
bool hs_queue_send_front(hs_queue_t queue, const void *item,
                         uint32_t timeout_ms);
bool hs_queue_receive(hs_queue_t queue, void *item, uint32_t timeout_ms);
bool hs_task_start(void (*entry)(void *), const char *name,
                   unsigned stack_bytes, unsigned priority);
void hs_delay_ms(uint32_t ms);
int64_t hs_time_us(void);
hs_err_t hs_random_bytes(void *data, size_t length);
hs_err_t hs_platform_init(void);
void hs_restart(void);
int hs_console_read_byte(void);
const char *hs_error_name(hs_err_t error);
void hs_log(const char *level, const char *tag, const char *format, ...);
void hs_require(bool condition, const char *expression);
#define HS_CHECK(expr) hs_require((expr) == HS_OK, #expr)
#define HS_ASSERT(expr) hs_require(!!(expr), #expr)
#define HS_LOGI(tag, ...) hs_log("I", tag, __VA_ARGS__)
#define HS_LOGW(tag, ...) hs_log("W", tag, __VA_ARGS__)
#define HS_LOGE(tag, ...) hs_log("E", tag, __VA_ARGS__)
