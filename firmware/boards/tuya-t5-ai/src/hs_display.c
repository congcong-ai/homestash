#include "hs_display.h"
#include "../include/hs_avatar_themes.h"
#include "board_com_api.h"
#include "hs_runtime.h"
#include "wifi_profiles.h"
#include "hs_audio.h"
#include "hs_device_config.h"
#include "tal_kv.h"
#include "lv_vendor.h"
#include "lvgl.h"
#include "tal_mutex.h"
#include "tdd_disp_ili9488.h"
#include "tdd_touch_gt1151.h"
#include <stdio.h>
#include <string.h>
LV_FONT_DECLARE(hs_font);
static MUTEX_HANDLE lock;
static hs_display_snapshot_t snapshot;
static void (*navigate)(int);
static bool session_listening,session_active;
void hs_t5_display_active(bool active){tal_mutex_lock(lock);session_active=active;tal_mutex_unlock(lock);}
static lv_obj_t *session_title;
void hs_t5_display_listening(bool active){tal_mutex_lock(lock);session_listening=active;tal_mutex_unlock(lock);}
static lv_obj_t *text_view, *content, *face, *mouth, *wifi_panel, *wifi_list, *wifi_message, *password, *keyboard;
static hs_wifi_ap_t selected_ap,visible_aps[HS_WIFI_SCAN_LIMIT];
static unsigned visible_count;
static lv_obj_t *password_panel,*password_network,*password_note,*password_visibility;
static unsigned wifi_revision;
static unsigned rendered;
static bool backend_connected,core_checking;
static hs_err_t core_check_error=HS_OK;
static lv_obj_t *core_panel,*core_status,*core_address,*core_retry;
void hs_t5_core_check_result(hs_err_t result){tal_mutex_lock(lock);core_checking=false;core_check_error=result;tal_mutex_unlock(lock);}
static void close_core(lv_event_t *e){(void)e;lv_obj_add_flag(core_panel,LV_OBJ_FLAG_HIDDEN);}
static void show_core(lv_event_t *e){
 (void)e;lv_obj_remove_flag(core_panel,LV_OBJ_FLAG_HIDDEN);
 hs_device_config_t config;hs_device_config_get(&config);
 lv_label_set_text(core_address,config.core_url[0]?config.core_url:"尚未配置服务地址");memset(&config,0,sizeof(config));
}
static void retry_core(lv_event_t *e){
 (void)e;tal_mutex_lock(lock);bool checking=core_checking;void (*callback)(int)=navigate;
 if(!checking&&callback){core_checking=true;core_check_error=HS_OK;}tal_mutex_unlock(lock);
 if(!checking&&callback)callback(20);
}

static lv_obj_t *backend_offline,*wifi_offline,*backend_icon,*wifi_icon,*settings_panel,*settings_status,*wifi_current;
typedef struct { unsigned version; bool silent,proactive,listening; int volume; } preferences_t;
static preferences_t preferences={1,false,true,true,60};
void hs_t5_preferences(bool *silent,bool *proactive,bool *listening){tal_mutex_lock(lock);*silent=preferences.silent;*proactive=preferences.proactive;*listening=preferences.listening;tal_mutex_unlock(lock);}
static lv_obj_t *offline_mark(lv_obj_t *b){
 lv_obj_t *mark=lv_label_create(b);lv_obj_set_style_text_font(mark,&lv_font_montserrat_14,0);lv_obj_set_style_text_color(mark,lv_color_hex(0xB94C4C),0);lv_label_set_text(mark,"/");lv_obj_center(mark);return mark;
}
void hs_t5_preferences_apply_volume(void){hs_audio_demo_volume((preferences.volume-hs_audio_volume_percent())/5);}

static void close_settings(lv_event_t *e){(void)e;lv_obj_add_flag(settings_panel,LV_OBJ_FLAG_HIDDEN);}
static void show_settings(lv_event_t *e){(void)e;lv_obj_remove_flag(settings_panel,LV_OBJ_FLAG_HIDDEN);}
static void preference_click(lv_event_t *e){
 int action=(int)(intptr_t)lv_event_get_user_data(e);
 tal_mutex_lock(lock);
 if(action==0)preferences.silent=!preferences.silent;
 if(action==1)preferences.proactive=!preferences.proactive;
 if(action==2)preferences.listening=!preferences.listening;
 tal_mutex_unlock(lock);
 if(action==3||action==4)hs_audio_demo_volume(action==3?-1:1);
 tal_mutex_lock(lock);preferences.volume=hs_audio_volume_percent();preferences_t saved=preferences;tal_mutex_unlock(lock);
 if(tal_kv_set("hs.yard.prefs.v1",(const uint8_t *)&saved,sizeof(saved)))lv_label_set_text(settings_status,"保存失败，请重试");
}

static int selected;
/* 独立登记同一块原厂 LCD，要求 SDK 在初始化时分配旋转缓冲区。
 * 仅在 LVGL 初始化之后修改 rotation 会缺少该缓冲区。引脚来自 V1.02 BSP。 */
static hs_err_t register_landscape(void) {
  DISP_RGB_DEVICE_CFG_T cfg = {0};
  cfg.sw_spi_cfg.spi_clk = TUYA_GPIO_NUM_49;
  cfg.sw_spi_cfg.spi_csx = TUYA_GPIO_NUM_48;
  cfg.sw_spi_cfg.spi_sda = TUYA_GPIO_NUM_50;
  cfg.sw_spi_cfg.spi_dc = TUYA_GPIO_NUM_MAX;
  cfg.sw_spi_cfg.spi_rst = TUYA_GPIO_NUM_53;
  cfg.bl.type = TUYA_DISP_BL_TP_GPIO;
  cfg.bl.gpio.pin = TUYA_GPIO_NUM_9;
  cfg.bl.gpio.active_level = TUYA_GPIO_LEVEL_HIGH;
  cfg.width = 320;
  cfg.height = 480;
  cfg.pixel_fmt = TUYA_PIXEL_FMT_RGB565;
  cfg.rotation = TUYA_DISPLAY_ROTATION_90;
  cfg.power.pin = TUYA_GPIO_NUM_MAX;
  if (tdd_disp_rgb_ili9488_register("homestash-t5-lcd", &cfg) != OPRT_OK)
    return HS_FAIL;
  /* SDK 按同一个名字查找显示与触摸设备，保留物理坐标给 LVGL 旋转。 */
  TDD_TOUCH_GT1151_INFO_T touch = {
      .i2c_cfg = {.port = TUYA_I2C_NUM_0,
                  .scl_pin = TUYA_GPIO_NUM_13,
                  .sda_pin = TUYA_GPIO_NUM_15},
      .tp_cfg = {.x_max = 320, .y_max = 480}};
  return tdd_touch_i2c_gt1151_register("homestash-t5-lcd", &touch) == OPRT_OK
             ? HS_OK
             : HS_FAIL;
}
static void clicked(lv_event_t *e) {
  int page = (int)(intptr_t)lv_event_get_user_data(e);
  tal_mutex_lock(lock);
  void (*callback)(int) = navigate;
  tal_mutex_unlock(lock);
  if (callback)
    callback(page);
}
/* Wi-Fi 凭据只在设备输入，不回显日志；复用原网络服务及持久化。 */
/* 键盘构造器默认底部居中；必须显式采用左上坐标，避免向下偏移出屏。 */
static void show_password_keyboard(lv_event_t *e){
 (void)e;
 lv_obj_move_foreground(password_panel);
 lv_keyboard_set_textarea(keyboard,password);
 lv_obj_remove_flag(keyboard,LV_OBJ_FLAG_HIDDEN);
 lv_obj_move_foreground(keyboard);
 lv_obj_add_state(password,LV_STATE_FOCUSED);
}
static void back_to_networks(lv_event_t *e);
static void password_keyboard_event(lv_event_t *e){
 lv_event_code_t code=lv_event_get_code(e);
 if(code==LV_EVENT_CANCEL){back_to_networks(NULL);return;}
 if(code==LV_EVENT_READY){
   lv_obj_add_flag(keyboard,LV_OBJ_FLAG_HIDDEN);
   lv_keyboard_set_textarea(keyboard,NULL);
   lv_obj_remove_state(password,LV_STATE_FOCUSED);
 }
}
static void close_wifi(lv_event_t *e) {
  (void)e;
  if(password)lv_textarea_set_text(password, "");
  lv_obj_add_flag(password_panel,LV_OBJ_FLAG_HIDDEN);
  lv_obj_add_flag(wifi_panel, LV_OBJ_FLAG_HIDDEN);
}
static void back_to_networks(lv_event_t *e){
 (void)e;lv_textarea_set_text(password, "");lv_textarea_set_password_mode(password,true);
 lv_label_set_text(lv_obj_get_child(password_visibility,0),"显示");
 lv_obj_add_flag(password_panel,LV_OBJ_FLAG_HIDDEN);
 lv_keyboard_set_textarea(keyboard,NULL);
 lv_obj_remove_state(password,LV_STATE_FOCUSED);
}
static void toggle_password(lv_event_t *e){
 (void)e;bool hidden=lv_textarea_get_password_mode(password);lv_textarea_set_password_mode(password,!hidden);
 lv_label_set_text(lv_obj_get_child(password_visibility,0),hidden?"隐藏":"显示");
 show_password_keyboard(NULL);
}
static void connect_wifi(lv_event_t *e) {
 (void)e;
 hs_err_t result=hs_wifi_connect_remember(&selected_ap,lv_textarea_get_text(password),true);
 if(result!=HS_OK){lv_label_set_text(password_note,"连接未开始，请检查密码");return;}
 lv_textarea_set_text(password, "");lv_obj_add_flag(password_panel,LV_OBJ_FLAG_HIDDEN);
 lv_label_set_text(wifi_message,"正在连接，成功后自动保存");
}
static void choose_wifi(lv_event_t *e) {
 unsigned index=(unsigned)(uintptr_t)lv_event_get_user_data(e);
 if(index>=visible_count)return;
 selected_ap=visible_aps[index];
 lv_label_set_text(password_network,selected_ap.ssid);
 lv_textarea_set_text(password, "");lv_textarea_set_password_mode(password,true);
 lv_label_set_text(lv_obj_get_child(password_visibility,0),"显示");
 lv_label_set_text(password_note,selected_ap.enterprise?"暂不支持企业认证网络":selected_ap.open?"开放网络，无需输入密码":"输入密码，连接后自动保存");
 lv_obj_remove_flag(password_panel,LV_OBJ_FLAG_HIDDEN);
 lv_keyboard_set_mode(keyboard,LV_KEYBOARD_MODE_TEXT_LOWER);
 show_password_keyboard(NULL);
}
static void scan_wifi(lv_event_t *e){
 (void)e;hs_err_t result=hs_wifi_scan();lv_label_set_text(wifi_message,result==HS_OK?"正在寻找附近网络…":"暂时无法扫描，请稍后重试");
}
static void show_wifi(lv_event_t *e){
 (void)e;lv_obj_remove_flag(wifi_panel,LV_OBJ_FLAG_HIDDEN);wifi_revision=(unsigned)-1;scan_wifi(NULL);
}
static lv_obj_t *button(lv_obj_t *parent,const char *title,int x,int y,int w,lv_event_cb_t cb,void *data){
  lv_obj_t *b=lv_button_create(parent);lv_obj_set_pos(b,x,y);lv_obj_set_size(b,w,44);
  lv_obj_set_style_bg_color(b,lv_color_hex(0xF5D8CC),0);
  lv_obj_set_style_text_color(b,lv_color_hex(0x49382F),0);
  lv_obj_add_event_cb(b,cb,LV_EVENT_CLICKED,data);
  lv_obj_t *l=lv_label_create(b);if(title[0]&&(unsigned char)title[0]>=0xEF)lv_obj_set_style_text_font(l,&lv_font_montserrat_14,0);lv_label_set_text(l,title);lv_obj_center(l);return b;
}
/* 所有对象只创建一次；业务线程只提交快照，50ms动画定时器在LVGL线程绘制。 */
static lv_obj_t *eye[2],*pupil[2],*shine[2],*cheek[2],*brow[2],*avatar_toggle,*avatar_stop,*avatar_status;
static unsigned avatar_base_children;
static int avatar_state=HS_FACE_IDLE;
static uint32_t avatar_epoch;
typedef struct {unsigned version,revision;int theme,fullscreen;} avatar_config_t;
static avatar_config_t avatar_config={1,0,0,0};
static bool avatar_dirty;
static void avatar_heart(lv_event_t *event){
 tal_mutex_lock(lock);int state=avatar_state,theme=avatar_config.theme;tal_mutex_unlock(lock);
 if(state!=HS_FACE_LOVE)return;
 lv_obj_t *obj=lv_event_get_target(event);lv_area_t a;lv_obj_get_coords(obj,&a);int w=lv_area_get_width(&a),h=lv_area_get_height(&a);lv_layer_t *layer=lv_event_get_layer(event);
 lv_draw_triangle_dsc_t tri;lv_draw_triangle_dsc_init(&tri);tri.bg_color=lv_color_hex(avatar_themes[theme].accent);tri.bg_opa=LV_OPA_COVER;
 tri.p[0]=(lv_point_precise_t){a.x1,a.y1+h/3};tri.p[1]=(lv_point_precise_t){a.x2,a.y1+h/3};tri.p[2]=(lv_point_precise_t){a.x1+w/2,a.y2};lv_draw_triangle(layer,&tri);
 lv_draw_rect_dsc_t circle;lv_draw_rect_dsc_init(&circle);circle.bg_color=tri.bg_color;circle.bg_opa=LV_OPA_COVER;circle.radius=LV_RADIUS_CIRCLE;
 lv_area_t left={a.x1,a.y1,a.x1+w/2,a.y1+h/2},right={a.x1+w/2,a.y1,a.x2,a.y1+h/2};lv_draw_rect(layer,&circle,&left);lv_draw_rect(layer,&circle,&right);
}
void hs_t5_avatar_config(unsigned revision,int theme,int fullscreen){
 if(theme<0||theme>=4||(fullscreen!=0&&fullscreen!=1))return;
 tal_mutex_lock(lock);
 if(revision>avatar_config.revision){avatar_config=(avatar_config_t){1,revision,theme,fullscreen};avatar_dirty=true;}
 tal_mutex_unlock(lock);
}
static void fullscreen_icon(lv_event_t *e){
 tal_mutex_lock(lock);bool full=avatar_config.fullscreen;tal_mutex_unlock(lock);if(full)return;
 lv_obj_t *o=lv_event_get_target(e);lv_area_t a;lv_obj_get_coords(o,&a);lv_draw_rect_dsc_t d;lv_draw_rect_dsc_init(&d);d.bg_color=lv_color_hex(0x365E58);d.bg_opa=LV_OPA_COVER;
 for(int i=0;i<4;i++){int x=a.x1+(i&1?26:12),y=a.y1+(i&2?26:12);lv_area_t h={x,y,x+7,y+1};lv_draw_rect(lv_event_get_layer(e),&d,&h);lv_area_t v={x+(i&1?6:0),y+(i&2?-6:0),x+(i&1?7:1),y+(i&2?1:7)};lv_draw_rect(lv_event_get_layer(e),&d,&v);}
}
static void avatar_toggle_click(lv_event_t *e){(void)e;tal_mutex_lock(lock);avatar_config.fullscreen=!avatar_config.fullscreen;avatar_dirty=true;tal_mutex_unlock(lock);}
static lv_obj_t *avatar_part(lv_obj_t *parent){lv_obj_t *o=lv_obj_create(parent);lv_obj_remove_flag(o,LV_OBJ_FLAG_SCROLLABLE);lv_obj_remove_flag(o,LV_OBJ_FLAG_CLICKABLE);lv_obj_set_style_border_width(o,0,0);lv_obj_set_style_pad_all(o,0,0);lv_obj_set_style_radius(o,LV_RADIUS_CIRCLE,0);return o;}
static void shape(lv_obj_t *o,int x,int y,int w,int h,unsigned color,int radius){lv_obj_set_pos(o,x,y);lv_obj_set_size(o,w,h);lv_obj_set_style_bg_color(o,lv_color_hex(color),0);lv_obj_set_style_radius(o,radius,0);}
static void avatar_tick(lv_timer_t *timer){
 (void)timer;tal_mutex_lock(lock);avatar_config_t c=avatar_config;int state=avatar_state;uint32_t epoch=avatar_epoch;bool dirty=avatar_dirty;avatar_dirty=false;tal_mutex_unlock(lock);
 if(dirty)tal_kv_set("hs.avatar.v1",(const uint8_t *)&c,sizeof(c));
 const hs_avatar_theme_t *t=&avatar_themes[c.theme];
 static int layout=-1;
 if(layout!=c.fullscreen){layout=c.fullscreen;lv_obj_t *screen=lv_screen_active();
  for(unsigned i=0;i<avatar_base_children;i++){lv_obj_t *o=lv_obj_get_child(screen,i);if(o==face||o==avatar_toggle||o==avatar_stop||o==avatar_status)continue;if(layout)lv_obj_add_flag(o,LV_OBJ_FLAG_HIDDEN);else lv_obj_remove_flag(o,LV_OBJ_FLAG_HIDDEN);}
  if(layout)lv_obj_remove_flag(avatar_status,LV_OBJ_FLAG_HIDDEN);else lv_obj_add_flag(avatar_status,LV_OBJ_FLAG_HIDDEN);
  lv_label_set_text(lv_obj_get_child(avatar_toggle,0),layout?LV_SYMBOL_LEFT:"");lv_obj_set_pos(avatar_toggle,layout?424:158,layout?8:46);lv_obj_set_pos(avatar_stop,layout?372:106,layout?8:46);
 }
 tal_mutex_lock(lock);bool active=session_active;tal_mutex_unlock(lock);
 if(active)lv_obj_remove_flag(avatar_stop,LV_OBJ_FLAG_HIDDEN);else lv_obj_add_flag(avatar_stop,LV_OBJ_FLAG_HIDDEN);
 uint32_t age=lv_tick_get()-epoch;int phase=(age/50)%40;int wave=phase<20?phase:40-phase;int bob=(wave-10)/4;
 int w=c.fullscreen?260:184,h=c.fullscreen?232:166;int x=c.fullscreen?110:20,y=(c.fullscreen?52:82)+bob;
 if(state==HS_FACE_WAKE&&age<600)x+=(age/100)%2?6:-6;
 if(state==HS_FACE_ANGRY)x+=(age/120)%2?3:-3;
 shape(face,x,y,w,h,t->body,t->radius);
 int ew=t->eye_width,eh=t->eye_height;if(c.fullscreen){ew=ew*3/2;eh=eh*3/2;}
 bool blink=(age%4200)>4000;
 if(state==HS_FACE_SLEEP)eh=8;else if(blink)eh=4;
 if(state==HS_FACE_HAPPY)eh=8;
 for(int i=0;i<2;i++){
  int ex=w*(i?68:32)/100-ew/2,ey=h*35/100;
  shape(eye[i],ex,ey,ew,eh,0xFFFFFF,ew/2);
  lv_obj_set_style_bg_opa(eye[i],state==HS_FACE_LOVE?LV_OPA_TRANSP:LV_OPA_COVER,0);
  if(state==HS_FACE_LOVE){lv_obj_add_flag(pupil[i],LV_OBJ_FLAG_HIDDEN);}else{lv_obj_remove_flag(pupil[i],LV_OBJ_FLAG_HIDDEN);}
  lv_obj_invalidate(eye[i]);
  int pw=ew*2/3,ph=eh*3/4;if(state==HS_FACE_SURPRISE)pw=ew/2;
  shape(pupil[i],(ew-pw)/2+(state==HS_FACE_THINK?(wave-10)/5:0),(eh-ph)/2,pw,ph,t->ink,pw/2);
  shape(shine[i],pw/4,ph/6,ph>8?6:1,ph>8?7:1,0xFFFFFF,4);
  shape(cheek[i],ex-3,h*65/100,ew+6,9,t->accent,6);
  shape(brow[i],ex,ey-13+(state==HS_FACE_ANGRY?(i?4:0):0),ew,state==HS_FACE_ANGRY?6:2,t->ink,3);
 }
 int mh=state==HS_FACE_SPEAK?8+(age/100%4)*5:state==HS_FACE_SURPRISE?30:state==HS_FACE_HAPPY?18:8;
 shape(mouth,w/2-15,h*67/100,30,mh,t->ink,12);
 static const char *labels[]={"陪着你","醒来啦","正在听","正在想","正在说","好开心","哇","喜欢你","休息中","哼哼","准备拍照","请检查连接"};
 lv_label_set_text(avatar_status,labels[state]);
}
static void refresh(lv_timer_t *timer) {
  (void)timer;
  hs_display_snapshot_t s;
  hs_display_snapshot(&s);
  tal_mutex_lock(lock);bool core_online=backend_connected;tal_mutex_unlock(lock);
  tal_mutex_lock(lock);bool checking=core_checking;hs_err_t check_error=core_check_error;tal_mutex_unlock(lock);
  if(!lv_obj_has_flag(core_panel,LV_OBJ_FLAG_HIDDEN)){
    lv_label_set_text(core_status,checking?"正在检查服务连接…":check_error==HS_ERR_INVALID_STATE?"设备正忙，请稍后重试":core_online?"服务已连接":check_error!=HS_OK?"服务未响应，请检查电脑服务":"服务尚未连接");
    if(checking)lv_obj_add_state(core_retry,LV_STATE_DISABLED);else lv_obj_remove_state(core_retry,LV_STATE_DISABLED);
  }
  if(core_online)lv_obj_add_flag(backend_offline,LV_OBJ_FLAG_HIDDEN);else lv_obj_remove_flag(backend_offline,LV_OBJ_FLAG_HIDDEN);
  bool silent,proactive,listening;hs_t5_preferences(&silent,&proactive,&listening);
  if(!lv_obj_has_flag(settings_panel,LV_OBJ_FLAG_HIDDEN)){
    char line[220];snprintf(line,sizeof(line),"静默：%s   音量：%d%%\n主动招呼：%s   自动接话：%s\n手动接话始终可用",silent?"开":"关",hs_audio_volume_percent(),proactive?"开":"关",listening?"开":"关");lv_label_set_text(settings_status,line);
  }
  tal_mutex_lock(lock);bool active=session_listening;tal_mutex_unlock(lock);
  lv_label_set_text(session_title,active?"小冰正在听…":"萌小冰的小院");
  if (s.revision != rendered) {
    lv_label_set_text(content, s.text);
    lv_obj_scroll_to_y(text_view,0,LV_ANIM_OFF);
    rendered = s.revision;
  }
  hs_wifi_status_t status;hs_wifi_status(&status);
  if(status.connected)lv_obj_add_flag(wifi_offline,LV_OBJ_FLAG_HIDDEN);else lv_obj_remove_flag(wifi_offline,LV_OBJ_FLAG_HIDDEN);
  char connected[120];snprintf(connected,sizeof(connected),status.connected?"当前网络：%s":"当前未连接",status.ssid[0]?status.ssid:"正在读取");
  lv_label_set_text(wifi_current,connected);
  if(wifi_panel&&!lv_obj_has_flag(wifi_panel,LV_OBJ_FLAG_HIDDEN)&&wifi_revision!=status.revision){
    wifi_revision=status.revision;lv_obj_clean(wifi_list);
    visible_count=status.count>HS_WIFI_SCAN_LIMIT?HS_WIFI_SCAN_LIMIT:status.count;
    memcpy(visible_aps,status.aps,visible_count*sizeof(visible_aps[0]));
    for(unsigned i=0;i<visible_count;i++){
      char row[112];snprintf(row,sizeof(row),"%s%s",visible_aps[i].ssid,status.connected&&!strcmp(status.ssid,visible_aps[i].ssid)?"  已连接":"");
      lv_obj_t *b=lv_list_add_button(wifi_list,NULL,row);
      lv_obj_set_style_min_height(b,56,0);lv_obj_set_style_pad_ver(b,10,0);
      lv_obj_t *label=lv_obj_get_child(b,0);if(label){lv_obj_set_width(label,400);lv_label_set_long_mode(label,LV_LABEL_LONG_DOT);}
      lv_obj_add_event_cb(b,choose_wifi,LV_EVENT_CLICKED,(void *)(uintptr_t)i);
    }
    lv_label_set_text(wifi_message,status.message);
  }

}
hs_err_t hs_display_init(void) {
  if (tal_mutex_create_init(&lock) != OPRT_OK)
    return HS_ERR_NO_MEM;
  uint8_t *saved=NULL;size_t size=0;
  if(!tal_kv_get("hs.yard.prefs.v1",&saved,&size)&&size==sizeof(preferences)){
    preferences_t next;memcpy(&next,saved,size);if(next.version==1&&next.volume>=0&&next.volume<=100)preferences=next;
  }
  if(saved)tal_kv_free(saved);
  saved=NULL;size=0;
  if(!tal_kv_get("hs.avatar.v1",&saved,&size)&&size==sizeof(avatar_config)){avatar_config_t next;memcpy(&next,saved,size);if(next.version==1&&next.theme>=0&&next.theme<4&&(next.fullscreen==0||next.fullscreen==1))avatar_config=next;}
  if(saved)tal_kv_free(saved);
  if (register_landscape() != HS_OK)
    return HS_FAIL;
  lv_vendor_init("homestash-t5-lcd");
  lv_obj_t *screen = lv_screen_active();
  if (!screen)
    return HS_FAIL;
  int width = lv_display_get_horizontal_resolution(NULL);
  int height = lv_display_get_vertical_resolution(NULL);
  if (width < 240 || height < 240)
    return HS_ERR_NOT_SUPPORTED;
  lv_obj_remove_flag(screen, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_set_style_bg_color(screen, lv_color_hex(0xFFF6E9), 0);
  lv_obj_set_style_text_font(screen, &hs_font, 0);
  lv_obj_set_style_text_color(screen, lv_color_hex(0x49382F), 0);
  session_title=lv_label_create(screen);lv_label_set_text(session_title,"萌小冰的小院");lv_obj_set_pos(session_title,16,14);
  wifi_icon=button(screen,LV_SYMBOL_WIFI,width-100,2,44,show_wifi,NULL);
  button(screen,LV_SYMBOL_SETTINGS,width-50,2,44,show_settings,NULL);
  backend_icon=button(screen,LV_SYMBOL_UPLOAD,width-150,2,44,show_core,NULL);
  wifi_offline=offline_mark(wifi_icon);backend_offline=offline_mark(backend_icon);
  face=lv_obj_create(screen);lv_obj_remove_flag(face,LV_OBJ_FLAG_SCROLLABLE);lv_obj_set_style_pad_all(face,0,0);lv_obj_set_style_border_width(face,0,0);
  for(int i=0;i<2;i++){
    eye[i]=avatar_part(face);lv_obj_add_event_cb(eye[i],avatar_heart,LV_EVENT_DRAW_MAIN,NULL);pupil[i]=avatar_part(eye[i]);shine[i]=avatar_part(pupil[i]);cheek[i]=avatar_part(face);brow[i]=avatar_part(face);
  }
  mouth=avatar_part(face);
  text_view=lv_obj_create(screen);lv_obj_set_pos(text_view,222,92);lv_obj_set_size(text_view,width-238,148);
  lv_obj_set_style_bg_opa(text_view,LV_OPA_TRANSP,0);lv_obj_set_style_border_width(text_view,0,0);
  lv_obj_set_style_pad_all(text_view,4,0);lv_obj_set_scroll_dir(text_view,LV_DIR_VER);
  lv_obj_set_scrollbar_mode(text_view,LV_SCROLLBAR_MODE_AUTO);
  content=lv_label_create(text_view);lv_obj_set_width(content,lv_pct(100));lv_obj_set_height(content,LV_SIZE_CONTENT);
  lv_obj_add_flag(content,LV_OBJ_FLAG_SCROLL_CHAIN_VER);
  lv_label_set_long_mode(content,LV_LABEL_LONG_WRAP);lv_label_set_text(content,"正在醒来，请稍候。");
  button(screen,"唤醒",8,264,148,clicked,(void *)(intptr_t)2);
  button(screen,"拍照",166,264,148,clicked,(void *)(intptr_t)3);
  button(screen,"回忆",324,264,148,clicked,(void *)(intptr_t)4);
  avatar_toggle=button(screen,"",158,46,44,avatar_toggle_click,NULL);
  lv_obj_set_style_text_font(lv_obj_get_child(avatar_toggle,0),&lv_font_montserrat_14,0);
  lv_obj_add_event_cb(avatar_toggle,fullscreen_icon,LV_EVENT_DRAW_MAIN_END,NULL);
  avatar_stop=button(screen,LV_SYMBOL_STOP,106,46,44,clicked,(void *)(intptr_t)5);
  lv_obj_t *controls[]={avatar_toggle,avatar_stop};
  for(unsigned i=0;i<2;i++){lv_obj_set_style_radius(controls[i],22,0);lv_obj_set_style_bg_color(controls[i],lv_color_hex(i?0xFBE7EA:0xEDF3F1),0);lv_obj_set_style_text_color(controls[i],lv_color_hex(i?0xA03C53:0x365E58),0);lv_obj_set_style_shadow_width(controls[i],0,0);}
  lv_obj_add_flag(avatar_stop,LV_OBJ_FLAG_HIDDEN);
  avatar_status=lv_label_create(screen);lv_obj_set_pos(avatar_status,16,14);lv_obj_add_flag(avatar_status,LV_OBJ_FLAG_HIDDEN);
  avatar_base_children=lv_obj_get_child_count(screen);
  wifi_panel=lv_obj_create(screen);lv_obj_set_size(wifi_panel,width,height);lv_obj_set_pos(wifi_panel,0,0);
  lv_obj_set_style_pad_all(wifi_panel,8,0);lv_obj_remove_flag(wifi_panel,LV_OBJ_FLAG_SCROLLABLE);lv_obj_set_style_bg_color(wifi_panel,lv_color_hex(0xFFF6E9),0);
  button(wifi_panel,"返回",0,0,88,close_wifi,NULL);button(wifi_panel,"扫描",width-128,0,104,scan_wifi,NULL);
  lv_obj_t *wifi_title=lv_label_create(wifi_panel);lv_label_set_text(wifi_title,"选择网络");lv_obj_set_pos(wifi_title,150,6);
  wifi_current=lv_label_create(wifi_panel);lv_obj_set_pos(wifi_current,0,54);lv_obj_set_width(wifi_current,width-24);lv_label_set_long_mode(wifi_current,LV_LABEL_LONG_SCROLL_CIRCULAR);
  wifi_message=lv_label_create(wifi_panel);lv_obj_set_pos(wifi_message,0,88);lv_obj_set_width(wifi_message,width-24);lv_label_set_long_mode(wifi_message,LV_LABEL_LONG_DOT);lv_label_set_text(wifi_message,"点击网络，进入密码页面");
  wifi_list=lv_list_create(wifi_panel);lv_obj_set_pos(wifi_list,0,124);lv_obj_set_size(wifi_list,width-24,height-144);
  lv_obj_set_style_pad_all(wifi_list,4,0);lv_obj_set_style_pad_row(wifi_list,8,0);
  lv_obj_add_flag(wifi_panel,LV_OBJ_FLAG_HIDDEN);
  password_panel=lv_obj_create(screen);lv_obj_set_size(password_panel,width,height);lv_obj_set_pos(password_panel,0,0);lv_obj_set_style_pad_all(password_panel,8,0);lv_obj_set_style_border_width(password_panel,0,0);lv_obj_remove_flag(password_panel,LV_OBJ_FLAG_SCROLLABLE);lv_obj_set_style_bg_color(password_panel,lv_color_hex(0xFFF6E9),0);
  button(password_panel,"返回",0,0,88,back_to_networks,NULL);button(password_panel,"连接保存",width-160,0,136,connect_wifi,NULL);
  password_network=lv_label_create(password_panel);lv_obj_set_pos(password_network,104,6);lv_obj_set_width(password_network,width-278);lv_label_set_long_mode(password_network,LV_LABEL_LONG_SCROLL_CIRCULAR);
  password=lv_textarea_create(password_panel);lv_obj_set_pos(password,0,60);lv_obj_set_size(password,width-128,56);
  lv_textarea_set_one_line(password,true);lv_textarea_set_password_mode(password,true);lv_textarea_set_max_length(password,64);lv_textarea_set_placeholder_text(password,"输入网络密码");
  lv_obj_add_event_cb(password,show_password_keyboard,LV_EVENT_CLICKED,NULL);
  lv_obj_add_event_cb(password,show_password_keyboard,LV_EVENT_FOCUSED,NULL);
  password_visibility=button(password_panel,"显示",width-120,64,96,toggle_password,NULL);
  password_note=lv_label_create(password_panel);lv_obj_set_pos(password_note,0,122);lv_obj_set_width(password_note,width-24);lv_label_set_long_mode(password_note,LV_LABEL_LONG_DOT);
  keyboard=lv_keyboard_create(password_panel);lv_obj_set_size(keyboard,width-24,144);lv_obj_align(keyboard,LV_ALIGN_TOP_LEFT,0,160);
  lv_obj_add_event_cb(keyboard,password_keyboard_event,LV_EVENT_READY,NULL);
  lv_obj_add_event_cb(keyboard,password_keyboard_event,LV_EVENT_CANCEL,NULL);
  lv_obj_set_style_text_font(keyboard,&lv_font_montserrat_14,LV_PART_ITEMS);lv_keyboard_set_textarea(keyboard,password);
  lv_obj_add_flag(password_panel,LV_OBJ_FLAG_HIDDEN);
  settings_panel=lv_obj_create(screen);lv_obj_set_size(settings_panel,width,height);lv_obj_set_pos(settings_panel,0,0);lv_obj_set_style_pad_all(settings_panel,8,0);
  button(settings_panel,"返回",0,0,80,close_settings,NULL);
  settings_status=lv_label_create(settings_panel);lv_obj_set_pos(settings_status,0,52);lv_obj_set_width(settings_status,width-24);
  button(settings_panel,"静默",0,160,140,preference_click,(void *)(intptr_t)0);
  button(settings_panel,"主动招呼",148,160,144,preference_click,(void *)(intptr_t)1);
  button(settings_panel,"自动接话",300,160,144,preference_click,(void *)(intptr_t)2);
  button(settings_panel,"音量减",0,218,140,preference_click,(void *)(intptr_t)3);
  button(settings_panel,"音量加",148,218,144,preference_click,(void *)(intptr_t)4);
  lv_obj_add_flag(settings_panel,LV_OBJ_FLAG_HIDDEN);
  core_panel=lv_obj_create(screen);lv_obj_set_size(core_panel,width,height);lv_obj_set_pos(core_panel,0,0);lv_obj_set_style_pad_all(core_panel,8,0);
  button(core_panel,"返回",0,0,80,close_core,NULL);
  lv_obj_t *core_title=lv_label_create(core_panel);lv_label_set_text(core_title,"服务连接");lv_obj_set_pos(core_title,190,8);
  core_status=lv_label_create(core_panel);lv_obj_set_pos(core_status,0,62);lv_obj_set_size(core_status,width-24,64);lv_label_set_long_mode(core_status,LV_LABEL_LONG_WRAP);
  core_address=lv_label_create(core_panel);lv_obj_set_pos(core_address,0,140);lv_obj_set_width(core_address,width-24);lv_label_set_long_mode(core_address,LV_LABEL_LONG_SCROLL_CIRCULAR);
  core_retry=button(core_panel,"重新检查",0,204,160,retry_core,NULL);
  lv_obj_t *core_hint=lv_label_create(core_panel);lv_label_set_text(core_hint,"请与电脑连接同一网络");lv_obj_set_pos(core_hint,0,264);
  lv_obj_add_flag(core_panel,LV_OBJ_FLAG_HIDDEN);
  lv_timer_create(refresh, 100, NULL);
  lv_timer_create(avatar_tick,50,NULL);
  lv_vendor_start(5, 8192);
  HS_LOGI("display", "pet resolution=%dx%d", width, height);
  return HS_OK;
}
void hs_display_text(const char *text) {
  tal_mutex_lock(lock);
  snprintf(snapshot.text, sizeof(snapshot.text), "%s", text ? text : "");
  snapshot.revision++;
  tal_mutex_unlock(lock);
}
void hs_display_network(const char *ssid, bool connected) {
  tal_mutex_lock(lock);
  char next[96];
  snprintf(next, sizeof(next), connected ? "已连接：%s" : "网络未连接",
           ssid ? ssid : "");
  if (strcmp(next, snapshot.network)) {
    snprintf(snapshot.network, sizeof(snapshot.network), "%s", next);
    snapshot.revision++;
  }
  tal_mutex_unlock(lock);
}
void hs_display_snapshot(hs_display_snapshot_t *out) {
  tal_mutex_lock(lock);
  *out = snapshot;
  tal_mutex_unlock(lock);
}
void hs_display_navigation(void (*callback)(int)) {
  tal_mutex_lock(lock);
  navigate = callback;
  tal_mutex_unlock(lock);
}
void hs_display_select_page(int page) {
  tal_mutex_lock(lock);
  if (page >= 0 && page < 6)
    selected = page;
  tal_mutex_unlock(lock);
}
hs_err_t hs_display_backlight(bool enabled) {
  (void)enabled;
  return HS_ERR_NOT_SUPPORTED;
}
hs_err_t hs_display_suspend(void) { return HS_ERR_NOT_SUPPORTED; }
hs_err_t hs_display_resume(void) { return HS_ERR_NOT_SUPPORTED; }
void hs_display_backend(bool connected) { tal_mutex_lock(lock);backend_connected=connected;tal_mutex_unlock(lock); }
void hs_display_dialogue(int state) { if(state<0||state>HS_FACE_ERROR)return;tal_mutex_lock(lock);if(avatar_state!=state){avatar_state=state;avatar_epoch=lv_tick_get();}tal_mutex_unlock(lock); }
