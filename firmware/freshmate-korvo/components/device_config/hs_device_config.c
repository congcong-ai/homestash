#include "hs_device_config.h"
#include "local-network-config.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "http_parser.h"
#include "nvs.h"
#include <string.h>
#include <ctype.h>
static hs_device_config_t current;
static SemaphoreHandle_t lock;
static bool valid(const char *url,const char *id,const char *token) {
  if(!url || !id || !token || !*url || strlen(url)>350 || !*id || strlen(id)>64 || strlen(token)<32 || strlen(token)>128) return false;
  for(const char *p=url;*p;p++) if((unsigned char)*p<=32 || (unsigned char)*p>=127) return false;
  struct http_parser_url parsed;
  if(http_parser_parse_url(url,strlen(url),0,&parsed) || !(parsed.field_set&(1<<UF_HOST)) || !parsed.field_data[UF_HOST].len) return false;
  if(strncmp(url,"http://",7) && strncmp(url,"https://",8)) return false;
  if(parsed.field_set&((1<<UF_USERINFO)|(1<<UF_QUERY)|(1<<UF_FRAGMENT))) return false;
  for(const char *p=id;*p;p++) if(!(*p>='a' && *p<='z') && !isdigit((unsigned char)*p) && *p!='-') return false;
  for(const char *p=token;*p;p++) if((unsigned char)*p<=32 || (unsigned char)*p>=127) return false;
  return true;
}
void hs_device_config_get(hs_device_config_t *out) { xSemaphoreTake(lock,portMAX_DELAY);*out=current;xSemaphoreGive(lock); }
esp_err_t hs_device_config_save(const char *url,const char *id,const char *token) {
  if(!valid(url,id,token)) return ESP_ERR_INVALID_ARG;
  xSemaphoreTake(lock,portMAX_DELAY);
  hs_device_config_t next={0};strlcpy(next.core_url,url,sizeof(next.core_url));strlcpy(next.device_id,id,sizeof(next.device_id));strlcpy(next.token,token,sizeof(next.token));
  size_t n=strlen(next.core_url);while(n && next.core_url[n-1]=='/') next.core_url[--n]=0;
  next.revision=current.revision+1;
  nvs_handle_t h;esp_err_t err=nvs_open("hs_device",NVS_READWRITE,&h);
  if(err==ESP_OK) {err=nvs_set_blob(h,"config",&next,sizeof(next));if(err==ESP_OK)err=nvs_commit(h);nvs_close(h);}
  if(err==ESP_OK) current=next;
  memset(&next,0,sizeof(next));xSemaphoreGive(lock);return err;
}
esp_err_t hs_device_config_init(void) {
  lock=xSemaphoreCreateMutex();if(!lock)return ESP_ERR_NO_MEM;
  nvs_handle_t h;size_t size=sizeof(current);
  if(nvs_open("hs_device",NVS_READONLY,&h)==ESP_OK) {
    esp_err_t err=nvs_get_blob(h,"config",&current,&size);nvs_close(h);
    if(err==ESP_OK && size==sizeof(current) && memchr(current.core_url,0,sizeof(current.core_url)) && memchr(current.device_id,0,sizeof(current.device_id)) && memchr(current.token,0,sizeof(current.token)) && valid(current.core_url,current.device_id,current.token))return ESP_OK;
  }
  memset(&current,0,sizeof(current));
  if(valid(CONFIG_HS_CORE_URL,CONFIG_HS_DEVICE_ID,CONFIG_HS_DEVICE_TOKEN)) return hs_device_config_save(CONFIG_HS_CORE_URL,CONFIG_HS_DEVICE_ID,CONFIG_HS_DEVICE_TOKEN);
  return ESP_OK;
}
