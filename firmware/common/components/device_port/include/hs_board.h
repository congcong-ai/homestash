#pragma once
#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"
/* 业务事件与物理SET/MODE/GPIO分离；值保留既有调试协议兼容性。 */
typedef enum {
 HS_ACTION_VOICE_TOGGLE=1, HS_ACTION_STATUS=2, HS_ACTION_PHOTO=3,
 HS_ACTION_PAGE_HOME=10, HS_ACTION_PAGE_INVENTORY=11, HS_ACTION_PAGE_FRESHNESS=12,
 HS_ACTION_PAGE_RECIPES=13, HS_ACTION_PAGE_COOKING=14, HS_ACTION_PAGE_SHOPPING=15,
 HS_ACTION_OTA_CHECK=20, HS_ACTION_OTA_INSTALL=21, HS_ACTION_SLEEP_LIGHT=22,
 HS_ACTION_SLEEP_DEEP=23, HS_ACTION_PROVISION_START=24, HS_ACTION_PROVISION_STOP=25
} hs_action_t;
typedef enum {
 HS_CAP_AUDIO_INPUT=1u<<0, HS_CAP_AUDIO_OUTPUT=1u<<1, HS_CAP_CAMERA=1u<<2,
 HS_CAP_DISPLAY=1u<<3, HS_CAP_TOUCH=1u<<4, HS_CAP_BUTTONS=1u<<5,
 HS_CAP_WIFI=1u<<6, HS_CAP_BLE_PROVISIONING=1u<<7, HS_CAP_OTA=1u<<8,
 HS_CAP_PERSISTENT_STORAGE=1u<<9, HS_CAP_TIMER_SLEEP=1u<<10
} hs_capability_t;
typedef struct { const char *id; const char *chip; uint32_t capabilities; } hs_board_descriptor_t;
const hs_board_descriptor_t *hs_board_descriptor(void);
bool hs_board_has(hs_capability_t capability);
esp_err_t hs_board_inputs_init(void (*callback)(hs_action_t));
