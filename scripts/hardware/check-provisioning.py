#!/usr/bin/env python3
"""主机编译真实BLE配置逻辑；测试校验、幂等和提交边界，不替代BLE/密码学真机测试。"""
from pathlib import Path
import subprocess, tempfile
root = Path(__file__).resolve().parents[2]
cjson = root / 'firmware/freshmate-korvo/managed_components/espressif__cjson/cJSON'
with tempfile.TemporaryDirectory(prefix='homestash-provision-') as directory:
    tmp = Path(directory)
    (tmp / 'common.h').write_text('''#pragma once
#include <stdint.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <assert.h>
#include <setjmp.h>
typedef int esp_err_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_ERR_NO_MEM 1
#define ESP_ERR_INVALID_ARG 2
#define ESP_ERR_INVALID_STATE 3
#define ESP_LOG_WARN 2
#define ESP_LOGI(...) ((void)0)
#define ESP_LOGW(...) ((void)0)
#define portMAX_DELAY 0
#define pdPASS 1
#define pdMS_TO_TICKS(x) (x)
#define PSA_SUCCESS 0
#define PSA_ALG_SHA_256 1
typedef void *SemaphoreHandle_t;
typedef struct {int unused;} protocomm_t;
typedef struct {const char *name;uint16_t uuid;} protocomm_ble_name_uuid_t;
typedef struct {char device_name[30];uint8_t service_uuid[16];int nu_lookup_count;protocomm_ble_name_uuid_t *nu_lookup;} protocomm_ble_config_t;
typedef struct {const uint8_t *data;uint16_t len;} protocomm_security1_params_t;
static int protocomm_security1;
void *xSemaphoreCreateMutex(void);int xSemaphoreTake(void*,int);int xSemaphoreGive(void*);
int xTaskCreate(void (*)(void*),const char*,int,void*,int,void*);void vTaskDelay(int);
int64_t esp_timer_get_time(void);void esp_fill_random(void*,size_t);unsigned esp_random(void);
const char *esp_err_to_name(int);void esp_log_level_set(const char*,int);
int psa_crypto_init(void);int psa_hash_compute(int,const unsigned char*,size_t,unsigned char*,size_t,size_t*);
protocomm_t *protocomm_new(void);void protocomm_delete(protocomm_t*);
int protocomm_ble_start(protocomm_t*,const protocomm_ble_config_t*);int protocomm_ble_stop(protocomm_t*);
int protocomm_set_security(protocomm_t*,const char*,const void*,const void*);
int protocomm_add_endpoint(protocomm_t*,const char*,int (*)(uint32_t,const uint8_t*,ssize_t,uint8_t**,ssize_t*,void*),void*);
''')
    for path in ['esp_err.h','esp_random.h','esp_timer.h','esp_log.h','protocomm.h','protocomm_ble.h','protocomm_security1.h','psa/crypto.h','freertos/FreeRTOS.h','freertos/semphr.h','freertos/task.h']:
        file = tmp / path;file.parent.mkdir(parents=True, exist_ok=True);file.write_text('#include "common.h"\n')
    (tmp / 'test.c').write_text(f'#include "{root}/firmware/freshmate-korvo/components/provisioning/hs_provisioning.c"\n' + r'''
static int64_t now=1000;static unsigned seed;
static unsigned connections,saves,cancels,stops;static bool fail;
static hs_wifi_status_t wifi;static hs_device_config_t core={.revision=7};static jmp_buf done;
void *xSemaphoreCreateMutex(void){return (void*)1;}int xSemaphoreTake(void*a,int b){return 1;}int xSemaphoreGive(void*a){return 1;}
int xTaskCreate(void(*f)(void*),const char*s,int n,void*a,int p,void*h){return 1;}
void vTaskDelay(int ms){now+=(int64_t)ms*1000;if(!state.applying)longjmp(done,1);}
int64_t esp_timer_get_time(void){return now;}void esp_fill_random(void*p,size_t n){memset(p,++seed,n);}unsigned esp_random(void){return ++seed;}
const char *esp_err_to_name(int n){return "状态";}void esp_log_level_set(const char*s,int n){}
int psa_crypto_init(void){return 0;}
/* 仅提供确定性摘要桩，测试重放分支；不验证或代替SDK的SHA-256。 */
int psa_hash_compute(int alg,const unsigned char*d,size_t n,unsigned char*out,size_t cap,size_t*size){uint32_t h=2166136261;for(size_t i=0;i<n;i++)h=(h^d[i])*16777619;for(unsigned i=0;i<32;i++)out[i]=(h>>(8*(i%4)))&255;*size=32;return 0;}
protocomm_t *protocomm_new(void){return calloc(1,sizeof(protocomm_t));}void protocomm_delete(protocomm_t*p){free(p);}
int protocomm_ble_start(protocomm_t*p,const protocomm_ble_config_t*c){return 0;}int protocomm_ble_stop(protocomm_t*p){stops++;return 0;}
int protocomm_set_security(protocomm_t*p,const char*s,const void*a,const void*b){return 0;}
int protocomm_add_endpoint(protocomm_t*p,const char*s,int(*f)(uint32_t,const uint8_t*,ssize_t,uint8_t**,ssize_t*,void*),void*a){return 0;}
void hs_device_config_get(hs_device_config_t*out){*out=core;}
int hs_device_config_validate(const char*u,const char*i,const char*t){return !strncmp(u,"http://",7)&&*i&&strlen(t)>=32?0:2;}
int hs_device_config_save(const char*u,const char*i,const char*t){saves++;core.revision++;strlcpy(core.core_url,u,sizeof(core.core_url));return 0;}
void hs_wifi_status(hs_wifi_status_t*out){*out=wifi;}
int hs_wifi_connect(const hs_wifi_ap_t*ap,const char*p){connections++;wifi.connection_revision++;strlcpy(wifi.ssid,ap->ssid,sizeof(wifi.ssid));wifi.connected=!fail;wifi.connection_saved=!fail;return fail?ESP_FAIL:ESP_OK;}
int hs_wifi_cancel_connection(void){cancels++;return 0;}
static cJSON *call(const char*s){uint8_t*out=NULL;ssize_t n=0;assert(endpoint(1,(const uint8_t*)s,strlen(s),&out,&n,NULL)==0);assert(!strstr((char*)out,state.proof)||!*state.proof);cJSON*j=cJSON_Parse((char*)out);free(out);assert(j);return j;}
static bool code(cJSON*j,const char*s){bool ok=!strcmp(cJSON_GetObjectItem(j,"state")->valuestring,s);cJSON_Delete(j);return ok;}
static const char *request="{\"op\":\"configure\",\"requestId\":\"00000000-0000-4000-8000-000000000001\",\"wifi\":{\"ssid\":\"Home\",\"password\":\"password123\",\"open\":false},\"core\":{\"url\":\"http://core:3101\",\"deviceId\":\"freshmate\",\"token\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}}";
static void tick(void){if(!setjmp(done))worker(NULL);}
int main(void){
 assert(hs_provision_init()==0);assert(!hs_provision_active());assert(hs_provision_start()==0);assert(hs_provision_start()==ESP_ERR_INVALID_STATE);
 char proof[17];strcpy(proof,state.proof);assert(strlen(proof)==16);
 assert(code(call("{\"op\":\"status\"}"),"waiting"));
 assert(code(call("{\"op\":\"configure\",\"wifi\":{}}"),"rejected"));assert(!queued&&connections==0&&saves==0);
 char *bad=strdup(request);char *p=strstr(bad,"password123");memset(p,'x',11);p[0]='\\';p[1]='u';p[2]='0';p[3]='0';p[4]='0';p[5]='0';assert(code(call(bad),"rejected"));free(bad);
 assert(code(call(request),"connecting"));assert(queued&&saves==0&&connections==0);assert(code(call(request),"connecting"));
 bad=strdup(request);p=strstr(bad,"password123");p[0]='z';assert(code(call(bad),"rejected"));free(bad);
 tick();assert(saves==1&&connections==1&&!state.applying);assert(code(call(request),"saved"));assert(saves==1);
 bad=strdup(request);p=strstr(bad,"000000000001");p[11]='2';fail=true;assert(code(call(bad),"connecting"));tick();assert(saves==1);assert(code(call(request),"rejected"));free(bad);fail=false;
 strlcpy(state.state,"saved",sizeof(state.state));close_after=now+1;
 now=close_after+1;tick();assert(!hs_provision_active()&&!state.proof[0]&&stops==1);
 assert(hs_provision_start()==0);assert(strcmp(proof,state.proof));fail=true;assert(code(call(request),"connecting"));tick();assert(saves==1&&cancels==2&&!strcmp(state.state,"failed"));
 hs_provision_stop();tick();assert(!hs_provision_active());
 assert(hs_provision_start()==0);assert(code(call(request),"connecting"));hs_provision_stop();tick();assert(connections==3&&saves==1&&!hs_provision_active());
 puts("通过：默认关闭、随机窗口、字段/空字符拒绝、相同请求重放/冲突、仅联网后提交、连接失败不改Core、关闭清理PoP、取消排队配置；传输与密码学为桩，不代表真机。");
}
''')
    includes = [tmp, cjson] + [root / f'firmware/freshmate-korvo/components/{c}/include' for c in ['provisioning','network','device_config']]
    command = ['cc','-fsanitize=address,undefined','-Wno-unused-parameter']
    for path in includes: command += ['-I', str(path)]
    subprocess.run(command + [str(tmp/'test.c'), str(cjson/'cJSON.c'), '-o', str(tmp/'test')], check=True)
    subprocess.run([str(tmp/'test')], check=True)
