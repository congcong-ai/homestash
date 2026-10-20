/* 临时 BLE 无线探针：仅传输固定测试文本，不读取 Wi-Fi 或家庭数据。 */
#include <string.h>
#include "nvs_flash.h"
#include "esp_bt.h"
#include "esp_bt_main.h"
#include "esp_gap_ble_api.h"
#include "esp_gatts_api.h"
#include "esp_log.h"
static const char *TAG="无线实测";
static uint16_t service_uuid=0xfff0, char_uuid=0xfff1;
static uint16_t primary_uuid=ESP_GATT_UUID_PRI_SERVICE, declaration_uuid=ESP_GATT_UUID_CHAR_DECLARE;
static uint8_t properties=ESP_GATT_CHAR_PROP_BIT_READ|ESP_GATT_CHAR_PROP_BIT_WRITE;
static uint8_t initial[]="Korvo-ready";
static uint16_t handles[3];
static esp_ble_adv_params_t adv={.adv_int_min=0x40,.adv_int_max=0x80,.adv_type=ADV_TYPE_IND,.own_addr_type=BLE_ADDR_TYPE_PUBLIC,.channel_map=ADV_CHNL_ALL,.adv_filter_policy=ADV_FILTER_ALLOW_SCAN_ANY_CON_ANY};
static uint8_t raw_adv[]={2,1,6,3,3,0xf0,0xff,16,9,'H','o','m','e','S','t','a','s','h','-','P','r','o','b','e'};
static const esp_gatts_attr_db_t db[3]={
  {{ESP_GATT_AUTO_RSP},{ESP_UUID_LEN_16,(uint8_t*)&primary_uuid,ESP_GATT_PERM_READ,2,2,(uint8_t*)&service_uuid}},
  {{ESP_GATT_AUTO_RSP},{ESP_UUID_LEN_16,(uint8_t*)&declaration_uuid,ESP_GATT_PERM_READ,1,1,&properties}},
  {{ESP_GATT_AUTO_RSP},{ESP_UUID_LEN_16,(uint8_t*)&char_uuid,ESP_GATT_PERM_READ|ESP_GATT_PERM_WRITE,64,sizeof(initial)-1,initial}}
};
static void gap(esp_gap_ble_cb_event_t e,esp_ble_gap_cb_param_t *p) {
  if(e==ESP_GAP_BLE_ADV_DATA_RAW_SET_COMPLETE_EVT) ESP_ERROR_CHECK(esp_ble_gap_start_advertising(&adv));
  if(e==ESP_GAP_BLE_ADV_START_COMPLETE_EVT) ESP_LOGI(TAG,"BLE 广播启动 status=%d",p->adv_start_cmpl.status);
}
static void gatts(esp_gatts_cb_event_t e,esp_gatt_if_t g,esp_ble_gatts_cb_param_t *p) {
  switch(e) {
  case ESP_GATTS_REG_EVT:
    ESP_ERROR_CHECK(esp_ble_gap_set_device_name("HomeStash-Probe"));
    ESP_ERROR_CHECK(esp_ble_gatts_create_attr_tab(db,g,3,0));break;
  case ESP_GATTS_CREAT_ATTR_TAB_EVT:
    if(p->add_attr_tab.status!=ESP_GATT_OK || p->add_attr_tab.num_handle!=3) {ESP_LOGE(TAG,"GATT 创建失败");break;}
    memcpy(handles,p->add_attr_tab.handles,sizeof(handles));
    ESP_ERROR_CHECK(esp_ble_gatts_start_service(handles[0]));
    ESP_ERROR_CHECK(esp_ble_gap_config_adv_data_raw(raw_adv,sizeof(raw_adv)));break;
  case ESP_GATTS_CONNECT_EVT:ESP_LOGI(TAG,"BLE 已连接 conn=%u",p->connect.conn_id);break;
  case ESP_GATTS_DISCONNECT_EVT:
    ESP_LOGI(TAG,"BLE 已断开 reason=%u",p->disconnect.reason);
    ESP_ERROR_CHECK(esp_ble_gap_start_advertising(&adv));break;
  case ESP_GATTS_WRITE_EVT:
    if(!p->write.is_prep && p->write.handle==handles[2] && p->write.len<=64) {
      ESP_ERROR_CHECK(esp_ble_gatts_set_attr_value(handles[2],p->write.len,p->write.value));
      ESP_LOGI(TAG,"BLE 收到并保存测试数据 bytes=%u",p->write.len);
    }break;
  case ESP_GATTS_READ_EVT:ESP_LOGI(TAG,"BLE 读取 handle=%u",p->read.handle);break;
  default:break;
  }
}
void app_main(void) {
  ESP_ERROR_CHECK(nvs_flash_init()); /* 不擦除 NVS */
  esp_bt_controller_config_t cfg=BT_CONTROLLER_INIT_CONFIG_DEFAULT();
  ESP_ERROR_CHECK(esp_bt_controller_init(&cfg));
  ESP_ERROR_CHECK(esp_bt_controller_enable(ESP_BT_MODE_BLE));
  ESP_ERROR_CHECK(esp_bluedroid_init());
  ESP_ERROR_CHECK(esp_bluedroid_enable());
  ESP_ERROR_CHECK(esp_ble_gap_register_callback(gap));
  ESP_ERROR_CHECK(esp_ble_gatts_register_callback(gatts));
  ESP_ERROR_CHECK(esp_ble_gatts_app_register(0));
  ESP_LOGI(TAG,"控制器及 Bluedroid 初始化完成");
}
