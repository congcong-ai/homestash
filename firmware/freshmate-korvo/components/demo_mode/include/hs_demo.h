#pragma once
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
/* 离线主页：SET进入正常产品；PLAY进入演示。返回前恢复产品屏幕。 */
void hs_demo_run(QueueHandle_t inputs);

void hs_demo_open_menu(QueueHandle_t inputs);

#include <stdbool.h>
bool hs_demo_active(void);

void hs_demo_ack(void);
