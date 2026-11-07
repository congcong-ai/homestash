#include "hs_runtime.h"
#include "hs_board.h"
#include "hs_audio.h"
#include "hs_display.h"
#include "hs_storage.h"
#include "hs_outbox.h"
#include "hs_network.h"
#include "hs_transport.h"
#include "hs_device_config.h"
#include "yard_state.h"
#include "yard_mode.h"
#include "local_replies.h"
#include "yard_greeting.h"
#include <string.h>
#include "hs_fs.h"
int hs_photo_archive(const char *,const void *,size_t);
int hs_recording_sent(const char *);
hs_err_t hs_transport_photo_archive_sync(void);
int hs_recording_archive(const char *id);
hs_err_t hs_transport_recording_sync(void);
hs_err_t hs_transport_yard_active(void);
void hs_transport_yard_command_mode(bool enabled);
hs_err_t hs_transport_yard_silent(bool *silent);
#include <stdio.h>
#include "tal_memory.h"
#include "cJSON.h"
int hs_t5_uvc_photo(unsigned char **bytes,size_t *size,const volatile bool *cancel);
hs_err_t hs_transport_yard_photo(const char *,const char *,const void *,size_t,char *,size_t);
/* T5 产品入口：不注册旧相机/库存动作，旧 Korvo 应用保持原样。 */
static hs_queue_t inputs, work_queue, done_queue;
void hs_t5_audio_cancel(bool cancel);
void hs_t5_audio_quiesce(void);
void hs_t5_audio_barge_arm(bool enabled);
bool hs_t5_audio_barge_requested(void);
void hs_t5_audio_barge_discard(void);
void hs_t5_audio_barge_resume(void);
void hs_t5_display_listening(bool active);
bool hs_t5_audio_heard(void);
#ifndef HS_YARD_IDLE_MS
#define HS_YARD_IDLE_MS 30000
#endif
void hs_t5_core_check_result(hs_err_t result);
void hs_t5_preferences_apply_volume(void);
void hs_t5_preferences(bool *silent,bool *proactive,bool *listening);
typedef struct {unsigned generation; int kind; char id[37]; bool silent; bool interruptible; bool command;} yard_job_t;
typedef struct {unsigned generation; int kind; bool completed; bool stop; bool take_photo; bool remote_silent; char message[1024];} yard_result_t;
static volatile bool cancelled;
static volatile bool greeting_stop;
static volatile bool maintenance_cancelled;
bool hs_t5_maintenance_cancelled(void){return maintenance_cancelled;}
static bool photo_ready;
bool hs_transport_yard_stop_requested(void);
bool hs_transport_yard_photo_requested(void);
hs_err_t hs_transport_yard_photo_poll(bool,char *,size_t);
static hs_err_t avatar_demo(const signed char *pcm,size_t size,volatile bool *cancel){if(*cancel)return HS_FAIL;hs_display_dialogue(HS_FACE_SPEAK);hs_err_t e=hs_audio_demo(pcm,size,cancel);hs_display_dialogue(*cancel?HS_FACE_IDLE:HS_FACE_HAPPY);return e;}
static void worker(void *arg) {
 (void)arg;yard_job_t job;
 for(;;) {
  if(!hs_queue_receive(work_queue,&job,HS_WAIT_FOREVER))continue;
  yard_result_t result={.generation=job.generation,.kind=job.kind};
  if(job.kind==33){hs_transport_yard_active();hs_queue_send(done_queue,&result,HS_WAIT_FOREVER);continue;}
  if(job.kind==30){hs_t5_core_check_result(hs_transport_heartbeat());hs_queue_send(done_queue,&result,HS_WAIT_FOREVER);continue;}
  if(job.kind==32){
    hs_transport_heartbeat();
    if(!maintenance_cancelled)hs_transport_yard_silent(&result.remote_silent);
    if(!maintenance_cancelled)hs_transport_recording_sync();
    if(!maintenance_cancelled)hs_transport_photo_archive_sync();
    hs_queue_send(done_queue,&result,HS_WAIT_FOREVER);continue;
  }
  if(job.kind==31){
    if(hs_transport_yard_photo_poll(photo_ready,result.message,sizeof(result.message))!=HS_OK)result.message[0]=0;
    hs_queue_send(done_queue,&result,HS_WAIT_FOREVER);continue;
  }
  if(job.kind==13) {
    hs_display_dialogue(HS_FACE_PHOTO);
    unsigned char *jpeg=NULL;size_t length=0;
    bool archived=false;
    if(!cancelled&&hs_t5_uvc_photo(&jpeg,&length,&cancelled)==0&&!cancelled){
      archived=hs_photo_archive(job.id,jpeg,length)==0;
      if(archived&&!cancelled&&hs_transport_yard_photo(job.id,"begin",NULL,0,NULL,0)==HS_OK){
        hs_display_text("照片已存SD，正在传到家庭网页。");
        result.completed=hs_transport_yard_photo(job.id,"upload",jpeg,length,NULL,0)==HS_OK&&!cancelled;
        if(result.completed)hs_recording_sent(job.id);
      }
    }
    photo_ready=jpeg!=NULL;tal_psram_free(jpeg);
    if(cancelled&&archived){hs_recording_sent(job.id);}
    hs_display_dialogue(cancelled?HS_FACE_IDLE:(result.completed||archived)?HS_FACE_HAPPY:HS_FACE_ERROR);
    snprintf(result.message,sizeof(result.message),"%s",cancelled?"这次拍照已停止。":result.completed?"照片已到网页，请预览后保存、重拍或放弃。":archived?"照片已存SD，联网空闲后传到网页待整理照片。":"拍照或SD保存失败，请检查相机和存储。");
  }else if(job.kind==1) {
   hs_transport_yard_command_mode(job.command);
   if(hs_transport_capture(job.id,result.message,sizeof(result.message))==HS_OK && !cancelled) {
    hs_err_t e=HS_OK;
    result.take_photo=hs_transport_yard_photo_requested();result.stop=hs_transport_yard_stop_requested();
    hs_t5_audio_barge_arm(job.interruptible);
    if(!job.silent&&!result.take_photo&&!result.stop){
     hs_display_dialogue(HS_FACE_THINK);hs_display_text("听懂啦，正在准备声音…");if(!strcmp(result.message,"我在，你说。"))e=avatar_demo(yard_hello,sizeof(yard_hello),&cancelled);
     else if(!strcmp(result.message,"不客气。"))e=avatar_demo(yard_thanks,sizeof(yard_thanks),&cancelled);
     else if(!strcmp(result.message,"好，回头聊。"))e=avatar_demo(yard_bye,sizeof(yard_bye),&cancelled);
     else{e=hs_transport_reply(job.id);
      if(e==HS_OK&&!cancelled){hs_display_text("我来说给你听。");hs_display_dialogue(HS_FACE_SPEAK);e=hs_audio_play();hs_display_dialogue(cancelled?HS_FACE_IDLE:HS_FACE_HAPPY);}
     }
     if(e!=HS_OK&&!cancelled)snprintf(result.message,sizeof(result.message),"已听懂，暂时无法播报。点唤醒重试，录音已保留。");
    }
    if(e==HS_OK&&!cancelled){result.completed=hs_recording_archive(job.id)==0;if(!result.completed)snprintf(result.message,sizeof(result.message),"回复已完成，但录音回忆保存失败；原录音保留，请检查SD空间。");}
   }else snprintf(result.message,sizeof(result.message),"Core 暂不可用或本轮已停止。录音保留，可按键重试。");
  }else {
   if(hs_transport_screen(job.kind-10,result.message,sizeof(result.message))!=HS_OK) {
    HS_LOGI("小院","screen Core unavailable");
    snprintf(result.message,sizeof(result.message),"我在小院陪你。短按唤醒，长按停止。");
   }
  }
  /* 明确停止的样本不再进入失败重试；等读盘/HTTP退出后才清理。 */
  if(job.kind==1 && cancelled){hs_t5_audio_quiesce();if(hs_recording_archive(job.id))hs_outbox_complete(job.id);hs_fs_remove(HS_REPLY);hs_fs_remove(HS_REPLY ".tmp");}
  hs_queue_send(done_queue,&result,HS_WAIT_FOREVER);
 }
}
/* 停止信号先打断PCM，队列仍保留停止→新接话的先后顺序。 */
static void queue_action(int n){
 if(n==1||n==12||n==13||n==3||n==15)maintenance_cancelled=true;
 if(n==3||n==15){
  greeting_stop=true;hs_display_dialogue(HS_FACE_IDLE);hs_t5_display_active(false);
  while(!hs_queue_send(inputs,&n,0)){int old;hs_queue_receive(inputs,&old,0);}
 }else hs_queue_send(inputs,&n,0);
}
static void input(hs_action_t a) {queue_action((int)a);}
bool yard_console_start(void (*callback)(int));
static void console_action(int n){queue_action(n);}
static void page(int p) {queue_action(10+p);}
static void make_id(char id[37]) {
 unsigned char b[16];HS_CHECK(hs_random_bytes(b,16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;
 snprintf(id,37,"%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",b[0],b[1],b[2],b[3],b[4],b[5],b[6],b[7],b[8],b[9],b[10],b[11],b[12],b[13],b[14],b[15]);
}
#if HS_YARD_SENSOR_DIAGNOSTICS
void hs_t5_imu_probe(void);
void hs_t5_imu_reset_probe(void);
void hs_t5_imu_raw_probe(void);
void hs_t5_camera_probe(void);
#endif
void yard_app_run(void) {
 HS_CHECK(hs_platform_init());HS_CHECK(hs_device_config_init());
 bool storage=hs_storage_init()==HS_OK;
 #if HS_YARD_SENSOR_DIAGNOSTICS
 hs_t5_imu_probe();
 #endif
 HS_CHECK(hs_display_init());HS_CHECK(hs_audio_init());hs_t5_preferences_apply_volume();HS_CHECK(hs_network_init());
 inputs=hs_queue_create(12,sizeof(int));HS_ASSERT(inputs);HS_CHECK(hs_board_inputs_init(input));hs_display_navigation(page);
 HS_ASSERT(yard_console_start(console_action));
 work_queue=hs_queue_create(1,sizeof(yard_job_t));done_queue=hs_queue_create(1,sizeof(yard_result_t));
 HS_ASSERT(work_queue&&done_queue);HS_ASSERT(hs_task_start(worker,"小院通信",16384,4));
 yard_greeting_state_t greeting_state={.last=YARD_GREETING_NONE};
 bool command_capture=false;
 bool barge_resume=false,maintenance=false,busy=false,remote_silent=false,restart=false,awake=false,request_photo=false,photo_active=false;int64_t idle_until=0,last_photo_poll=0;
 yard_session_t session={.listening=true,.cooldown_ms=1200};char id[37]={0};
 bool pending=storage && hs_outbox_recover(id)==HS_OUTBOX_OK;bool recording=false;int64_t start=0,last_sync=0;
 hs_display_text("萌小冰·食灵小院\n短按用户键唤醒，长按停止。一起养成我们的小院。");
 for(;;) {
   hs_t5_display_active(!cancelled&&(awake||recording||pending||photo_active||request_photo||(busy&&!maintenance)));
   bool local_silent,proactive,listening;hs_t5_preferences(&local_silent,&proactive,&listening);session.silent=local_silent||remote_silent;
   yard_result_t done;
   if(hs_queue_receive(done_queue,&done,0)) {
     busy=false;maintenance=false;
     if(done.kind==31)last_photo_poll=hs_time_us();
     if(done.kind==32&&!maintenance_cancelled)remote_silent=done.remote_silent;
     if(done.kind==13)photo_active=false;
     if(done.kind==31&&!maintenance_cancelled&&!cancelled&&!request_photo&&!restart){
       cJSON *root=cJSON_Parse(done.message);cJSON *job=cJSON_GetObjectItemCaseSensitive(root,"job");cJSON *jid=cJSON_GetObjectItemCaseSensitive(job,"id");
       if(cJSON_IsString(jid)&&strlen(jid->valuestring)==36){yard_job_t shot={.kind=13,.generation=session.generation};snprintf(shot.id,sizeof(shot.id),"%s",jid->valuestring);cancelled=false;hs_t5_audio_cancel(false);busy=hs_queue_send(work_queue,&shot,0);photo_active=busy;awake=false;}
       cJSON_Delete(root);
     }
     if(done.stop&&!cancelled&&yard_current(&session,done.generation))queue_action(3);
     if(done.take_photo&&!cancelled&&yard_current(&session,done.generation)){int photo_action=13;hs_queue_send(inputs,&photo_action,0);awake=false;}
     if(done.kind!=30&&done.kind!=31&&done.kind!=32&&done.kind!=33&&yard_current(&session,done.generation)) {if(done.completed)pending=false;hs_display_text(done.message);session.phase=YARD_REST;idle_until=hs_time_us()+HS_YARD_IDLE_MS*1000LL;}
   }
   int action=0;bool clicked=hs_queue_receive(inputs,&action,(recording||greeting_stop)?0:30);
   bool interrupted=busy&&!cancelled&&hs_t5_audio_barge_requested();
   if(interrupted){clicked=true;action=3;barge_resume=true;HS_LOGI("audio","AEC speech interruption requested");}
   if(clicked && (action==3 || action==15)) {greeting_stop=false;maintenance_cancelled=true;request_photo=false;restart=false;awake=false;hs_t5_display_listening(false);if(recording){hs_audio_stop();recording=false;char path[HS_OUTBOX_PATH_SIZE];if(!hs_outbox_path(id,"part",path,sizeof(path)))hs_fs_remove(path);}
     cancelled=true;hs_t5_audio_cancel(true);
     if(!busy)hs_t5_audio_quiesce();
     if(pending&&!busy){hs_outbox_complete(id);hs_fs_remove(HS_REPLY);hs_fs_remove(HS_REPLY ".tmp");}
     pending=false;id[0]=0;yard_cancel(&session);session.last_door=0;if(interrupted){restart=true;hs_display_text("好，你说，我在听。");}else{barge_resume=false;hs_t5_audio_barge_discard();hs_display_text("这次已停止，我们歇一会儿。");}continue;}
   if(clicked&&action==30){
     if(busy||recording){hs_t5_core_check_result(HS_ERR_INVALID_STATE);continue;}
     maintenance_cancelled=false;maintenance=true;yard_job_t check={.kind=30,.generation=session.generation};busy=hs_queue_send(work_queue,&check,0);
     if(!busy)hs_t5_core_check_result(HS_ERR_INVALID_STATE);
     continue;
   }
   if(clicked&&action==13&&busy&&photo_active)continue;
   if(clicked&&action==13&&busy){
     request_photo=true;awake=false;pending=false;cancelled=true;hs_t5_audio_cancel(true);yard_cancel(&session);continue;
   }
   if(!busy&&request_photo){request_photo=false;clicked=true;action=13;}
   if(clicked&&action==13&&!busy){
     awake=false;hs_t5_display_active(true);
     if(recording){hs_audio_stop();recording=false;char path[HS_OUTBOX_PATH_SIZE];if(!hs_outbox_path(id,"part",path,sizeof(path)))hs_fs_remove(path);}
     if(pending){hs_display_text("请先完成当前语音，或点停止后拍照。");continue;}
     cancelled=false;hs_t5_audio_cancel(false);yard_job_t shot={.kind=13,.generation=session.generation};make_id(shot.id);
     hs_display_text("正在准备拍照，点停止可取消。");busy=hs_queue_send(work_queue,&shot,0);photo_active=busy;continue;
   }
   if(busy){if(clicked&&(action==1||action==12)&&(cancelled||maintenance)){restart=true;maintenance_cancelled=true;hs_display_text("正在接话，结束后台检查…");}continue;}
   if(awake&&!listening){awake=false;idle_until=0;}
   if(awake&&!recording&&!pending&&hs_time_us()>=idle_until){awake=false;hs_display_dialogue(HS_FACE_SLEEP);hs_display_text("这次聊到这里，点唤醒可重新开始。");}
   if(awake&&!recording&&!pending&&!clicked){clicked=true;action=12;session.last_door=0;}
   if(restart){restart=false;clicked=true;action=12;}
#if HS_YARD_SENSOR_DIAGNOSTICS
   if(clicked && action==43){if(!recording)hs_t5_imu_raw_probe();continue;}
   if(clicked && action==42){if(!recording)hs_t5_imu_reset_probe();continue;}
   if(clicked && action==40){if(!recording)hs_t5_imu_probe();continue;}
#endif
   if(recording) {
     hs_err_t e=hs_audio_read();
     if(awake&&hs_t5_audio_heard())idle_until=hs_time_us()+HS_YARD_IDLE_MS*1000LL;
     if(awake&&hs_time_us()>=idle_until){awake=false;hs_t5_display_listening(false);hs_audio_stop();recording=false;char path[HS_OUTBOX_PATH_SIZE];if(!hs_outbox_path(id,"part",path,sizeof(path)))hs_fs_remove(path);session.phase=YARD_REST;hs_display_text("这次聊到这里，点唤醒可重新开始。");continue;}
     if((clicked && (action==1||action==12))||e!=HS_OK||hs_audio_voice_finished()||hs_time_us()-start>7000000) {
       hs_t5_display_listening(false);recording=false;bool heard=hs_t5_audio_heard();hs_err_t stop=hs_audio_stop();
       if(!heard&&e==HS_OK&&stop==HS_OK){char path[HS_OUTBOX_PATH_SIZE];if(!hs_outbox_path(id,"part",path,sizeof(path)))hs_fs_remove(path);session.phase=YARD_REST;continue;}
       if(e!=HS_OK||stop!=HS_OK||hs_outbox_commit(id)!=HS_OUTBOX_OK){session.phase=YARD_FAILED;hs_display_text("录音保存失败，原文件保留。请检查存储。");continue;}
       pending=true;session.phase=YARD_WAIT;hs_display_dialogue(HS_FACE_THINK);
     }else continue;
   } else if(clicked && (action==1 || action==12 || action==41) && !pending) {
     if(!busy){yard_job_t active={.kind=33,.generation=session.generation};hs_queue_send(work_queue,&active,0);}
     if(action==41&&!listening)continue;
     if(session.phase==YARD_FAILED)session.phase=YARD_REST;
     yard_door_source_t source=action==41?YARD_DOOR_IMU:YARD_DOOR_BUTTON;
     if(!yard_door_event(&session,(uint64_t)(hs_time_us()/1000),source))continue;
     HS_LOGI("小院","door source=%s accepted=1 demo_cooldown_ms=1200",source==YARD_DOOR_IMU?"imu":"button");
     if(!storage){session.phase=YARD_REST;hs_display_text("未挂载存储，不能录音；没有格式化存储卡。");continue;}
     hs_t5_display_active(true);
     bool resuming=awake||barge_resume;
     if(!resuming){hs_display_dialogue(HS_FACE_WAKE);}
     if(!resuming)hs_display_text("我在呢，准备接话。");
     cancelled=false;hs_t5_audio_cancel(false);
     hs_t5_audio_barge_arm(false);if(!barge_resume)hs_t5_audio_barge_discard();
     if(!resuming&&!session.silent&&(action!=41||proactive)){
       uint32_t random=0;hs_random_bytes(&random,sizeof(random));
       unsigned selected=yard_greeting_next(&greeting_state,random);
       const yard_greeting_clip_t *clip=&yard_greetings[selected];
       hs_display_text(clip->text);HS_LOGI("audio","greeting index=%u bytes=%u",selected,clip->size);
       hs_t5_audio_barge_arm(true);
       avatar_demo(clip->pcm,clip->size,&greeting_stop);
       if(greeting_stop)continue;
       if(hs_t5_audio_barge_requested()){hs_t5_audio_cancel(true);hs_t5_audio_quiesce();barge_resume=true;restart=true;session.last_door=0;continue;}
     }
     char path[HS_OUTBOX_PATH_SIZE];make_id(id);
     if(hs_outbox_path(id,"part",path,sizeof(path))||hs_audio_start(path)!=HS_OK){hs_display_text("暂时不能录音，请检查存储和麦克风。");session.phase=YARD_REST;continue;}
     command_capture=barge_resume;
     if(barge_resume){hs_t5_audio_barge_resume();barge_resume=false;}
     if(!awake){awake=listening;idle_until=hs_time_us()+HS_YARD_IDLE_MS*1000LL;}
     recording=true;session.phase=YARD_LISTEN;start=hs_time_us();hs_t5_display_listening(true);hs_display_dialogue(HS_FACE_LISTEN);if(!resuming){hs_display_dialogue(HS_FACE_WAKE);}
     if(!resuming){hs_display_text("我在听，说完会自动接话；无互动30秒退出。");}
     continue;
   }
   if(pending && (session.phase==YARD_WAIT||(clicked&&(action==1||action==12)))) {
     session.phase=YARD_WAIT;hs_display_dialogue(HS_FACE_THINK);hs_display_text("正在理解，请稍候；点停止可结束本轮。");
     cancelled=false;hs_t5_audio_cancel(false);
     yard_job_t job={.kind=1,.generation=session.generation,.silent=session.silent,.interruptible=true,.command=command_capture};snprintf(job.id,sizeof(job.id),"%s",id);
     busy=hs_queue_send(work_queue,&job,0);last_sync=hs_time_us();
   }
   if(!pending && (clicked&&action>=10&&action<15&&action!=13)) {
     yard_job_t job={.kind=action,.generation=session.generation};busy=hs_queue_send(work_queue,&job,0);
   }
   if(!awake&&!recording&&!busy&&!pending&&hs_time_us()-last_photo_poll>3000000){maintenance_cancelled=false;maintenance=true;yard_job_t poll={.kind=31,.generation=session.generation};busy=hs_queue_send(work_queue,&poll,0);last_photo_poll=hs_time_us();}
   if(!awake&&!recording&&!busy&&!pending&&hs_time_us()-last_sync>30000000){maintenance_cancelled=false;maintenance=true;yard_job_t sync={.kind=32,.generation=session.generation};busy=hs_queue_send(work_queue,&sync,0);last_sync=hs_time_us();}
 }
}
