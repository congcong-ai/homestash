#!/usr/bin/env python3
"""在临时目录编译真实 WiFi 管理代码，用模拟 SDK/事件验证连接、切换和保存逻辑。"""
from pathlib import Path
import subprocess, tempfile
# 来源：只读 SmartBadge/scripts/hardware/check-wifi-profiles.py，适配 HomeStash 接口；使用虚构测试凭据。
root=Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory(prefix='homestash-wifi-') as directory:
 tmp=Path(directory);(tmp/'freertos').mkdir()
 common=r'''#pragma once
 #include <assert.h>
 #include <stdbool.h>
 #include <stdint.h>
 #include <stddef.h>
 #include <stdio.h>
 #include <string.h>
 #include <stdlib.h>
 typedef int esp_err_t;
 #define ESP_OK 0
 #define ESP_FAIL -1
 #define ESP_ERR_TIMEOUT 2
 #define ESP_ERR_INVALID_STATE 3
 #define ESP_ERR_INVALID_ARG 4
 #define ESP_ERR_NO_MEM 5
 #define ESP_ERROR_CHECK(x) assert((x)==0)
 #define ESP_LOGI(...) ((void)0)
 #define ESP_LOGW(...) ((void)0)
 typedef unsigned EventBits_t;
 typedef void *EventGroupHandle_t;
 typedef void *QueueHandle_t;
 typedef int portMUX_TYPE;
 #define portMUX_INITIALIZER_UNLOCKED 0
 #define portENTER_CRITICAL(x) ((void)0)
 #define portEXIT_CRITICAL(x) ((void)0)
 #define pdTRUE 1
 #define pdFALSE 0
 #define pdPASS 1
 #define pdMS_TO_TICKS(x) (x)
 #define vTaskDelay(x) ((void)0)
 #define WIFI_AUTH_OPEN 0
 #define WIFI_AUTH_WPA2_PSK 3
 #define WIFI_AUTH_WPA2_ENTERPRISE 5
 #define WIFI_IF_STA 0
 #define WIFI_STORAGE_RAM 0
 #define WIFI_MODE_STA 1
 #define WIFI_PS_NONE 0
 #define ESP_EAP_TYPE_PEAP 1
 #define ESP_EAP_TYPE_TTLS 2
 #define ESP_EAP_TTLS_PHASE2_MSCHAPV2 0
 #define NVS_READONLY 0
 #define NVS_READWRITE 1
 typedef int nvs_handle_t;
 typedef struct {uint8_t ssid[33];int rssi;int authmode;} wifi_ap_record_t;
 typedef struct {bool show_hidden;} wifi_scan_config_t;
 typedef struct {struct {uint8_t ssid[32],password[64];struct {int authmode;} threshold;} sta;} wifi_config_t;
 int64_t esp_timer_get_time(void);
 unsigned xEventGroupSetBits(void *,unsigned);
 unsigned xEventGroupClearBits(void *,unsigned);
 unsigned xEventGroupWaitBits(void *,unsigned,int,int,int);
 void *xEventGroupCreate(void);
 void *xQueueCreate(int,size_t);
 int xQueueSend(void *,const void *,int);
 int xQueueReceive(void *,void *,int);
 int xTaskCreate(void (*)(void *),const char *,int,void *,int,void *);
 int esp_wifi_scan_start(void *,bool);
 int esp_wifi_scan_get_ap_records(uint16_t *,wifi_ap_record_t *);
 int esp_wifi_set_config(int,const wifi_config_t *);
 int esp_wifi_connect(void);
 int esp_wifi_stop(void);
 int esp_wifi_disconnect(void);
 int nvs_open(const char *,int,nvs_handle_t *);
 int nvs_get_str(int,const char *,char *,size_t *);
 int nvs_set_str(int,const char *,const char *);
 int nvs_commit(int);
 void nvs_close(int);
 #define esp_wifi_clear_ap_list() 0
 #define esp_wifi_set_storage(x) 0
 #define esp_wifi_set_mode(x) 0
 #define esp_wifi_start() 0
 #define esp_wifi_set_ps(x) 0
 '''
 for f in ['esp_wifi_sta_enterprise_disable','esp_eap_client_clear_identity','esp_eap_client_clear_username','esp_eap_client_clear_password','esp_eap_client_clear_ca_cert','esp_eap_client_set_identity','esp_eap_client_set_username','esp_eap_client_set_password','esp_eap_client_set_ca_cert','esp_eap_client_set_domain_name','esp_eap_client_set_disable_time_check','esp_eap_client_set_eap_methods','esp_eap_client_set_ttls_phase2_method','esp_wifi_sta_enterprise_enable']:
  common+=f'#define {f}(...) 0\n'
 (tmp/'common.h').write_text(common)
 (tmp/'hs_display.h').write_text('#include "common.h"\nvoid hs_display_network(const char *,bool);\n')
 for name in ['esp_err.h','esp_timer.h','esp_eap_client.h','esp_wifi.h','esp_log.h','freertos/FreeRTOS.h','freertos/event_groups.h','freertos/task.h','freertos/queue.h','nvs.h']:
  (tmp/name).write_text('#include "common.h"\n')
 (tmp/'local-network-config.h').write_text('''#define CONFIG_HS_WIFI_SSID "Home"
 #define CONFIG_HS_WIFI_PASSWORD "home-password"
 #define CONFIG_HS_WIFI_OFFICE_SSID "Office"
 #define CONFIG_HS_WIFI_OFFICE_PASSWORD "office-password"
 #define CONFIG_HS_WIFI_OFFICE_IDENTITY "identity"
 #define CONFIG_HS_WIFI_OFFICE_USERNAME "user"
 #define CONFIG_HS_WIFI_OFFICE_DOMAIN "example.test"
 #define CONFIG_HS_NETWORK_MODE 0
 #define CONFIG_HS_BUILD_EPOCH 0
 static const unsigned char office_ca[]="";
 ''')
 (tmp/'test.c').write_text(f'#include "{root}/firmware/common/components/network/wifi_profiles.c"\n'+r'''
 #include <setjmp.h>
 static jmp_buf end;
 static unsigned event_bits;
 static int step, scenario, connect_count, stop_count, saved_count;
 static int64_t now;
 static request_t queue[4];static int length;
 static char stored_ssid[33],stored_password[65];
 static wifi_config_t configured;
 static bool ui_connected;
 static wifi_ap_record_t aps[]={
  {.ssid="Home",.rssi=-55,.authmode=WIFI_AUTH_WPA2_PSK},
  {.ssid="Cafe",.rssi=-30,.authmode=WIFI_AUTH_WPA2_PSK},
  {.ssid="Cafe",.rssi=-60,.authmode=WIFI_AUTH_WPA2_PSK},
  {.ssid="Open",.rssi=-65,.authmode=WIFI_AUTH_OPEN},
  {.ssid="Enterprise",.rssi=-45,.authmode=WIFI_AUTH_WPA2_ENTERPRISE}};
 int64_t esp_timer_get_time(void){return now;}
 void hs_display_network(const char *s,bool c){ui_connected=c;}
 void *xEventGroupCreate(void){return (void*)1;}
 void *xQueueCreate(int n,size_t size){return (void*)1;}
 unsigned xEventGroupSetBits(void *g,unsigned b){return event_bits|=b;}
 unsigned xEventGroupClearBits(void *g,unsigned b){return event_bits&=~b;}
 int xQueueSend(void *q,const void *r,int t){if(length==4)return 0;queue[length++]=*(request_t*)r;return 1;}
 int xQueueReceive(void *q,void *r,int t){if(!length)return 0;*(request_t*)r=queue[0];memmove(queue,queue+1,--length*sizeof(*queue));return 1;}
 int xTaskCreate(void (*f)(void*),const char *s,int n,void *a,int p,void *h){return 1;}
 int esp_wifi_scan_start(void *s,bool b){return 0;}
 int esp_wifi_scan_get_ap_records(uint16_t *n,wifi_ap_record_t *out){*n=sizeof(aps)/sizeof(*aps);memcpy(out,aps,sizeof(aps));return 0;}
 int esp_wifi_set_config(int i,const wifi_config_t *c){configured=*c;return 0;}
 int esp_wifi_stop(void){stop_count++;return 0;}
 int esp_wifi_disconnect(void){return 0;}
 int esp_wifi_connect(void){connect_count++;if(scenario==0)event_bits|=connect_count==3?DISCONNECTED:CONNECTED;return 0;}
 int nvs_open(const char *s,int mode,nvs_handle_t *h){*h=1;return mode==NVS_READONLY&&!stored_ssid[0]?1:0;}
 int nvs_get_str(int h,const char *key,char *out,size_t *n){strlcpy(out,!strcmp(key,"ssid")?stored_ssid:stored_password,*n);return 0;}
 int nvs_set_str(int h,const char *key,const char *v){if(!strcmp(key,"ssid"))strlcpy(stored_ssid,v,sizeof(stored_ssid));else strlcpy(stored_password,v,sizeof(stored_password));return 0;}
 int nvs_commit(int h){saved_count++;return 0;}
 void nvs_close(int h){}
 unsigned xEventGroupWaitBits(void *g,unsigned b,int c,int a,int wait){
  step++;now+=scenario?10000000:1000000;
  if(scenario==0){
   hs_wifi_ap_t cafe={.ssid="Cafe"};
   if(step==3){assert(status.connected&&ui_connected&&connect_count==1);assert(hs_wifi_connect(&cafe,"password123")==0);}
   if(step==5){assert(status.connected&&!status.automatic&&saved_count==1);assert(!strcmp(stored_ssid,"Cafe"));assert(!strcmp(stored_password,"password123"));assert(hs_wifi_scan()==0);}
   if(step==6){assert(connect_count==2&&stop_count==2&&status.connected);assert(hs_wifi_connect(&cafe,"wrong-password")==0);}
   if(step==8){assert(!status.connected&&!status.connecting&&!status.automatic);assert(saved_count==1);assert(strstr(status.message,"未连接"));assert(hs_wifi_scan()==0);}
   if(step==9){assert(connect_count==3);assert(hs_wifi_automatic()==0);}
   if(step==11){assert(status.connected&&status.automatic);assert(connect_count==4);assert(!memcmp(configured.sta.ssid,"Cafe",4));request_t pause_request={.kind=4};assert(submit(&pause_request)==ESP_OK);}
   if(step==12){assert(paused&&!status.connected);assert(hs_wifi_scan()==ESP_OK);}
   if(step==13){assert(paused&&connect_count==4);request_t resume_request={.kind=5};assert(submit(&resume_request)==ESP_OK);}
   if(step==15){assert(!paused&&status.connected&&connect_count==5);assert(!strcmp(stored_ssid,"Cafe"));longjmp(end,1);}
  } else if(scenario==2){
   if(step==2){assert(status.connecting&&!status.connection_saved&&status.connection_revision==1);assert(hs_wifi_cancel_connection()==ESP_OK);}
   if(step==3){assert(saved_count==1);assert(!strcmp(stored_password,"password123"));assert(!memcmp(configured.sta.password,"password123",11));assert(status.automatic);longjmp(end,1);}
  } else if(step==2){assert(hs_wifi_scan()==0);}
 else if(step==3){assert(status.connecting&&strstr(status.message,"请稍后"));}
 else if(step==6){assert(!status.connecting&&!status.connected);assert(strstr(status.message,"超时"));longjmp(end,1);}
  unsigned result=event_bits;event_bits=0;return result;
 }
 int main(void){
  events=(void*)1;commands=(void*)1;
  assert(scan_networks()==0);assert(status.count==4); // 重名 AP 去重
 aps[0].ssid[0]=0;assert(scan_networks()==-1);strcpy((char *)aps[0].ssid,"Home"); // 默认网络不可见
  strlcpy(saved_ssid,"Cafe",sizeof(saved_ssid));strlcpy(saved_password,"password123",sizeof(saved_password));
  assert(scan_networks()==2); // 保存过的网络优先
  blocked_until[2]=now+30000000;assert(scan_networks()==0); // 失败网络暂避
  saved_ssid[0]=0;blocked_until[2]=0;
  if(!setjmp(end))manager(NULL);
  assert(saved_count==1);scenario=1;step=0;now=100000000;event_bits=0;length=0;
  memset(&status,0,sizeof(status));memset(blocked_until,0,sizeof(blocked_until));
  if(!setjmp(end))manager(NULL);
  scenario=2;step=0;now=200000000;event_bits=0;length=0;memset(&status,0,sizeof(status));memset(blocked_until,0,sizeof(blocked_until));
  hs_wifi_ap_t cancelled={.ssid="Cafe"};assert(hs_wifi_connect(&cancelled,"wrong-password")==ESP_OK);
  if(!setjmp(end))manager(NULL);
  char ssid32[33];memset(ssid32,'S',32);ssid32[32]=0;
  char key64[65];memset(key64,'a',64);key64[64]=0;
  assert(configure_manual(ssid32,key64,false)==0);assert(!memcmp(configured.sta.ssid,ssid32,32));assert(!memcmp(configured.sta.password,key64,64));
  assert(configure_manual("Open","",true)==0&&configured.sta.threshold.authmode==WIFI_AUTH_OPEN);
  puts("通过：自动选网、去重、保存网络优先、失败暂避、手动切换、成功后保存、错误密码不覆盖保存、连接中扫描保护、恢复自动、连接超时、开放网络、32字节SSID/64位密钥、维护暂停拒绝扫描、恢复已保存网络");
 }
 ''')
 subprocess.run(['cc','-w','-fsanitize=address,undefined','-I',str(tmp),'-I',str(root/'firmware/common/components/network/include'),str(tmp/'test.c'),'-o',str(tmp/'test')],check=True)
 subprocess.run([str(tmp/'test')],check=True)
