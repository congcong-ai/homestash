/* 引脚、外设创建与按键映射只属于Korvo适配器；继续复用已验证的原厂BSP。 */
#include "hs_board.h"
#include "bsp/button.h"
#include "esp_log.h"
static void (*dispatch)(hs_action_t);
/* 标记同时用于Core识别镜像板型；不能仅按同一芯片推断兼容。 */
static const char firmware_target[]="HS_TARGET_V1:esp32-s31-korvo-1-v1.1";
static const hs_board_descriptor_t board={
 .id=firmware_target+sizeof("HS_TARGET_V1:")-1,.chip="esp32s31",
 .capabilities=HS_CAP_AUDIO_INPUT|HS_CAP_AUDIO_OUTPUT|HS_CAP_CAMERA|HS_CAP_DISPLAY|
 HS_CAP_TOUCH|HS_CAP_BUTTONS|HS_CAP_WIFI|HS_CAP_BLE_PROVISIONING|HS_CAP_OTA|
 HS_CAP_PERSISTENT_STORAGE|HS_CAP_TIMER_SLEEP
};
const hs_board_descriptor_t *hs_board_descriptor(void){return &board;}
bool hs_board_has(hs_capability_t capability){return (board.capabilities&capability)==capability;}
static void pressed(void *handle,void *arg){(void)handle;ESP_LOGI("FreshMate按键","BSP action=%d",(int)(intptr_t)arg);if(dispatch)dispatch((hs_action_t)(intptr_t)arg);}
esp_err_t hs_board_inputs_init(void (*callback)(hs_action_t)){
 if(!callback || dispatch)return ESP_ERR_INVALID_STATE;
 button_handle_t buttons[BSP_BUTTON_NUM];
 esp_err_t e=bsp_iot_button_create(buttons,NULL,BSP_BUTTON_NUM);if(e!=ESP_OK)return e;
 dispatch=callback;
 e=iot_button_register_cb(buttons[BSP_BUTTON_SET],BUTTON_SINGLE_CLICK,NULL,pressed,(void*)(intptr_t)HS_ACTION_VOICE_TOGGLE);
 if(e!=ESP_OK)return e;
 e=iot_button_register_cb(buttons[BSP_BUTTON_MODE],BUTTON_LONG_PRESS_START,NULL,pressed,(void*)(intptr_t)30);
 if(e!=ESP_OK)return e;
 e=iot_button_register_cb(buttons[BSP_BUTTON_VOLUP],BUTTON_SINGLE_CLICK,NULL,pressed,(void*)(intptr_t)31);
 if(e!=ESP_OK)return e;
 e=iot_button_register_cb(buttons[BSP_BUTTON_VOLDOWN],BUTTON_SINGLE_CLICK,NULL,pressed,(void*)(intptr_t)32);
 if(e!=ESP_OK)return e;
 return iot_button_register_cb(buttons[BSP_BUTTON_MODE],BUTTON_SINGLE_CLICK,NULL,pressed,(void*)(intptr_t)HS_ACTION_PHOTO);
}
