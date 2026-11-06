/* 产品配置端点复用乐鑫protocomm BLE/Security 1，网络仍由既有管理器持有。 */
#include "hs_provisioning.h"
#include "hs_device_config.h"
#include "wifi_profiles.h"
#include "protocomm.h"
#include "protocomm_ble.h"
#include "protocomm_security1.h"
#include "cJSON.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "esp_log.h"
#include "psa/crypto.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static const char *tag="HomeStash配网";
typedef struct {char id[37],ssid[33],password[65];bool open;hs_device_config_t core;} request_t;
static SemaphoreHandle_t lock;
static hs_provision_status_t state;
static protocomm_t *pc;
static protocomm_security1_params_t security;
static int64_t expires,close_after;
static bool stop_requested,queued;
static request_t pending;
static unsigned char digest[32];
static char accepted_ids[8][37];
static unsigned accepted_count;
static void take(void){xSemaphoreTake(lock,portMAX_DELAY);}
static void give(void){xSemaphoreGive(lock);}
bool hs_provision_active(void){if(!lock)return false;take();bool active=state.active;give();return active;}
void hs_provision_status(hs_provision_status_t *out){if(!lock){memset(out,0,sizeof(*out));return;}take();*out=state;out->seconds_left=state.active&&expires>esp_timer_get_time()?(expires-esp_timer_get_time()+999999)/1000000:0;give();}
static void outcome(const char *code,const char *message){take();strlcpy(state.state,code,sizeof(state.state));strlcpy(state.message,message,sizeof(state.message));give();ESP_LOGI(tag,"%s",message);}
static bool field(cJSON *object,const char *name,char *out,size_t size){cJSON *v=cJSON_GetObjectItemCaseSensitive(object,name);if(!cJSON_IsString(v)||strlen(v->valuestring)>=size)return false;strlcpy(out,v->valuestring,size);return true;}
static bool exact(cJSON *j,const char *const *names,unsigned count){if(!cJSON_IsObject(j)||cJSON_GetArraySize(j)!=(int)count)return false;for(unsigned i=0;i<count;i++){unsigned matches=0;for(cJSON *p=j->child;p;p=p->next)if(p->string&&!strcmp(p->string,names[i]))matches++;if(matches!=1)return false;}return true;}
static void wipe_json(cJSON *j){if(!j)return;for(cJSON *p=j->child;p;p=p->next)wipe_json(p);if(cJSON_IsString(j)&&j->valuestring)memset(j->valuestring,0,strlen(j->valuestring));}
static bool valid(request_t *r){
 size_t n=strlen(r->password);
 if(!*r->ssid || (!r->open && !((n>=8&&n<=63)||(n==64&&strspn(r->password,"0123456789abcdefABCDEF")==64))) || (r->open&&n))return false;
 if(strlen(r->id)!=36)return false;
 for(unsigned i=0;i<36;i++)if(i==8||i==13||i==18||i==23){if(r->id[i]!='-')return false;}else if(!strchr("0123456789abcdefABCDEF",r->id[i]))return false;
 return hs_device_config_validate(r->core.core_url,r->core.device_id,r->core.token)==ESP_OK;
}
static esp_err_t respond(uint8_t **out,ssize_t *size,const char *error){
 hs_provision_status_t s;hs_provision_status(&s);
 cJSON *j=cJSON_CreateObject();if(!j)return ESP_ERR_NO_MEM;
 cJSON_AddStringToObject(j,"state",error?"rejected":s.state);cJSON_AddStringToObject(j,"message",error?error:s.message);
 cJSON_AddStringToObject(j,"requestId",s.request_id);cJSON_AddNumberToObject(j,"secondsLeft",s.seconds_left);
 char *text=cJSON_PrintUnformatted(j);cJSON_Delete(j);memset(&s,0,sizeof(s));if(!text)return ESP_ERR_NO_MEM;*out=(uint8_t*)text;*size=strlen(text);return ESP_OK;
}
static esp_err_t endpoint(uint32_t session,const uint8_t *data,ssize_t size,uint8_t **out,ssize_t *length,void *priv){
 (void)session;(void)priv;
 if(size<=0||size>1024||memchr(data,0,size))return respond(out,length,"配置格式无效");
 char *text=calloc(1,size+1);if(!text)return ESP_ERR_NO_MEM;memcpy(text,data,size);
 if(strstr(text,"\\u0000")){memset(text,0,size);free(text);return respond(out,length,"配置包含非法字符");}
 cJSON *j=cJSON_ParseWithOpts(text,NULL,true);memset(text,0,size);free(text);
 const char *error="配置字段无效";cJSON *op=cJSON_GetObjectItemCaseSensitive(j,"op");
 if(cJSON_IsString(op)&&!strcmp(op->valuestring,"status")&&cJSON_GetArraySize(j)==1)error=NULL;
 else if(cJSON_IsString(op)&&!strcmp(op->valuestring,"configure")){
  static const char *const top[]={"op","requestId","wifi","core"},*const wifi[]={"ssid","password","open"},*const core[]={"url","deviceId","token"};
  cJSON *w=cJSON_GetObjectItemCaseSensitive(j,"wifi"),*c=cJSON_GetObjectItemCaseSensitive(j,"core"),*open=cJSON_GetObjectItemCaseSensitive(w,"open");
  request_t r={0};unsigned char hash[32]={0};size_t hash_size=0;
  bool ok=exact(j,top,4)&&exact(w,wifi,3)&&exact(c,core,3)&&cJSON_IsBool(open)
    &&field(j,"requestId",r.id,sizeof(r.id))&&field(w,"ssid",r.ssid,sizeof(r.ssid))&&field(w,"password",r.password,sizeof(r.password))
    &&field(c,"url",r.core.core_url,sizeof(r.core.core_url))&&field(c,"deviceId",r.core.device_id,sizeof(r.core.device_id))&&field(c,"token",r.core.token,sizeof(r.core.token));
  r.open=cJSON_IsTrue(open);
  if(ok&&valid(&r)&&psa_crypto_init()==PSA_SUCCESS&&psa_hash_compute(PSA_ALG_SHA_256,(const unsigned char*)&r,sizeof(r),hash,sizeof(hash),&hash_size)==PSA_SUCCESS&&hash_size==32){
   hs_device_config_t current;hs_device_config_get(&current);r.core.revision=current.revision;memset(&current,0,sizeof(current));
   take();
   if(!state.active||stop_requested||esp_timer_get_time()>=expires)error="配网窗口已关闭";
   else if(!strcmp(state.request_id,r.id))error=memcmp(digest,hash,32)?"相同请求ID不能用于不同配置":NULL;
   else if(state.applying||queued)error="正在应用上一份配置，请等待结果";
   else {
    bool seen=false;for(unsigned i=0;i<accepted_count;i++)if(!strcmp(accepted_ids[i],r.id))seen=true;
    if(seen)error="旧请求已结束，不能在新配置后重放旧配置";
    else if(accepted_count>=8)error="本窗口请求次数已满，请关闭后重新开启";
    else {strlcpy(accepted_ids[accepted_count++],r.id,sizeof(r.id));pending=r;close_after=0;memcpy(digest,hash,32);strlcpy(state.request_id,r.id,sizeof(state.request_id));strlcpy(state.state,"connecting",sizeof(state.state));strlcpy(state.message,"正在连接，联网成功后保存配置",sizeof(state.message));queued=true;state.applying=true;error=NULL;}
   }
   give();
  }
  memset(&r,0,sizeof(r));memset(hash,0,sizeof(hash));
 }
 wipe_json(j);cJSON_Delete(j);return respond(out,length,error);
}
esp_err_t hs_provision_start(void){
 if(!lock)return ESP_ERR_INVALID_STATE;
 take();if(state.active||pc){give();return ESP_ERR_INVALID_STATE;}memset(&state,0,sizeof(state));stop_requested=false;queued=false;close_after=0;memset(&pending,0,sizeof(pending));memset(digest,0,sizeof(digest));memset(accepted_ids,0,sizeof(accepted_ids));accepted_count=0;
 unsigned char random[8];esp_fill_random(random,sizeof(random));for(unsigned i=0;i<8;i++)snprintf(state.proof+i*2,3,"%02x",random[i]);memset(random,0,sizeof(random));
 unsigned suffix=esp_random()&0xffff;snprintf(state.name,sizeof(state.name),"FreshMate-%04X",suffix);
 pc=protocomm_new();if(!pc){give();return ESP_ERR_NO_MEM;}
 static protocomm_ble_name_uuid_t names[]={{"prov-session",0xff51},{"hs-config",0xff52}};
 protocomm_ble_config_t config={.service_uuid={0x21,0x46,0x38,0x67,0x41,0x9a,0x42,0xbe,0xaa,0x26,0x15,0x6b,0x00,0x50,0x53,0x48},.nu_lookup_count=2,.nu_lookup=names};
 strlcpy(config.device_name,state.name,sizeof(config.device_name));security=(protocomm_security1_params_t){.data=(const uint8_t*)state.proof,.len=16};
 esp_log_level_set("security1",ESP_LOG_WARN);
 esp_err_t e=protocomm_ble_start(pc,&config);
 if(e==ESP_OK)e=protocomm_set_security(pc,"prov-session",&protocomm_security1,&security);
 if(e==ESP_OK)e=protocomm_add_endpoint(pc,"hs-config",endpoint,NULL);
 if(e==ESP_OK){state.active=true;expires=esp_timer_get_time()+180000000;strlcpy(state.state,"waiting",sizeof(state.state));strlcpy(state.message,"请使用本机验证码建立加密会话",sizeof(state.message));}
 else {protocomm_ble_stop(pc);protocomm_delete(pc);pc=NULL;memset(state.proof,0,sizeof(state.proof));strlcpy(state.message,"蓝牙启动失败，仍可使用LCD配网",sizeof(state.message));}
 give();ESP_LOGI(tag,"配网窗口启动：%s（不输出验证码）",esp_err_to_name(e));return e;
}
void hs_provision_stop(void){if(!lock)return;take();stop_requested=true;give();}
static void worker(void *arg){
 (void)arg;
 for(;;){
  request_t r={0};bool apply=false,stop=false;take();
  if(queued){r=pending;memset(&pending,0,sizeof(pending));queued=false;apply=true;}
  stop=state.active&&(stop_requested||esp_timer_get_time()>=expires||(close_after&&esp_timer_get_time()>=close_after));give();
  if(apply&&!stop){
   hs_wifi_status_t before,s;hs_wifi_status(&before);hs_wifi_ap_t ap={.open=r.open};strlcpy(ap.ssid,r.ssid,sizeof(ap.ssid));
   esp_err_t e=hs_wifi_connect(&ap,r.password);bool connected=false,cancelled=false;
   int64_t end=esp_timer_get_time()+35000000;
   while(e==ESP_OK&&esp_timer_get_time()<end){
    take();cancelled=stop_requested||esp_timer_get_time()>=expires;give();if(cancelled)break;
    hs_wifi_status(&s);
    if(s.connection_revision>before.connection_revision&&!strcmp(s.ssid,r.ssid)&&s.connected){connected=s.connection_saved;break;}
    if(s.connection_revision>before.connection_revision&&!s.connecting&&!s.connected)break;
    vTaskDelay(pdMS_TO_TICKS(200));
   }
   if(connected&&!cancelled){
    hs_device_config_t current;hs_device_config_get(&current);
    e=current.revision==r.core.revision?hs_device_config_save(r.core.core_url,r.core.device_id,r.core.token):ESP_ERR_INVALID_STATE;memset(&current,0,sizeof(current));
    outcome(e==ESP_OK?"saved":"partial",e==ESP_OK?"Wi-Fi已连接并保存，Core字段已保存":"网络已保存，Core保存失败，请到Core页核对");
    if(e==ESP_OK){take();close_after=esp_timer_get_time()+12000000;give();}
   }else{hs_wifi_cancel_connection();outcome("failed",cancelled?"配网已取消，恢复已保存网络":"连接失败，未保存Core，请重试或用LCD配网");}
   memset(&r,0,sizeof(r));take();state.applying=false;give();
  }
  if(apply&&stop){memset(&r,0,sizeof(r));take();state.applying=false;give();}
  if(stop){
   take();stop_requested=true;give();
   esp_err_t e=protocomm_ble_stop(pc);
   if(e==ESP_OK){take();protocomm_delete(pc);pc=NULL;state.active=false;state.applying=false;stop_requested=false;queued=false;memset(&pending,0,sizeof(pending));memset(state.proof,0,sizeof(state.proof));memset(&security,0,sizeof(security));if(strcmp(state.state,"saved")&&strcmp(state.state,"partial"))strlcpy(state.message,"配网窗口已关闭，LCD配网仍可使用",sizeof(state.message));give();ESP_LOGI(tag,"BLE配网窗口已关闭");}
   else {ESP_LOGW(tag,"BLE停止失败，将重试");vTaskDelay(pdMS_TO_TICKS(1000));}
  }
  vTaskDelay(pdMS_TO_TICKS(200));
 }
}
esp_err_t hs_provision_init(void){lock=xSemaphoreCreateMutex();if(!lock)return ESP_ERR_NO_MEM;strlcpy(state.state,"closed",sizeof(state.state));return xTaskCreate(worker,"hs_ble_config",8192,NULL,4,NULL)==pdPASS?ESP_OK:ESP_ERR_NO_MEM;}
