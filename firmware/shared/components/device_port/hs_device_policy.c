#include "hs_device_policy.h"
bool hs_device_action_supported(const hs_board_descriptor_t *board,hs_action_t action){
 if(!board)return false;
 uint32_t required=0;
 switch(action){
  case HS_ACTION_VOICE_TOGGLE:required=HS_CAP_AUDIO_INPUT|HS_CAP_AUDIO_OUTPUT|HS_CAP_PERSISTENT_STORAGE;break;
  case HS_ACTION_PHOTO:required=HS_CAP_CAMERA|HS_CAP_PERSISTENT_STORAGE;break;
  case HS_ACTION_OTA_CHECK:case HS_ACTION_OTA_INSTALL:required=HS_CAP_OTA;break;
  case HS_ACTION_SLEEP_LIGHT:case HS_ACTION_SLEEP_DEEP:required=HS_CAP_TIMER_SLEEP;break;
  case HS_ACTION_PROVISION_START:required=HS_CAP_BLE_PROVISIONING;break;
  default:break;
 }
 return (board->capabilities&required)==required;
}
