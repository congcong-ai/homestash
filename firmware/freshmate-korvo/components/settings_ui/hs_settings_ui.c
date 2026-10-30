#include "hs_settings_ui.h"
#include "hs_device_config.h"
#include "hs_ota.h"
#include "hs_display.h"
#include "hs_provisioning.h"
#include "wifi_profiles.h"
#include "bsp/display.h"
#include "esp_app_desc.h"
#include "esp_log.h"
#include "esp_ota_ops.h"
#include "lvgl.h"
#include <stdio.h>
#include <string.h>
LV_FONT_DECLARE(hs_font);
static lv_obj_t *panel,*content,*keyboard,*notice,*list,*password_dialog,*password_input,*password_error,*remember_password;
static lv_obj_t *url_input,*id_input,*token_input,*ota_label,*install_button,*ble_label;
static hs_wifi_ap_t aps[HS_WIFI_SCAN_LIMIT],selected;
static unsigned revision=~0U;
static int page;
static bool busy,visible;
bool hs_settings_ui_active(void){return __atomic_load_n(&visible,__ATOMIC_RELAXED);}
static void (*send_action)(int);
void hs_settings_ui_busy(bool value) {__atomic_store_n(&busy,value,__ATOMIC_RELAXED);}
static bool blocked(void) {return __atomic_load_n(&busy,__ATOMIC_RELAXED) || hs_provision_active();}
static bool app_busy(void) {return __atomic_load_n(&busy,__ATOMIC_RELAXED);}
static void ble_action(lv_event_t *e) {int action=(int)(intptr_t)lv_event_get_user_data(e);if(action==24&&app_busy())return;if(send_action)send_action(action);}
static lv_obj_t *label(lv_obj_t *p,int x,int y,int w,const char *text) {lv_obj_t *o=lv_label_create(p);lv_obj_set_pos(o,x,y);lv_obj_set_width(o,w);lv_obj_set_style_text_font(o,&hs_font,0);lv_label_set_text(o,text);return o;}
static lv_obj_t *button(lv_obj_t *p,int x,int y,int w,const char *text,lv_event_cb_t cb,void *data) {
 lv_obj_t *o=lv_button_create(p);lv_obj_set_pos(o,x,y);lv_obj_set_size(o,w,44);lv_obj_t *t=lv_label_create(o);lv_obj_set_style_text_font(t,&hs_font,0);lv_label_set_text(t,text);lv_obj_center(t);lv_obj_add_event_cb(o,cb,LV_EVENT_CLICKED,data);return o;
}
static void keyboard_event(lv_event_t *e) {if(lv_event_get_code(e)==LV_EVENT_READY || lv_event_get_code(e)==LV_EVENT_CANCEL) {lv_obj_add_flag(keyboard,LV_OBJ_FLAG_HIDDEN);lv_keyboard_set_textarea(keyboard,NULL);if(page==1)lv_obj_set_y(content,130);}}
static void focus(lv_event_t *e) {if(page==1 && !password_dialog)lv_obj_set_y(content,lv_event_get_target(e)==token_input?20:lv_event_get_target(e)==id_input?84:130);lv_keyboard_set_textarea(keyboard,lv_event_get_target(e));lv_obj_remove_flag(keyboard,LV_OBJ_FLAG_HIDDEN);lv_obj_move_foreground(keyboard);}
static lv_obj_t *input(lv_obj_t *p,int x,int y,int w,int limit,const char *value,bool secret) {
 lv_obj_t *o=lv_textarea_create(p);lv_obj_set_pos(o,x,y);lv_obj_set_size(o,w,52);lv_obj_set_style_text_font(o,&hs_font,0);lv_textarea_set_one_line(o,true);lv_textarea_set_max_length(o,limit);lv_textarea_set_password_mode(o,secret);lv_textarea_set_text(o,value);lv_obj_add_event_cb(o,focus,LV_EVENT_FOCUSED,NULL);return o;
}
static void close_settings(lv_event_t *e) {(void)e;__atomic_store_n(&visible,false,__ATOMIC_RELAXED);if(token_input)lv_textarea_set_text(token_input,"");if(password_input)lv_textarea_set_text(password_input,"");lv_obj_delete(panel);panel=content=keyboard=notice=list=password_dialog=password_input=url_input=id_input=token_input=ota_label=install_button=NULL;}
static void network_command(lv_event_t *e) {if(blocked()){lv_label_set_text(notice,"正在处理，请稍后设置网络");return;}int kind=(int)(intptr_t)lv_event_get_user_data(e);esp_err_t r=kind==1?hs_wifi_scan():kind==3?hs_wifi_disconnect():hs_wifi_automatic();if(r!=ESP_OK)lv_label_set_text(notice,"设备忙，请稍后重试");}
static void close_password(lv_event_t *e) {(void)e;lv_keyboard_set_textarea(keyboard,NULL);lv_obj_add_flag(keyboard,LV_OBJ_FLAG_HIDDEN);lv_textarea_set_text(password_input,"");lv_obj_delete(password_dialog);password_dialog=password_input=NULL;}
static void connect_password(lv_event_t *e) {
 (void)e;if(blocked())return;
 const char *password=lv_textarea_get_text(password_input);size_t n=strlen(password);
 if(!selected.open && !selected.enterprise && !(selected.remembered&&n==0) && !((n>=8 && n<=63) || (n==64 && strspn(password,"0123456789abcdefABCDEF")==64))) {lv_label_set_text(password_error,"密码需8到63字节，或64位十六进制密钥");return;}
 bool remember=lv_obj_has_state(remember_password,LV_STATE_CHECKED);
 esp_err_t result=hs_wifi_connect_remember(&selected,password,remember);
 if(result==ESP_OK){close_password(NULL);lv_label_set_text(notice,"正在连接，成功后才保存网络");}
 else lv_label_set_text(notice,"无法提交连接，请稍后重试");
}
static void select_network(lv_event_t *e) {
 if(blocked())return;
 selected=aps[(uintptr_t)lv_event_get_user_data(e)];
 if(selected.enterprise && !selected.configured){lv_label_set_text(notice,"该企业网络需预先配置账号和证书");return;}
 password_dialog=lv_obj_create(panel);lv_obj_set_pos(password_dialog,0,70);lv_obj_set_size(password_dialog,800,220);lv_obj_set_style_bg_opa(password_dialog,LV_OPA_COVER,0);
 label(password_dialog,0,0,600,selected.ssid);button(password_dialog,640,0,110,"取消",close_password,NULL);
 password_input=input(password_dialog,0,55,580,64,"",true);lv_textarea_set_placeholder_text(password_input,selected.remembered?"已保存密码，留空直接连接":"输入 Wi-Fi 密码");
 button(password_dialog,600,55,150,"连接",connect_password,NULL);
 remember_password=lv_checkbox_create(password_dialog);lv_obj_set_style_text_font(remember_password,&hs_font,LV_PART_MAIN);lv_obj_set_pos(remember_password,0,110);lv_checkbox_set_text(remember_password,"记住密码，下次自动连接");lv_obj_add_state(remember_password,LV_STATE_CHECKED);
 password_error=label(password_dialog,0,154,740,"");
 if(selected.enterprise)lv_obj_add_flag(remember_password,LV_OBJ_FLAG_HIDDEN);
 if(selected.open || selected.enterprise){lv_obj_add_flag(password_input,LV_OBJ_FLAG_HIDDEN);label(password_dialog,0,154,740,selected.open?"开放网络，无需密码":"使用已配置的企业账号与证书");}
 else {lv_keyboard_set_textarea(keyboard,password_input);lv_obj_remove_flag(keyboard,LV_OBJ_FLAG_HIDDEN);lv_obj_move_foreground(keyboard);}
}
static void save_core(lv_event_t *e) {
 (void)e;if(blocked()){lv_label_set_text(notice,"正在处理，请稍后保存");return;}
 hs_device_config_t current;hs_device_config_get(&current);
 const char *token=lv_textarea_get_text(token_input);if(!*token)token=current.token;
 esp_err_t err=hs_device_config_save(lv_textarea_get_text(url_input),lv_textarea_get_text(id_input),token);
 memset(&current,0,sizeof(current));lv_textarea_set_text(token_input,"");lv_obj_add_flag(keyboard,LV_OBJ_FLAG_HIDDEN);lv_keyboard_set_textarea(keyboard,NULL);
 lv_label_set_text(notice,err==ESP_OK?"已保存，将在下一次请求使用新配置":"保存失败，请检查地址、设备 ID 和至少32字符的凭据");
}
static void ota_action(lv_event_t *e) {if(blocked())return;int action=(int)(intptr_t)lv_event_get_user_data(e);if(send_action)send_action(action);}
static void confirm_ota(lv_event_t *e) {(void)e;if(blocked())return;lv_label_set_text(notice,"升级将重启设备，请保持供电。再次点击下方按钮确认。");lv_obj_t *t=lv_obj_get_child(install_button,0);lv_label_set_text(t,"确认升级并重启");lv_obj_remove_event_cb(install_button,confirm_ota);lv_obj_add_event_cb(install_button,ota_action,LV_EVENT_CLICKED,(void*)21);}
static void select_page(lv_event_t *e) {
 if(password_dialog)close_password(NULL);
 if(token_input)lv_textarea_set_text(token_input,"");
 page=(int)(intptr_t)lv_event_get_user_data(e);lv_keyboard_set_textarea(keyboard,NULL);lv_obj_add_flag(keyboard,LV_OBJ_FLAG_HIDDEN);lv_obj_clean(content);
 list=url_input=id_input=token_input=ota_label=install_button=ble_label=NULL;
 notice=label(content,0,0,740,"");
 if(page==0) {
  button(content,0,76,180,"重新扫描",network_command,(void*)1);button(content,200,76,180,"自动选择",network_command,(void*)2);button(content,400,76,180,"断开连接",network_command,(void*)3);
  list=lv_list_create(content);lv_obj_set_pos(list,0,130);lv_obj_set_size(list,744,185);revision=~0U;
 } else if(page==1) {
  hs_device_config_t config;hs_device_config_get(&config);
  label(content,0,48,190,"Core 地址");url_input=input(content,190,36,554,350,config.core_url,false);
  label(content,0,112,190,"设备 ID");id_input=input(content,190,100,554,64,config.device_id,false);
  label(content,0,176,190,"设备凭据");token_input=input(content,190,164,554,128,"",true);lv_textarea_set_placeholder_text(token_input,"留空保留已保存的凭据");
  button(content,0,235,744,"保存 Core 配置",save_core,NULL);memset(&config,0,sizeof(config));
 } else if(page==3) {
  ble_label=label(content,0,42,744,"蓝牙配网默认关闭");
  button(content,0,235,350,"开启蓝牙配网",ble_action,(void*)24);button(content,380,235,360,"关闭蓝牙配网",ble_action,(void*)25);
 } else {
  char text[160];snprintf(text,sizeof(text),"当前 %s · %s",esp_app_get_description()->version,esp_ota_get_running_partition()->label);label(content,0,50,744,text);
  ota_label=label(content,0,105,744,"尚未检查更新");button(content,0,230,300,"检查更新",ota_action,(void*)20);
  install_button=button(content,330,230,410,"安装已检查的更新",confirm_ota,NULL);
 }
}
static void open_settings(lv_event_t *e) {
 (void)e;if(panel)return;__atomic_store_n(&visible,true,__ATOMIC_RELAXED);
 panel=lv_obj_create(lv_layer_top());lv_obj_set_pos(panel,0,0);lv_obj_set_size(panel,800,480);lv_obj_set_style_bg_color(panel,lv_color_hex(0xf4f7ef),0);lv_obj_set_style_bg_opa(panel,LV_OPA_COVER,0);lv_obj_remove_flag(panel,LV_OBJ_FLAG_SCROLLABLE);lv_obj_set_style_pad_all(panel,0,0);
 label(panel,20,10,350,"FreshMate 设备设置");button(panel,650,0,110,"返回",close_settings,NULL);
 const char *names[]={"网络","Core","更新","蓝牙"};for(int i=0;i<4;i++)button(panel,20+i*190,65,180,names[i],select_page,(void*)(intptr_t)i);
 content=lv_obj_create(panel);lv_obj_set_pos(content,20,130);lv_obj_set_size(content,760,330);lv_obj_set_style_pad_all(content,0,0);lv_obj_remove_flag(content,LV_OBJ_FLAG_SCROLLABLE);
 keyboard=lv_keyboard_create(panel);lv_obj_set_size(keyboard,800,190);lv_obj_align(keyboard,LV_ALIGN_BOTTOM_MID,0,0);lv_obj_add_flag(keyboard,LV_OBJ_FLAG_HIDDEN);lv_obj_add_event_cb(keyboard,keyboard_event,LV_EVENT_ALL,NULL);
 page=0;notice=label(content,0,0,740,"");button(content,0,76,180,"重新扫描",network_command,(void*)1);button(content,200,76,180,"自动选择",network_command,(void*)2);button(content,400,76,180,"断开连接",network_command,(void*)3);
 list=lv_list_create(content);lv_obj_set_pos(list,0,130);lv_obj_set_size(list,744,185);revision=~0U;hs_wifi_scan();
}
static void refresh(lv_timer_t *timer) {
 (void)timer;if(!panel)return;
 if(page==0) {
  hs_wifi_status_t wifi;hs_wifi_status(&wifi);char text[224];snprintf(text,sizeof(text),"%s · %s\n%s",wifi.connected?"已连接":"未连接",wifi.automatic?"自动选择":"手动选择",wifi.message);lv_label_set_text(notice,text);
  if(wifi.revision!=revision && list) {
   revision=wifi.revision;memcpy(aps,wifi.aps,sizeof(aps));lv_obj_clean(list);
   for(unsigned i=0;i<wifi.count;i++) {snprintf(text,sizeof(text),"%s%s  %d dBm",aps[i].ssid,aps[i].remembered?" 已保存":"",aps[i].rssi);lv_obj_t *b=lv_list_add_button(list,NULL,text);lv_obj_set_style_text_font(b,&hs_font,0);lv_obj_add_event_cb(b,select_network,LV_EVENT_CLICKED,(void*)(uintptr_t)i);}
  }
 } else if(page==3 && ble_label) {
  hs_provision_status_t s;hs_provision_status(&s);char text[400];
  if(s.active)snprintf(text,sizeof(text),"设备 %s\n验证码 %s\n剩余 %u 秒 · %s",s.name,s.proof,s.seconds_left,s.message);
  else snprintf(text,sizeof(text),"%s\n默认关闭；开启后180秒自动关闭。\n验证码仅在本机显示，不上传。",s.message[0]?s.message:"蓝牙配网已关闭");
  lv_label_set_text(ble_label,text);memset(&s,0,sizeof(s));memset(text,0,sizeof(text));
 } else if(page==2 && ota_label) {
  hs_ota_status_t state;hs_ota_status(&state);lv_label_set_text(ota_label,state.message);
  if(state.available && !blocked())lv_obj_remove_state(install_button,LV_STATE_DISABLED);else lv_obj_add_state(install_button,LV_STATE_DISABLED);
 }
}
esp_err_t hs_settings_ui_init(void (*action)(int)) {
 send_action=action;if(!bsp_display_lock(-1))return ESP_FAIL;
 button(lv_layer_top(),650,18,130,"⚙ 设置",open_settings,NULL);lv_timer_create(refresh,400,NULL);bsp_display_unlock();return ESP_OK;
}

void hs_settings_ui_show(bool show){if(!bsp_display_lock(-1))return;if(show)open_settings(NULL);else if(panel)close_settings(NULL);bsp_display_unlock();ESP_LOGI("设备设置","页面=%s",show?"打开":"关闭");}
