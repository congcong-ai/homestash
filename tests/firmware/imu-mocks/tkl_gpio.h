#pragma once
#include <stdbool.h>
typedef int TUYA_GPIO_NUM_E;
typedef int TUYA_GPIO_LEVEL_E;
enum {TUYA_GPIO_NUM_0=0,TUYA_GPIO_NUM_1=1,TUYA_GPIO_PULLUP=2,TUYA_GPIO_PUSH_PULL=3,TUYA_GPIO_INPUT=4,TUYA_GPIO_OUTPUT=5,TUYA_GPIO_LEVEL_LOW=0,TUYA_GPIO_LEVEL_HIGH=1,OPRT_OK=0};
typedef struct{int mode,direct,level;}TUYA_GPIO_BASE_CFG_T;
int tkl_gpio_init(int,const TUYA_GPIO_BASE_CFG_T*);
int tkl_gpio_read(int,int*);
