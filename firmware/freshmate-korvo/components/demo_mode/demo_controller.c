#include "hs_demo.h"
#include "demo_scenes.h"
#include "door_event_source.h"
#include "hs_audio.h"
#include "hs_avatar.h"
#include "hs_network.h"
#include "hs_settings_ui.h"
#include "wifi_profiles.h"
#include "bsp/display.h"
#include "esp_timer.h"
#include "esp_log.h"
#include "freertos/task.h"
#include <stdio.h>
LV_FONT_DECLARE(hs_font);
static QueueHandle_t events,done;
static lv_obj_t *body,*title,*hint,*cards[6],*enter_demo,*home,*online_button,*avatar,*controls[4];
static int selected,step,page;
static demo_door_t door_state;
#define opens door_state.count
#define close_at door_state.close_at_us
#define last_open door_state.last_open_us
static bool playing,finished,online;
static volatile bool active;
bool hs_demo_active(void){return active;}
static volatile bool cancel_audio;
static void touch(lv_event_t *e){int a=(int)(intptr_t)lv_event_get_user_data(e);xQueueSend(events,&a,0);}
static void playback(void *arg){const demo_step_t *s=arg;esp_err_t err=hs_audio_demo(s->pcm,s->bytes,&cancel_audio);xQueueSend(done,&err,portMAX_DELAY);vTaskDelete(NULL);}
static void render(const char *reply){
 const demo_scene_t *s=&demo_scenes[selected]; char text[1600];
 if(page==0)snprintf(text,sizeof(text),"小冰准备好啦！选择离线演示或联网语音演示。\n返回主页进入真实产品。");
 else if(page==1)snprintf(text,sizeof(text),"%s 01 叫醒小冰       %s 02 冰箱开门\n%s 03 你又来啦       %s 04 草莓救援\n%s 05 今晚吃什么     %s 06 电量告急\n\nVOL 选场景，PLAY 开始",selected==0?">":" ",selected==1?">":" ",selected==2?">":" ",selected==3?">":" ",selected==4?">":" ",selected==5?">":" ");
 else if(reply)snprintf(text,sizeof(text),"%s",reply);
 else if(finished)snprintf(text,sizeof(text),"演示完成！PLAY 再来一次，返回选择场景。\n%s",s->seed);
 else snprintf(text,sizeof(text),"%s\n%s",online && (selected==1||selected==2)?"请说：打开冰箱":online && selected==3 && step==0?"请说：草莓怎么样":online && selected==5 && step==0?"请说：电量告急":s->steps[step].cue,online?"先说：小冰小冰，再说提示词":"PLAY 播放预置回答");
 if(bsp_display_lock(-1)){
 if(page==2)lv_label_set_text_fmt(title,"%02d %s / %s",selected+1,s->title,online?"联网演示":"离线演示");else lv_label_set_text(title,"FreshMate 小冰 / 演示馆");
 for(int i=0;i<6;i++){lv_obj_set_style_bg_color(cards[i],lv_color_hex(i==selected?0x765194:0xafa0bd),0);if(page==1)lv_obj_remove_flag(cards[i],LV_OBJ_FLAG_HIDDEN);else lv_obj_add_flag(cards[i],LV_OBJ_FLAG_HIDDEN);}
 if(page==0)lv_obj_remove_flag(enter_demo,LV_OBJ_FLAG_HIDDEN);else lv_obj_add_flag(enter_demo,LV_OBJ_FLAG_HIDDEN);
 for(int i=0;i<4;i++){if(page==2 || (page==1 && i==2))lv_obj_remove_flag(controls[i],LV_OBJ_FLAG_HIDDEN);else lv_obj_add_flag(controls[i],LV_OBJ_FLAG_HIDDEN);}
 hs_avatar_state(avatar,playing?HS_AVATAR_SPEAK:HS_AVATAR_IDLE);
 if(page==1)lv_obj_add_flag(avatar,LV_OBJ_FLAG_HIDDEN);else lv_obj_remove_flag(avatar,LV_OBJ_FLAG_HIDDEN);
 lv_obj_add_flag(hint,LV_OBJ_FLAG_HIDDEN);
 if(page==0){lv_obj_remove_flag(home,LV_OBJ_FLAG_HIDDEN);lv_obj_remove_flag(online_button,LV_OBJ_FLAG_HIDDEN);}else{lv_obj_add_flag(home,LV_OBJ_FLAG_HIDDEN);lv_obj_add_flag(online_button,LV_OBJ_FLAG_HIDDEN);}
 lv_label_set_text(body,page==1?"":text);lv_label_set_text(hint,page==2?"PLAY 下一步/重播 | SET 开门 | VOL 音量 | 长按 PLAY 返回":"无需联网 · 预设交互体验 | VOL 选择 | 长按 PLAY 返回主页");bsp_display_unlock();}
 ESP_LOGI("小冰演示","LCD page=%d scene=%d step=%d playing=%d: %s",page,selected+1,step+1,playing,text);
}
static void demo_run(QueueHandle_t inputs,int first_page){
 active=true;events=inputs;done=xQueueCreate(1,sizeof(esp_err_t));configASSERT(done);
 lv_obj_t *previous=NULL,*screen=NULL;
 if(bsp_display_lock(-1)){
 previous=lv_screen_active();screen=lv_obj_create(NULL);lv_obj_set_style_bg_color(screen,lv_color_hex(0xfff5ed),0);lv_obj_set_style_text_font(screen,&hs_font,0);lv_obj_set_style_text_color(screen,lv_color_hex(0x514165),0);
 title=lv_label_create(screen);lv_obj_set_width(title,600);lv_obj_align(title,LV_ALIGN_TOP_LEFT,24,18);
 body=lv_label_create(screen);lv_obj_set_width(body,750);lv_obj_set_height(body,130);lv_obj_align(body,LV_ALIGN_TOP_LEFT,24,292);
 avatar=hs_avatar_create(screen,265,62);
 hint=lv_label_create(screen);lv_obj_set_width(hint,750);lv_obj_align(hint,LV_ALIGN_BOTTOM_LEFT,24,-12);
 const char *labels[]={"PLAY 下一步","SET 开门","返回","重来"};int actions[]={3,1,30,33};
 for(int i=0;i<4;i++){lv_obj_t *b=controls[i]=lv_button_create(screen);lv_obj_set_size(b,175,48);lv_obj_align(b,LV_ALIGN_BOTTOM_LEFT,24+i*190,-14);lv_obj_set_style_bg_color(b,lv_color_hex(0x9474b4),0);lv_obj_t *l=lv_label_create(b);lv_label_set_text(l,labels[i]);lv_obj_center(l);lv_obj_add_event_cb(b,touch,LV_EVENT_CLICKED,(void*)(intptr_t)actions[i]);}
 for(int i=0;i<6;i++){cards[i]=lv_button_create(screen);lv_obj_set_size(cards[i],355,78);lv_obj_align(cards[i],LV_ALIGN_TOP_LEFT,24+(i%2)*380,82+(i/2)*90);lv_obj_set_style_bg_color(cards[i],lv_color_hex(0x9474b4),0);lv_obj_t *l=lv_label_create(cards[i]);lv_label_set_text_fmt(l,"%02d %s",i+1,demo_scenes[i].title);lv_obj_center(l);lv_obj_add_event_cb(cards[i],touch,LV_EVENT_CLICKED,(void*)(intptr_t)(40+i));}
 enter_demo=lv_button_create(screen);lv_obj_set_size(enter_demo,230,48);lv_obj_align(enter_demo,LV_ALIGN_BOTTOM_LEFT,24,-14);lv_obj_set_style_bg_color(enter_demo,lv_color_hex(0x765194),0);lv_obj_t *entry_label=lv_label_create(enter_demo);lv_label_set_text(entry_label,"进入演示馆");lv_obj_center(entry_label);lv_obj_add_event_cb(enter_demo,touch,LV_EVENT_CLICKED,(void*)(intptr_t)3);
 home=lv_button_create(screen);lv_obj_set_size(home,200,48);lv_obj_align(home,LV_ALIGN_BOTTOM_RIGHT,-24,-14);lv_obj_t *hl=lv_label_create(home);lv_label_set_text(hl,"返回主页");lv_obj_center(hl);lv_obj_add_event_cb(home,touch,LV_EVENT_CLICKED,(void*)(intptr_t)1);
 online_button=lv_button_create(screen);lv_obj_set_size(online_button,250,48);lv_obj_align(online_button,LV_ALIGN_BOTTOM_MID,0,-14);lv_obj_t *ol=lv_label_create(online_button);lv_label_set_text(ol,"联网语音演示");lv_obj_center(ol);lv_obj_add_event_cb(online_button,touch,LV_EVENT_CLICKED,(void*)(intptr_t)35);
 lv_screen_load(screen);bsp_display_unlock();}
 hs_wifi_pause(true);online=false;door_state=(demo_door_t){0};page=first_page;selected=0;step=0;playing=false;finished=false;render(NULL);
 bool settings_visible=false;
 for(;;){int action=0;esp_err_t result;
 hs_settings_ui_busy(playing);
 bool settings_now=hs_settings_ui_active();
 if(settings_now!=settings_visible){hs_audio_voice_pause();hs_wifi_pause(settings_now?false:!online);if(settings_now)hs_wifi_scan();settings_visible=settings_now;}

 if(xQueueReceive(done,&result,0)){playing=false;hs_audio_voice_listen();if(!cancel_audio){if(result==ESP_OK){step++;finished=step>=demo_scenes[selected].count;}render(result==ESP_OK?NULL:"呜，声音没出来！请重试，字幕仍可查看。");}else render(NULL);}
 if(settings_now){vTaskDelay(pdMS_TO_TICKS(30));continue;}
 int64_t now=esp_timer_get_time();
 if(close_at && now>=close_at){demo_door_event(&door_state,(door_event_t){DOOR_CLOSE,DEMO_BUTTON_DOOR_SOURCE,now});ESP_LOGI("小冰演示","DOOR_CLOSE source=DemoButtonDoorSource");if(!playing)render(NULL);}
 bool received=xQueueReceive(events,&action,online && !playing && !finished && page==2?0:pdMS_TO_TICKS(30));
 if(!received && online && !playing && !finished && page==2){
   hs_wifi_status_t wifi;hs_wifi_status(&wifi);
   if(wifi.connected){int voice=hs_audio_voice_poll(true);
     int expected=selected==0?(step==0?100:1):selected==3?(step==0?7:2):selected==4?(step==0?3:step==1?4:5):selected==5?(step==0?8:6):9;
     if(voice==100 && expected!=100){hs_audio_voice_pause();if(bsp_display_lock(-1)){hs_avatar_state(avatar,HS_AVATAR_SPEAK);bsp_display_unlock();}hs_demo_ack();hs_audio_voice_listen();render(NULL);if(bsp_display_lock(-1)){hs_avatar_state(avatar,HS_AVATAR_LISTEN);bsp_display_unlock();}}
     if(voice==expected){action=(selected==1||selected==2)?1:3;received=true;}
   }else{hs_audio_voice_pause();vTaskDelay(pdMS_TO_TICKS(30));}
 }else if(!playing)hs_audio_voice_pause();
 if(!received)continue;
 if(action==2){ESP_LOGI("小冰演示","status offline=1 scene=%d step=%d opens=%d playing=%d",selected+1,step+1,opens,playing);continue;}
 if(action==30){hs_audio_voice_pause();cancel_audio=true;page=page==2?1:0;step=0;finished=false;close_at=0;opens=0;render(NULL);continue;}
 if(page==2 && (action==31||action==32)){hs_audio_demo_volume(action==31?1:-1);continue;}
 if(playing)continue;
 if(page==0 && action==1){hs_audio_voice_pause();break;}
 if(page==0 && action==35){hs_wifi_pause(false);online=true;page=1;render(NULL);continue;}
 if(page==0 && action==3){hs_wifi_pause(true);online=false;page=1;render(NULL);continue;}
 if(page==1 && action>=40 && action<46){selected=action-40;action=3;}
 if(page==1){if(action==31||action==32){selected=(selected+(action==31?1:5))%6;render(NULL);}else if(action==3||action==1){page=2;step=0;opens=0;last_open=0;close_at=0;finished=false;render(NULL);}continue;}
 if(page!=2)continue;
 if(action==31||action==32){hs_audio_demo_volume(action==31?1:-1);continue;}
 if(action==33 || (finished&&action==3)){step=0;opens=0;close_at=0;last_open=0;finished=false;render(NULL);continue;}
 bool door=selected==1||selected==2;
 if(door && action==1){if(!demo_door_event(&door_state,(door_event_t){DOOR_OPEN,DEMO_BUTTON_DOOR_SOURCE,now}))continue;ESP_LOGI("小冰演示","DOOR_OPEN source=DemoButtonDoorSource count=%d",opens);if(selected==1){step=0;finished=false;}}
 if(finished || (door?action!=1:action!=3))continue;
 hs_audio_voice_pause();cancel_audio=false;playing=true;render(demo_scenes[selected].steps[step].reply);
 if(xTaskCreate(playback,"离线语音",8192,(void*)&demo_scenes[selected].steps[step],4,NULL)!=pdPASS){playing=false;render("音频任务启动失败，请重试。");}
 }
 if(bsp_display_lock(-1)){lv_screen_load(previous);lv_obj_delete(screen);bsp_display_unlock();}vQueueDelete(done);hs_wifi_pause(false);hs_settings_ui_busy(false);active=false;
}

void hs_demo_run(QueueHandle_t inputs){demo_run(inputs,0);}
void hs_demo_open_menu(QueueHandle_t inputs){demo_run(inputs,0);}
