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
#include "local_ack.h"
#include "hs_fs.h"
hs_err_t hs_transport_yard_silent(bool *silent);
#include <stdio.h>
/* T5 产品入口：不注册旧相机/库存动作，旧 Korvo 应用保持原样。 */
static hs_queue_t inputs, work_queue, done_queue;
void hs_t5_audio_cancel(bool cancel);
typedef struct {unsigned generation; int kind; char id[37]; bool silent;} yard_job_t;
typedef struct {unsigned generation; bool completed; char message[1024];} yard_result_t;
static volatile bool cancelled;
static void worker(void *arg) {
 (void)arg;yard_job_t job;
 for(;;) {
  if(!hs_queue_receive(work_queue,&job,HS_WAIT_FOREVER))continue;
  yard_result_t result={.generation=job.generation};
  if(job.kind==1) {
   if(hs_transport_capture(job.id,result.message,sizeof(result.message))==HS_OK && !cancelled) {
    hs_err_t e=HS_OK;
    if(!job.silent){e=hs_transport_reply(job.id);if(e==HS_OK&&!cancelled)e=hs_audio_play();}
    if(e==HS_OK&&!cancelled)result.completed=hs_outbox_complete(job.id)==HS_OUTBOX_OK;
   }else snprintf(result.message,sizeof(result.message),"Core 暂不可用或本轮已停止。录音保留，可按键重试。");
  }else {
   if(hs_transport_screen(job.kind-10,result.message,sizeof(result.message))!=HS_OK)
    snprintf(result.message,sizeof(result.message),"Core 暂不可用，小院保存在主机，可稍后重试。");
  }
  hs_queue_send(done_queue,&result,HS_WAIT_FOREVER);
 }
}
static void input(hs_action_t a) {int n=(int)a;hs_queue_send(inputs,&n,0);}
bool yard_console_start(void (*callback)(int));
static void console_action(int n){hs_queue_send(inputs,&n,0);}
static void page(int p) {int n=10+p;hs_queue_send(inputs,&n,0);}
static void make_id(char id[37]) {
 unsigned char b[16];HS_CHECK(hs_random_bytes(b,16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;
 snprintf(id,37,"%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",b[0],b[1],b[2],b[3],b[4],b[5],b[6],b[7],b[8],b[9],b[10],b[11],b[12],b[13],b[14],b[15]);
}
void hs_t5_imu_probe(void);
void yard_app_run(void) {
 HS_CHECK(hs_platform_init());HS_CHECK(hs_device_config_init());
 bool storage=hs_storage_init()==HS_OK;
 hs_t5_imu_probe();
 HS_CHECK(hs_display_init());HS_CHECK(hs_audio_init());HS_CHECK(hs_network_init());
 inputs=hs_queue_create(12,sizeof(int));HS_ASSERT(inputs);HS_CHECK(hs_board_inputs_init(input));hs_display_navigation(page);
 HS_ASSERT(yard_console_start(console_action));
 work_queue=hs_queue_create(1,sizeof(yard_job_t));done_queue=hs_queue_create(1,sizeof(yard_result_t));
 HS_ASSERT(work_queue&&done_queue);HS_ASSERT(hs_task_start(worker,"小院通信",16384,4));
 bool busy=false;
 yard_session_t session={.listening=false};char id[37]={0};
 bool pending=storage && hs_outbox_recover(id)==HS_OUTBOX_OK;bool recording=false;int64_t start=0,last_sync=0;
 hs_display_text("萌小冰·食灵小院\n按键接话，再按结束。门传感器尚未接入，相机缺件。无卡时仅可查看。");
 for(;;) {
   yard_result_t done;
   if(hs_queue_receive(done_queue,&done,0)) {
     busy=false;
     if(yard_current(&session,done.generation)) {if(done.completed)pending=false;hs_display_text(done.message);session.phase=YARD_REST;}
   }
   int action=0;bool clicked=hs_queue_receive(inputs,&action,recording?0:30);
   if(clicked && (action==3 || action==15)) {if(recording){hs_audio_stop();recording=false;char path[HS_OUTBOX_PATH_SIZE];if(!hs_outbox_path(id,"part",path,sizeof(path)))hs_fs_remove(path);}
     cancelled=true;hs_t5_audio_cancel(true);yard_cancel(&session);hs_display_text("这次已停止。相机尚未接通，不会采集照片。");continue;}
   if(busy)continue;
   if(recording) {
     hs_err_t e=hs_audio_read();
     if((clicked && action==1)||e!=HS_OK||hs_time_us()-start>7000000) {
       recording=false;hs_err_t stop=hs_audio_stop();
       if(e!=HS_OK||stop!=HS_OK||hs_outbox_commit(id)!=HS_OUTBOX_OK){session.phase=YARD_FAILED;hs_display_text("录音保存失败，原文件保留。请检查存储。");continue;}
       pending=true;session.phase=YARD_WAIT;
     }else continue;
   } else if(clicked && action==1 && !pending) {
     if(!storage){hs_display_text("未挂载存储，不能录音；没有格式化存储卡。");continue;}
     hs_display_text("我在呢，准备接话。");
     cancelled=false;hs_t5_audio_cancel(false);session.generation++;
     volatile bool cancel=false;if(!session.silent)hs_audio_demo(yard_ack,sizeof(yard_ack),&cancel);
     char path[HS_OUTBOX_PATH_SIZE];make_id(id);
     if(hs_outbox_path(id,"part",path,sizeof(path))||hs_audio_start(path)!=HS_OK){hs_display_text("暂时不能录音，请检查存储和麦克风。");continue;}
     recording=true;session.phase=YARD_LISTEN;start=hs_time_us();hs_display_text("我在听，按键结束；最长七秒。本轮身份未知。");continue;
   }
   if(pending && (session.phase==YARD_WAIT||(clicked&&action==1))) {
     session.phase=YARD_WAIT;hs_display_text("正在理解，请稍候；点设置可停止本轮。");
     cancelled=false;hs_t5_audio_cancel(false);
     yard_job_t job={.kind=1,.generation=session.generation,.silent=session.silent};snprintf(job.id,sizeof(job.id),"%s",id);
     busy=hs_queue_send(work_queue,&job,0);last_sync=hs_time_us();
   }
   if(!pending && (clicked&&action>=10&&action<15)) {
     yard_job_t job={.kind=action,.generation=session.generation};busy=hs_queue_send(work_queue,&job,0);
   }
   if(!recording && !busy && hs_time_us()-last_sync>30000000){hs_transport_heartbeat();hs_transport_yard_silent(&session.silent);last_sync=hs_time_us();}
 }
}
