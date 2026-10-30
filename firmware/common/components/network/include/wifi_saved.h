#pragma once
#include <stdint.h>
#include <stdbool.h>
#include <string.h>
#define HS_WIFI_SAVED_MAX 8
typedef struct {char ssid[33],password[65];} hs_wifi_saved_entry_t;
typedef struct {uint32_t version,count;hs_wifi_saved_entry_t entries[HS_WIFI_SAVED_MAX];} hs_wifi_saved_t;
static inline int hs_wifi_saved_find(const hs_wifi_saved_t *s,const char *ssid){for(unsigned i=0;i<s->count;i++)if(!strcmp(s->entries[i].ssid,ssid))return (int)i;return -1;}
static inline bool hs_wifi_saved_valid(const hs_wifi_saved_t *s){if(s->version!=1||s->count>HS_WIFI_SAVED_MAX)return false;for(unsigned i=0;i<s->count;i++)if(!memchr(s->entries[i].ssid,0,33)||!s->entries[i].ssid[0]||!memchr(s->entries[i].password,0,65))return false;return true;}
static inline void hs_wifi_saved_remove(hs_wifi_saved_t *s,const char *ssid){int i=hs_wifi_saved_find(s,ssid);if(i<0)return;memmove(&s->entries[i],&s->entries[i+1],(s->count-i-1)*sizeof(s->entries[0]));memset(&s->entries[--s->count],0,sizeof(s->entries[0]));}
static inline void hs_wifi_saved_put(hs_wifi_saved_t *s,const char *ssid,const char *password){hs_wifi_saved_remove(s,ssid);if(s->count==HS_WIFI_SAVED_MAX)s->count--;memmove(&s->entries[1],&s->entries[0],s->count*sizeof(s->entries[0]));memset(&s->entries[0],0,sizeof(s->entries[0]));strncpy(s->entries[0].ssid,ssid,32);strncpy(s->entries[0].password,password,64);s->count++;s->version=1;}
