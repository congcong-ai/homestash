#include <assert.h>
#include <stdio.h>
#include "wifi_saved.h"
int main(void){
 hs_wifi_saved_t s={.version=1};assert(hs_wifi_saved_valid(&s));
 hs_wifi_saved_put(&s,"home","password1");hs_wifi_saved_put(&s,"hotspot","password2");
 assert(s.count==2&&hs_wifi_saved_find(&s,"home")==1);
 hs_wifi_saved_put(&s,"home","newpassword");assert(s.count==2&&!strcmp(s.entries[0].password,"newpassword"));
 hs_wifi_saved_t restored=s;assert(hs_wifi_saved_valid(&restored)&&hs_wifi_saved_find(&restored,"hotspot")==1);
 hs_wifi_saved_remove(&s,"home");assert(hs_wifi_saved_find(&s,"home")==-1&&s.count==1);
 for(int i=0;i<10;i++){char name[20];snprintf(name,sizeof(name),"wifi%d",i);hs_wifi_saved_put(&s,name,"password");}
 assert(s.count==HS_WIFI_SAVED_MAX&&hs_wifi_saved_find(&s,"wifi0")==-1);
 s.count=HS_WIFI_SAVED_MAX+1;assert(!hs_wifi_saved_valid(&s));
 s.count=1;memset(s.entries[0].ssid,'x',sizeof(s.entries[0].ssid));assert(!hs_wifi_saved_valid(&s));return 0;
}
