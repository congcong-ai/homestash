/* 主机验证实际 T5 音频适配器的数据路径；不验证原厂驱动或硬件声学。 */
#include "hs_audio.h"
#include "hs_runtime.h"
#include "hs_storage.h"
#include "tdl_audio_manage.h"
#include "tkl_audio.h"
#include "tal_mutex.h"
#include <assert.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
static TDL_AUDIO_MIC_CB microphone;
static bool playback_failure;
typedef struct {size_t size;unsigned count,capacity,head;unsigned char data[];} queue_t;
int tal_mutex_create_init(MUTEX_HANDLE *h){*h=(void *)1;return 0;}
int tal_mutex_lock(MUTEX_HANDLE h){(void)h;return 0;}
int tal_mutex_unlock(MUTEX_HANDLE h){(void)h;return 0;}
int tdl_audio_find(char *name,TDL_AUDIO_HANDLE_T *h){(void)name;*h=(void *)1;return 0;}
int tdl_audio_open(TDL_AUDIO_HANDLE_T h,TDL_AUDIO_MIC_CB cb){(void)h;microphone=cb;return 0;}
int tdl_audio_volume_set(TDL_AUDIO_HANDLE_T h,uint8_t volume){(void)h;(void)volume;return 0;}
int tkl_ao_put_frame(int card,int channel,void *h,TKL_AUDIO_FRAME_INFO_T *f){(void)card;(void)channel;(void)h;assert(f->used_size>0);return playback_failure?-1:0;}
hs_queue_t hs_queue_create(unsigned capacity,size_t size){queue_t *q=calloc(1,sizeof(*q)+capacity*size);assert(q);q->size=size;q->capacity=capacity;return q;}
bool hs_queue_send(hs_queue_t handle,const void *item,uint32_t ms){(void)ms;queue_t *q=handle;if(q->count==q->capacity)return false;memcpy(q->data+((q->head+q->count)%q->capacity)*q->size,item,q->size);q->count++;return true;}
bool hs_queue_receive(hs_queue_t handle,void *item,uint32_t ms){(void)ms;queue_t *q=handle;if(!q->count)return false;memcpy(item,q->data+q->head*q->size,q->size);q->head=(q->head+1)%q->capacity;q->count--;return true;}
void hs_delay_ms(uint32_t ms){(void)ms;}
int main(void){
 assert(!hs_outbox_init());assert(hs_audio_init()==HS_OK);
 char part[256],wav[256];const char *id="11111111-1111-4111-8111-111111111111";
 assert(!hs_outbox_path(id,"part",part,sizeof(part)));assert(!hs_outbox_path(id,"wav",wav,sizeof(wav)));
 unsigned char pcm[2560];for(unsigned i=0;i<sizeof(pcm);i++)pcm[i]=(unsigned char)i;
 assert(hs_audio_start(part)==HS_OK);microphone(0,3,pcm,sizeof(pcm));assert(hs_audio_read()==HS_OK);
 microphone(0,3,pcm,640);assert(hs_audio_stop()==HS_OK);assert(!hs_outbox_commit(id));
 FILE *f=fopen(wav,"rb");assert(f);assert(!fseek(f,44,SEEK_SET));unsigned char actual[3200];assert(fread(actual,1,sizeof(actual),f)==sizeof(actual));assert(fgetc(f)==EOF);fclose(f);assert(!memcmp(actual,pcm,sizeof(pcm)));assert(!memcmp(actual+sizeof(pcm),pcm,640));
 assert(hs_audio_start(wav)==HS_ERR_INVALID_STATE);assert(hs_audio_stop()==HS_ERR_INVALID_STATE);
 assert(!rename(wav,HS_REPLY));assert(hs_audio_play()==HS_OK);playback_failure=true;assert(hs_audio_play()==HS_FAIL);
 assert(hs_audio_start(part)==HS_OK);for(unsigned i=0;i<20;i++)microphone(0,3,pcm,sizeof(pcm));assert(hs_audio_read()==HS_FAIL);assert(hs_audio_stop()==HS_FAIL);
 assert(hs_audio_voice_init()==HS_ERR_NOT_SUPPORTED);
 puts("通过：T5 回调 PCM 原样落盘、停止时排空队列、拒绝覆盖原始录音、队列溢出与播放错误明确失败。");return 0;
}
