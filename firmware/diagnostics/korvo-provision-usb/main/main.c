/* BLE 加密配网与 USB-A 专项诊断，结束后恢复 FreshMate 和测试前 NVS。 */
#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "esp_event.h"
#include "esp_wifi.h"
#include "esp_netif.h"
#include "esp_system.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "network_provisioning/manager.h"
#include "network_provisioning/scheme_ble.h"
#include "protocomm.h"
#include "probe_private.h"
#include "factory_demo_usb_hid.h"
static const char *TAG="配网与USB实测";
static bool restoring;
static bool cleanup;
static unsigned failures;
static void event(void *arg,esp_event_base_t base,int32_t id,void *data) {
    if(base==NETWORK_PROV_EVENT) {
        if(id==NETWORK_PROV_START) ESP_LOGI(TAG,"BLE 加密配网已启动，等待客户端下发凭据");
        if(id==NETWORK_PROV_WIFI_CRED_RECV) ESP_LOGI(TAG,"已通过 BLE 收到 Wi-Fi 凭据（不回显内容）");
        if(id==NETWORK_PROV_WIFI_CRED_FAIL) {
            ESP_LOGW(TAG,"配网连接失败 reason=%d，可重新提交",*(network_prov_wifi_sta_fail_reason_t*)data);
            network_prov_mgr_reset_wifi_sm_state_on_failure();
        }
        if(id==NETWORK_PROV_WIFI_CRED_SUCCESS) ESP_LOGI(TAG,"配网管理器确认联网成功");
        if(id==NETWORK_PROV_END) {ESP_LOGI(TAG,"BLE 配网窗口已关闭");network_prov_mgr_deinit();}
    }
    if(base==PROTOCOMM_SECURITY_SESSION_EVENT && id==PROTOCOMM_SECURITY_SESSION_SETUP_OK)
        ESP_LOGI(TAG,"Security 1 加密会话建立成功");
    if(base==IP_EVENT && id==IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *ip=data;
        ESP_LOGI(TAG,"%s已获得IP：" IPSTR,restoring?"重启后按保存配置重连，":"BLE 配网后，",IP2STR(&ip->ip_info.ip));
        if(!cleanup) {
            nvs_handle_t h;ESP_ERROR_CHECK(nvs_open("hs_ble_test",NVS_READWRITE,&h));
            ESP_ERROR_CHECK(nvs_set_u8(h,"ready",1));ESP_ERROR_CHECK(nvs_commit(h));nvs_close(h);
        }
    }
    if(base==WIFI_EVENT && id==WIFI_EVENT_STA_START && restoring) esp_wifi_connect();
    if(base==WIFI_EVENT && id==WIFI_EVENT_STA_DISCONNECTED && restoring && failures++<8) esp_wifi_connect();
}
static void console(void *arg) {
    char line[32];size_t n=0;
    for(;;) {
        int c=getchar();
        if(c==EOF){vTaskDelay(pdMS_TO_TICKS(20));continue;}
        if(c=='\n' || c=='\r') {
            line[n]=0;if(!strcmp(line,"reboot"))esp_restart();
            if(!strcmp(line,"restore-config")) {
                cleanup=true;esp_wifi_stop();
                nvs_handle_t h;wifi_config_t previous={0},check={0};size_t length=sizeof(previous);
                ESP_ERROR_CHECK(nvs_open("hs_ble_test",NVS_READWRITE,&h));
                ESP_ERROR_CHECK(nvs_get_blob(h,"previous",&previous,&length));
                ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_FLASH));
                ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA,&previous));
                ESP_ERROR_CHECK(esp_wifi_get_config(WIFI_IF_STA,&check));
                /* 驱动可规范化内部/保留字段；核对实际网络配置，不比较结构体填充。 */
                bool same=!memcmp(previous.sta.ssid,check.sta.ssid,sizeof(previous.sta.ssid))
                    && !memcmp(previous.sta.password,check.sta.password,sizeof(previous.sta.password))
                    && previous.sta.bssid_set==check.sta.bssid_set
                    && (!previous.sta.bssid_set || !memcmp(previous.sta.bssid,check.sta.bssid,sizeof(previous.sta.bssid)));
                if(!same) {nvs_close(h);ESP_LOGE(TAG,"配置恢复核验失败，测试前副本已保留");n=0;continue;}
                ESP_ERROR_CHECK(nvs_erase_all(h));ESP_ERROR_CHECK(nvs_commit(h));nvs_close(h);
                memset(&previous,0,sizeof(previous));memset(&check,0,sizeof(check));
                ESP_LOGI(TAG,"通过 Wi-Fi API 恢复测试前配置并核对一致；仅清理测试命名空间，未擦除NVS分区");
            }
            n=0;
        } else if(n<sizeof(line)-1)line[n++]=c;
    }
}
void app_main(void) {
    esp_log_level_set("security1",ESP_LOG_WARN);
    ESP_ERROR_CHECK(nvs_flash_init());
    nvs_handle_t h;uint8_t ready=0;
    if(nvs_open("hs_ble_test",NVS_READONLY,&h)==ESP_OK){nvs_get_u8(h,"ready",&ready);nvs_close(h);}
    restoring=ready==1;
    ESP_ERROR_CHECK(esp_netif_init());ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();
    wifi_init_config_t wifi=WIFI_INIT_CONFIG_DEFAULT();ESP_ERROR_CHECK(esp_wifi_init(&wifi));
    if(!restoring) {
        wifi_config_t previous={0};ESP_ERROR_CHECK(esp_wifi_get_config(WIFI_IF_STA,&previous));
        ESP_ERROR_CHECK(nvs_open("hs_ble_test",NVS_READWRITE,&h));
        ESP_ERROR_CHECK(nvs_set_blob(h,"previous",&previous,sizeof(previous)));ESP_ERROR_CHECK(nvs_commit(h));nvs_close(h);
        memset(&previous,0,sizeof(previous));
    }
    ESP_ERROR_CHECK(esp_event_handler_register(NETWORK_PROV_EVENT,ESP_EVENT_ANY_ID,event,NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT,ESP_EVENT_ANY_ID,event,NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT,IP_EVENT_STA_GOT_IP,event,NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(PROTOCOMM_SECURITY_SESSION_EVENT,ESP_EVENT_ANY_ID,event,NULL));
    if(restoring) {
        ESP_LOGI(TAG,"读取到配网成功标记；不启动BLE，验证已保存网络");
        ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));ESP_ERROR_CHECK(esp_wifi_start());
    } else {
        network_prov_mgr_config_t config={.scheme=network_prov_scheme_ble,.scheme_event_handler=NETWORK_PROV_SCHEME_BLE_EVENT_HANDLER_FREE_BTDM};
        ESP_ERROR_CHECK(network_prov_mgr_init(config));
        ESP_ERROR_CHECK(network_prov_mgr_start_provisioning(NETWORK_PROV_SECURITY_1,HS_PROBE_POP,"HS-Provision-Test",NULL));
    }
    static factory_usb_hid_t usb;
    ESP_ERROR_CHECK(factory_usb_hid_init(&usb));
    xTaskCreate(console,"测试控制",3072,NULL,3,NULL);
    unsigned old_input=0,old_connect=0,old_disconnect=0;
    for(;;) {
        factory_usb_hid_snapshot_t s;factory_usb_hid_get_snapshot(&usb,&s);
        if(s.input_count!=old_input || s.connect_count!=old_connect || s.disconnect_count!=old_disconnect) {
            ESP_LOGI(TAG,"USB-A 类型=%s 连接=%u 断开=%u 输入报告=%u 位移=(%d,%d)",s.device,s.connect_count,s.disconnect_count,s.input_count,s.mouse_x,s.mouse_y);
            old_input=s.input_count;old_connect=s.connect_count;old_disconnect=s.disconnect_count;
        }
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}
