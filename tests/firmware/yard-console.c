#include "hs_runtime.h"
#include "wifi_profiles.h"
#include <assert.h>
#include <stdarg.h>
#include <string.h>
#include <stdio.h>
hs_err_t yard_console_command(const char *line);
static int connected,saved;
hs_err_t hs_wifi_connect_remember(const hs_wifi_ap_t *a,const char *p,bool r){assert(!strcmp(a->ssid,"测试网络"));assert(!strcmp(p,"test-password"));connected++;saved=r;return HS_OK;}
hs_err_t hs_device_config_save(const char *u,const char *i,const char *t){assert(!strcmp(u,"http://host:3101"));assert(!strcmp(i,"t5-kitchen"));assert(strlen(t)==32);return HS_OK;}
void hs_wifi_status(hs_wifi_status_t *s){memset(s,0,sizeof(*s));}
hs_err_t hs_wifi_scan(void){return HS_OK;}
hs_err_t hs_wifi_reconnect(void){return HS_OK;}
hs_err_t hs_wifi_disconnect(void){return HS_OK;}
void hs_log(const char *l,const char *t,const char *fmt,...){(void)l;(void)t;(void)fmt;}
int hs_console_read_byte(void){return EOF;}
void hs_delay_ms(uint32_t ms){(void)ms;}
const char *hs_error_name(hs_err_t e){(void)e;return "测试";}
bool hs_task_start(void (*f)(void *),const char *n,unsigned s,unsigned p){(void)f;(void)n;(void)s;(void)p;return true;}
int main(void){
 assert(yard_console_command("wifi-connect {\"ssid\":\"测试网络\",\"password\":\"test-password\",\"remember\":false}")==HS_OK);assert(connected==1&&!saved);
 assert(yard_console_command("wifi-connect {\"ssid\":\"测试网络\",\"password\":\"test-password\"}")==HS_OK);assert(connected==2&&saved);
 assert(yard_console_command("wifi-connect {\"ssid\":23,\"password\":\"private\"}")==HS_ERR_INVALID_ARG);
 assert(yard_console_command("wifi-connect {\"ssid\":\"测试网络\",\"password\":\"test-password\"} garbage")==HS_ERR_INVALID_ARG);
 assert(yard_console_command("wifi-connect {}")==HS_ERR_INVALID_ARG);
 assert(yard_console_command("core-config {\"url\":\"http://host:3101\",\"deviceId\":\"t5-kitchen\",\"token\":\"12345678901234567890123456789012\"}")==HS_OK);
 assert(yard_console_command("imu-probe")==HS_ERR_NOT_SUPPORTED);
 assert(yard_console_command("imu-reset")==HS_ERR_NOT_SUPPORTED);
 assert(yard_console_command("imu-raw")==HS_ERR_NOT_SUPPORTED);
 assert(yard_console_command("camera-probe")==HS_ERR_NOT_SUPPORTED);
 assert(yard_console_command("wifi-status")==HS_OK);assert(yard_console_command("invalid")==HS_ERR_NOT_SUPPORTED);
 puts("通过：Wi-Fi/Core 配置解析、remember 语义、错误字段和尾随数据拒绝");return 0;
}
