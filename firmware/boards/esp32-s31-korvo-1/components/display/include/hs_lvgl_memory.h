#pragma once
/* LVGL官方大数组属性：64KiB界面堆放入PSRAM，内部DRAM留给无线控制器和DMA。 */
#include "esp_attr.h"
#define LV_ATTRIBUTE_LARGE_RAM_ARRAY EXT_RAM_BSS_ATTR
