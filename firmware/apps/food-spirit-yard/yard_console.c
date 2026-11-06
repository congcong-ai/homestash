#include "hs_runtime.h"
#include "hs_device_config.h"
#include "wifi_profiles.h"
#include "cJSON.h"
#include <stdio.h>
#include <string.h>
static void (*dispatch)(int);
/* 不回显命令：输入中可能包含 Wi-Fi 密码及设备 Token。 */
hs_err_t yard_console_command(const char *line) {
  if(!strcmp(line,"wifi-status")) {
    hs_wifi_status_t s;hs_wifi_status(&s);
    HS_LOGI("小院","Wi-Fi connected=%d connecting=%d saved=%d count=%u",s.connected,s.connecting,s.connection_saved,s.count);
    return HS_OK;
  }
  if(!strcmp(line,"wifi-scan"))return hs_wifi_scan();
  if(!strcmp(line,"wifi-reconnect")||!strcmp(line,"wifi-auto"))return hs_wifi_reconnect();
  if(!strcmp(line,"wifi-disconnect"))return hs_wifi_disconnect();
  if(!strcmp(line,"record")){if(dispatch)dispatch(1);return HS_OK;}
  if(!strcmp(line,"stop")){if(dispatch)dispatch(3);return HS_OK;}
  if(!strncmp(line,"screen ",7)&&line[7]>='0'&&line[7]<='5'&&!line[8]){if(dispatch)dispatch(10+line[7]-'0');return HS_OK;}
  bool wifi=!strncmp(line,"wifi-connect ",13), core=!strncmp(line,"core-config ",12);
  if(!wifi&&!core)return HS_ERR_NOT_SUPPORTED;
  cJSON *j=cJSON_ParseWithOpts(line+(wifi?13:12),NULL,1);
  if(!cJSON_IsObject(j)){cJSON_Delete(j);return HS_ERR_INVALID_ARG;}
  hs_err_t e=HS_ERR_INVALID_ARG;
  if(wifi){
    cJSON *ssid=cJSON_GetObjectItemCaseSensitive(j,"ssid"),*password=cJSON_GetObjectItemCaseSensitive(j,"password"),*open=cJSON_GetObjectItemCaseSensitive(j,"open"),*remember=cJSON_GetObjectItemCaseSensitive(j,"remember");
    if(cJSON_IsString(ssid)&&cJSON_IsString(password)&&strlen(ssid->valuestring)>0&&strlen(ssid->valuestring)<=32&&strlen(password->valuestring)<=64&&(!open||cJSON_IsBool(open))&&(!remember||cJSON_IsBool(remember))){
      hs_wifi_ap_t ap={.open=cJSON_IsTrue(open)};snprintf(ap.ssid,sizeof(ap.ssid),"%s",ssid->valuestring);
      e=hs_wifi_connect_remember(&ap,password->valuestring,!cJSON_IsFalse(remember));
    }
    if(cJSON_IsString(password))memset(password->valuestring,0,strlen(password->valuestring));
  }else{
    cJSON *url=cJSON_GetObjectItemCaseSensitive(j,"url"),*id=cJSON_GetObjectItemCaseSensitive(j,"deviceId"),*token=cJSON_GetObjectItemCaseSensitive(j,"token");
    if(cJSON_IsString(url)&&cJSON_IsString(id)&&cJSON_IsString(token))e=hs_device_config_save(url->valuestring,id->valuestring,token->valuestring);
    if(cJSON_IsString(token))memset(token->valuestring,0,strlen(token->valuestring));
  }
  cJSON_Delete(j);return e;
}
static void console(void *arg){
  (void)arg;char line[1024]={0};size_t n=0;bool overflow=false;
  for(;;){
    int c=hs_console_read_byte();if(c==EOF){hs_delay_ms(20);continue;}
    if(c=='\r'||c=='\n'){
      if(n||overflow){hs_err_t e=overflow?HS_ERR_INVALID_ARG:yard_console_command(line);HS_LOGI("小院","配置命令结果：%s",hs_error_name(e));}
      memset(line,0,sizeof(line));n=0;overflow=false;
    }else if(c==0)overflow=true;
    else if(n<sizeof(line)-1)line[n++]=(char)c;else overflow=true;
  }
}
bool yard_console_start(void (*callback)(int)){dispatch=callback;return hs_task_start(console,"小院配置",8192,3);}
