#include "hs_avatar.h"
/* 使用原生矢量控件，避免位图解码与大帧缓存；所有调用由 LVGL 锁保护。 */
static lv_obj_t *shape(lv_obj_t *p,int x,int y,int w,int h,unsigned color,int radius){
 lv_obj_t *o=lv_obj_create(p);lv_obj_remove_style_all(o);lv_obj_set_pos(o,x,y);lv_obj_set_size(o,w,h);lv_obj_set_style_bg_opa(o,LV_OPA_COVER,0);lv_obj_set_style_bg_color(o,lv_color_hex(color),0);lv_obj_set_style_radius(o,radius,0);return o;
}
static void animate(lv_timer_t *timer){
 lv_obj_t *a=lv_timer_get_user_data(timer);unsigned t=lv_tick_get()/180;int state=(int)(intptr_t)lv_obj_get_user_data(a);
 lv_obj_t *left=lv_obj_get_child(a,0),*right=lv_obj_get_child(a,1),*mouth=lv_obj_get_child(a,4);
 int eyes=t%29==0?4:22;lv_obj_set_height(left,eyes);lv_obj_set_height(right,eyes);
 lv_obj_set_size(mouth,state==HS_AVATAR_SPEAK?24+(t%3)*10:32,state==HS_AVATAR_SPEAK?12+(t%3)*13:state==HS_AVATAR_LISTEN?24:8);
 lv_obj_set_style_translate_y(a,state==HS_AVATAR_SPEAK?(t%2? -3:3):0,0);
 lv_obj_set_style_border_color(a,lv_color_hex(state==HS_AVATAR_LISTEN?0x48bfa9:state==HS_AVATAR_ERROR?0xda8860:0xee8db5),0);
}
static void cleanup(lv_event_t *e){lv_timer_delete(lv_event_get_user_data(e));}
lv_obj_t *hs_avatar_create(lv_obj_t *parent,int x,int y){
 lv_obj_t *a=shape(parent,x,y,270,220,0xffe1ec,55);lv_obj_remove_flag(a,LV_OBJ_FLAG_SCROLLABLE);lv_obj_set_style_border_width(a,3,0);lv_obj_set_style_border_color(a,lv_color_hex(0xee8db5),0);
 shape(a,65,65,22,22,0x392e40,20);shape(a,180,65,22,22,0x392e40,20);
 shape(a,40,108,34,28,0xf7acc6,20);shape(a,195,108,34,28,0xf7acc6,20);
 shape(a,119,113,32,8,0xe74b87,15);
 lv_obj_t *name=lv_label_create(a);lv_label_set_text(name,"小冰");lv_obj_align(name,LV_ALIGN_BOTTOM_MID,0,-16);lv_obj_set_style_text_color(name,lv_color_hex(0xe74b87),0);
 lv_timer_t *timer=lv_timer_create(animate,180,a);lv_obj_add_event_cb(a,cleanup,LV_EVENT_DELETE,timer);return a;
}
void hs_avatar_state(lv_obj_t *a,hs_avatar_state_t state){if(a)lv_obj_set_user_data(a,(void*)(intptr_t)state);}
