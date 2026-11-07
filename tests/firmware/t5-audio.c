/* 主机验证实际 T5 音频适配器的数据路径；不验证原厂驱动或硬件声学。 */
#include "hs_audio.h"
#include "hs_runtime.h"
#include "hs_storage.h"
#include "hs_fs.h"
#include "tdl_audio_manage.h"
#include "tkl_audio.h"
#include "tal_mutex.h"
#include <assert.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
static TDL_AUDIO_MIC_CB microphone;
static bool playback_failure,inject_speech;
static volatile bool *demo_cancel;
static unsigned output_frames,put_delay_ms;
void hs_t5_audio_barge_arm(bool enabled);
bool hs_t5_audio_barge_requested(void);
void hs_t5_audio_barge_discard(void);
static int64_t now;
static unsigned current_volume;
int64_t hs_time_us(void){return now;}
void hs_log(const char *level,const char *tag,const char *format,...){(void)level;(void)tag;(void)format;}
void hs_t5_audio_cancel(bool cancel);
void hs_t5_audio_quiesce(void);
bool hs_t5_audio_heard(void);
typedef struct {size_t size;unsigned count,capacity,head;unsigned char data[];} queue_t;
int tal_mutex_create_init(MUTEX_HANDLE *h){*h=(void *)1;return 0;}
int tal_mutex_lock(MUTEX_HANDLE h){(void)h;return 0;}
int tal_mutex_unlock(MUTEX_HANDLE h){(void)h;return 0;}
int tdl_audio_find(char *name,TDL_AUDIO_HANDLE_T *h){(void)name;*h=(void *)1;return 0;}
int tdl_audio_open(TDL_AUDIO_HANDLE_T h,TDL_AUDIO_MIC_CB cb){(void)h;microphone=cb;return 0;}
int tdl_audio_volume_set(TDL_AUDIO_HANDLE_T h,uint8_t volume){(void)h;current_volume=volume;return 0;}
static unsigned speech_period, silent_frames;
int tkl_ao_put_frame(int card,int channel,void *h,TKL_AUDIO_FRAME_INFO_T *f){
 (void)card;(void)channel;(void)h;
 assert(f->used_size>0);
 output_frames++;
 now+=(int64_t)put_delay_ms*1000;
 if(demo_cancel)*demo_cancel=true;
 if(inject_speech){
   unsigned char speech[640]={0};
   if(!speech_period||output_frames%speech_period>=silent_frames){
     for(unsigned i=0;i<sizeof(speech);i+=2){speech[i]=0xb8;speech[i+1]=0x0b;}
   }
   microphone(0,3,speech,sizeof(speech));
 }
 return playback_failure?-1:0;
}
hs_queue_t hs_queue_create(unsigned capacity,size_t size){queue_t *q=calloc(1,sizeof(*q)+capacity*size);assert(q);q->size=size;q->capacity=capacity;return q;}
bool hs_queue_send(hs_queue_t handle,const void *item,uint32_t ms){(void)ms;queue_t *q=handle;if(q->count==q->capacity)return false;memcpy(q->data+((q->head+q->count)%q->capacity)*q->size,item,q->size);q->count++;return true;}
bool hs_queue_receive(hs_queue_t handle,void *item,uint32_t ms){(void)ms;queue_t *q=handle;if(!q->count)return false;memcpy(item,q->data+q->head*q->size,q->size);q->head=(q->head+1)%q->capacity;q->count--;return true;}
void hs_delay_ms(uint32_t ms){now+=(int64_t)ms*1000;}
int main(void){
 assert(!hs_outbox_init());assert(hs_audio_init()==HS_OK);
 char part[256],wav[256];const char *id="11111111-1111-4111-8111-111111111111";
 assert(!hs_outbox_path(id,"part",part,sizeof(part)));assert(!hs_outbox_path(id,"wav",wav,sizeof(wav)));
 unsigned char pcm[2560];for(unsigned i=0;i<sizeof(pcm);i++)pcm[i]=(unsigned char)i;
 assert(hs_audio_start(part)==HS_OK);microphone(0,3,pcm,sizeof(pcm));assert(hs_audio_read()==HS_OK);
 microphone(0,3,pcm,640);assert(hs_audio_stop()==HS_OK);assert(!hs_outbox_commit(id));
 FILE *f=fopen(wav,"rb");assert(f);assert(!fseek(f,44,SEEK_SET));unsigned char actual[3200];assert(fread(actual,1,sizeof(actual),f)==sizeof(actual));assert(fgetc(f)==EOF);fclose(f);assert(!memcmp(actual,pcm,sizeof(pcm)));assert(!memcmp(actual+sizeof(pcm),pcm,640));
 assert(hs_audio_start(wav)==HS_ERR_INVALID_STATE);assert(hs_audio_stop()==HS_ERR_INVALID_STATE);
 assert(!rename(wav,HS_REPLY));assert(hs_audio_play()==HS_OK);
 hs_t5_audio_cancel(true);assert(current_volume==0);assert(hs_audio_play()==HS_ERR_INVALID_STATE);hs_t5_audio_quiesce();assert(current_volume==0);hs_t5_audio_cancel(false);assert(current_volume==60);
 playback_failure=true;assert(hs_audio_play()==HS_FAIL);
 assert(hs_audio_start(part)==HS_OK);for(unsigned i=0;i<20;i++)microphone(0,3,pcm,sizeof(pcm));assert(hs_audio_read()==HS_FAIL);assert(hs_audio_stop()==HS_FAIL);
 playback_failure=false;
 assert(!hs_fs_remove(part));assert(hs_audio_start(part)==HS_OK);
 unsigned char silence[2560]={0};microphone(0,3,silence,sizeof(silence));assert(!hs_t5_audio_heard());assert(!hs_audio_voice_finished());assert(hs_audio_read()==HS_OK);
 microphone(0,3,pcm,sizeof(pcm));assert(hs_t5_audio_heard());assert(!hs_audio_voice_finished());hs_delay_ms(1201);assert(hs_audio_voice_finished());assert(hs_audio_stop()==HS_OK);
 hs_t5_audio_barge_arm(true);hs_t5_audio_barge_discard();signed char clip[32000]={0};volatile bool stop=false;
 put_delay_ms=20;int64_t began=now;assert(hs_audio_demo(clip,sizeof(clip),&stop)==HS_OK);assert(now-began<=1020000);put_delay_ms=0;
 unsigned before=output_frames;demo_cancel=&stop;assert(hs_audio_demo(clip,sizeof(clip),&stop)==HS_ERR_INVALID_STATE);assert(output_frames-before==1);demo_cancel=NULL;stop=false;
 assert(hs_audio_demo(clip,sizeof(clip),&stop)==HS_OK);assert(!hs_t5_audio_barge_requested());
 inject_speech=true;before=output_frames;assert(hs_audio_demo(clip,sizeof(clip),&stop)==HS_ERR_INVALID_STATE);assert(output_frames-before<50);assert(hs_t5_audio_barge_requested());
 hs_t5_audio_cancel(true);inject_speech=false;hs_t5_audio_quiesce();hs_t5_audio_cancel(false);
 assert(!hs_fs_remove(part));assert(hs_audio_start(part)==HS_OK);assert(!hs_t5_audio_barge_requested());assert(hs_t5_audio_heard());microphone(0,3,pcm,640);assert(hs_audio_read()==HS_OK);assert(hs_audio_stop()==HS_OK);
 f=fopen(part,"rb");assert(f);assert(!fseek(f,44,SEEK_SET));
 assert(fgetc(f)==0xb8);assert(fgetc(f)==0x0b);fclose(f);
 hs_t5_audio_barge_discard();
 assert(!hs_fs_remove(part));assert(hs_audio_start(part)==HS_OK);
 for(unsigned i=0;i<13;i++){
   microphone(0,3,pcm,sizeof(pcm));
   assert(hs_audio_read()==HS_OK);
 }
 assert(hs_audio_stop()==HS_OK);assert(!hs_outbox_commit(id));
 assert(!hs_fs_remove(HS_REPLY));assert(!rename(wav,HS_REPLY));
 inject_speech=true;speech_period=5;silent_frames=4;
 assert(hs_audio_play()==HS_OK);assert(!hs_t5_audio_barge_requested());
 speech_period=4;silent_frames=2;before=output_frames;
 assert(hs_audio_play()==HS_ERR_INVALID_STATE);
 assert(output_frames-before<52);assert(hs_t5_audio_barge_requested());
 inject_speech=false;hs_t5_audio_barge_discard();
 assert(hs_audio_voice_init()==HS_OK);
 assert(hs_audio_voice_poll(false)==0);
 hs_audio_voice_pause();
 puts("通过：T5 回调 PCM 原样落盘、停止时排空队列、拒绝覆盖原始录音、队列溢出与播放错误明确失败。");return 0;
}
