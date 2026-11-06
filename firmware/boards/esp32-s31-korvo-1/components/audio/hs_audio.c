#include "hs_audio.h"
#include "demo_adpcm.h"
#include "hs_storage.h"
#include "hs_outbox.h"
#include "audio_gain.h"
#include "audio_volume.h"
#include "wav.h"
#include "bsp/audio.h"
#include "nvs.h"
#include "esp_timer.h"
#include <stdio.h>
#include <unistd.h>
#include <string.h>
static esp_codec_dev_handle_t mic, speaker;
static FILE *record;
static int output_volume=55,saved_volume=55;
static uint32_t volume_changed;
int hs_audio_volume_percent(void){return __atomic_load_n(&output_volume,__ATOMIC_RELAXED);}
void hs_audio_demo_volume(int delta){int value=hs_audio_volume_percent()+delta*5;if(value<10)value=10;if(value>85)value=85;__atomic_store_n(&output_volume,value,__ATOMIC_RELAXED);__atomic_store_n(&volume_changed,(uint32_t)(esp_timer_get_time()/1000),__ATOMIC_RELAXED);}
void hs_audio_volume_save(void){int value=hs_audio_volume_percent();if(value==saved_volume||(uint32_t)((uint32_t)(esp_timer_get_time()/1000)-__atomic_load_n(&volume_changed,__ATOMIC_RELAXED))<1000)return;nvs_handle_t h;if(nvs_open("hs_audio",NVS_READWRITE,&h)!=ESP_OK)return;if(nvs_set_u8(h,"volume",value)==ESP_OK&&nvs_commit(h)==ESP_OK)saved_volume=value;nvs_close(h);}

static uint32_t bytes;
static int64_t voice_last_sound;
static bool voice_heard;
#include "esp_timer.h"
static esp_codec_dev_sample_info_t format = {.sample_rate=16000,.bits_per_sample=16,.channel=2};
esp_err_t hs_audio_init(void) {
  nvs_handle_t h;uint8_t value;if(nvs_open("hs_audio",NVS_READONLY,&h)==ESP_OK){if(nvs_get_u8(h,"volume",&value)==ESP_OK&&value>=10&&value<=85)output_volume=saved_volume=value;nvs_close(h);}
  printf("音量恢复：%d\n",hs_audio_volume_percent());
  mic = bsp_audio_codec_microphone_init();
  speaker = bsp_audio_codec_speaker_init();
  return mic && speaker ? ESP_OK : ESP_FAIL;
}
esp_err_t hs_audio_start(const char *path) {
  hs_audio_voice_pause();
  if (record) return ESP_ERR_INVALID_STATE;
  record = fopen(path, "wb");
  if (!record) return ESP_FAIL;
  bytes = 0;voice_heard=false;voice_last_sound=esp_timer_get_time();
  if (badge_wav_header(record, 0) || fflush(record) || fsync(fileno(record)) || esp_codec_dev_open(mic, &format) != ESP_CODEC_DEV_OK) {
    fclose(record); record = NULL; return ESP_FAIL;
  }
  esp_codec_dev_set_in_gain(mic, badge_gain_analog_db(BADGE_GAIN_DEFAULT));
  return ESP_OK;
}
esp_err_t hs_audio_read(void) {
  int16_t stereo[1024], mono[512];
  if (!record || esp_codec_dev_read(mic, stereo, sizeof(stereo)) != ESP_CODEC_DEV_OK) return ESP_FAIL;
  badge_gain_pcm(stereo, mono, 512, BADGE_GAIN_DEFAULT, NULL);
  long energy=0;for(int i=0;i<512;i++)energy+=mono[i]<0?-mono[i]:mono[i];
  if(energy/512>500){voice_heard=true;voice_last_sound=esp_timer_get_time();}
  if (fwrite(mono, 1, sizeof(mono), record) != sizeof(mono)) return ESP_FAIL;
  bytes += sizeof(mono);
  if (bytes % 16384 == 0 && (fflush(record) || fsync(fileno(record)))) return ESP_FAIL;
  return ESP_OK;
}
esp_err_t hs_audio_stop(void) {
  if (!record) return ESP_ERR_INVALID_STATE;
  esp_codec_dev_close(mic);
  int result = badge_wav_header(record, bytes);
  if (fflush(record) || fsync(fileno(record))) result = -1;
  if (fclose(record)) result = -1;
  record = NULL;
  return !result && bytes > 0 ? ESP_OK : ESP_FAIL;
}
esp_err_t hs_audio_play(void) {
  hs_audio_voice_pause();
  if(hs_outbox_validate_wav(HS_REPLY)) return ESP_ERR_INVALID_ARG;
  FILE *f = fopen(HS_REPLY, "rb");
  if (!f) return ESP_FAIL;
  unsigned char h[44];
  /* Core 规范化为固定头、单声道、16 kHz、16 bit PCM；拒绝其它编码。 */
  if (fread(h,1,44,f)!=44 || memcmp(h,"RIFF",4) || memcmp(h+8,"WAVEfmt ",8) || h[20]!=1 || h[22]!=1 || h[24]!=0x80 || h[25]!=0x3e || h[34]!=16 || memcmp(h+36,"data",4)) {
    fclose(f); return ESP_ERR_INVALID_ARG;
  }
  if (esp_codec_dev_open(speaker, &format) != ESP_CODEC_DEV_OK) { fclose(f); return ESP_FAIL; }
  int applied=hs_audio_volume_percent();esp_codec_dev_set_out_vol(speaker,applied);
  int16_t mono[512], stereo[1024]; size_t n; esp_err_t result=ESP_OK;
  while ((n=fread(mono,sizeof(int16_t),512,f))>0) {
    int desired=hs_audio_volume_percent();if(desired!=applied){esp_codec_dev_set_out_vol(speaker,desired);applied=desired;printf("音量生效：%d\n",desired);}
    for(size_t i=0;i<n;i++) stereo[i*2]=stereo[i*2+1]=mono[i];
    if (esp_codec_dev_write(speaker,stereo,n*4)!=ESP_CODEC_DEV_OK) { result=ESP_FAIL;break; }
  }
  if(ferror(f)) result=ESP_FAIL;
  fclose(f); esp_codec_dev_close(speaker); return result;
}

esp_err_t hs_audio_demo(const signed char *pcm,size_t bytes,volatile bool *cancel){
 hs_audio_voice_pause();
 if(!pcm||!bytes||bytes%256)return ESP_ERR_INVALID_ARG;
 if(!speaker)return ESP_ERR_INVALID_STATE;
 if(esp_codec_dev_open(speaker,&format)!=ESP_CODEC_DEV_OK)return ESP_FAIL;
 esp_err_t result=ESP_OK;int applied=-1;int16_t mono[505],out[1010];size_t pos=0;
 while(pos<bytes && !*cancel){
 int samples=demo_adpcm_decode((const uint8_t*)pcm+pos,256,mono);
 if(samples<0){result=ESP_ERR_INVALID_ARG;break;}
 for(int i=0;i<samples;i++)out[i*2]=out[i*2+1]=mono[i];
 int desired=hs_audio_volume_percent();if(desired!=applied){esp_codec_dev_set_out_vol(speaker,desired);applied=desired;printf("音量生效：%d\n",desired);}
 if(esp_codec_dev_write(speaker,out,samples*4)!=ESP_CODEC_DEV_OK){result=ESP_FAIL;break;}pos+=256;
 }
 esp_codec_dev_close(speaker);
 printf("DEMO_AUDIO bytes=%u/%u result=%s cancelled=%d\n",(unsigned)pos,(unsigned)bytes,esp_err_to_name(result),*cancel);
 return result;
}

#include "esp_wn_models.h"
#include "esp_mn_models.h"
#include "esp_mn_speech_commands.h"
#include "model_path.h"
#include "esp_heap_caps.h"
#include "esp_timer.h"
#include "esp_log.h"
static const esp_wn_iface_t *wn;
static esp_mn_iface_t *mn;
static model_iface_data_t *wd,*md;
static int16_t *voice_stereo,*voice_mono;
static int voice_capacity;
#include "voice_session.h"
static bool voice_open;
static hs_voice_session_t voice_session;
static int16_t *command_pcm;
static int command_samples;
#include "freertos/queue.h"
#include "esp_http_client.h"
static QueueHandle_t probe_jobs;
typedef struct {char url[240];bool awake;int context;float threshold;char phrase[96];bool route;} voice_probe_t;
/* S31 WakeNet9 的 clean 在首次推理前会访问空队列；保持唤醒引擎连续运行。 */
void hs_audio_voice_reset(void){if(md)mn->clean(md);command_samples=0;}
bool hs_audio_voice_awake(void){return hs_voice_session_awake(&voice_session,esp_timer_get_time());}
void hs_audio_voice_sleep(void){hs_voice_session_end(&voice_session);hs_audio_voice_reset();}

static const struct {int id;const char *text;} phrases[]={
 {1,"jia li hai you ji dan ma"},{1,"hai you ji dan ma"},{1,"ji dan hai you duo shao"},
 {2,"zen me la"},{2,"zen me le"},{2,"fa sheng shen me le"},
 {3,"xiao bing jin wan chi shen me"},{3,"jin wan chi shen me"},{3,"jin tian chi shen me"},
 {4,"hao ya kai shi zuo"},{4,"kai shi zuo"},{4,"hao ya"},{4,"kai shi zuo fan"},
 {5,"xia yi bu"},{5,"ran hou ne"},
 {6,"ma shang gei ni chong dian"},{6,"gei ni chong dian"},{6,"ma shang chong dian"},
 {7,"cao mei zen me yang"},{7,"cao mei zen me le"},
 {8,"dian liang gao ji"},{8,"mei dian le"},
 {9,"da kai bing xiang"},{9,"kai men"},
 {10,"tui xia"},{10,"xiao bing tui xia"}
 };

static int voice_context;
static int probe_result;
static bool probing;
esp_err_t hs_audio_voice_init(void){
 srmodel_list_t *models=esp_srmodel_init("model");if(!models)return ESP_FAIL;
 char *wake=esp_srmodel_filter(models,"wn9","xiaobin"),*command=esp_srmodel_filter(models,"mn7","cn");
 if(!wake||!command)return ESP_ERR_NOT_FOUND;
 wn=esp_wn_handle_from_name(wake);mn=esp_mn_handle_from_name(command);
 if(!wn||!mn)return ESP_FAIL;
 wd=wn->create(wake,DET_MODE_95);md=mn->create(command,6000);
 if(!wd||!md)return ESP_ERR_NO_MEM;
 probe_jobs=xQueueCreate(1,sizeof(voice_probe_t));if(!probe_jobs)return ESP_ERR_NO_MEM;
 esp_mn_commands_alloc(mn,md);esp_mn_commands_clear();
 for(unsigned i=0;i<sizeof(phrases)/sizeof(phrases[0]);i++)if(esp_mn_commands_add(phrases[i].id,phrases[i].text)!=ESP_OK)return ESP_FAIL;
 if(esp_mn_commands_update())return ESP_FAIL;
 voice_capacity=wn->get_samp_chunksize(wd);int n=mn->get_samp_chunksize(md);if(n>voice_capacity)voice_capacity=n;
 voice_stereo=heap_caps_malloc(voice_capacity*4,MALLOC_CAP_SPIRAM);voice_mono=heap_caps_malloc(voice_capacity*2,MALLOC_CAP_SPIRAM);
 command_pcm=heap_caps_malloc(voice_capacity*2,MALLOC_CAP_SPIRAM);
 if(!voice_stereo||!voice_mono||!command_pcm)return ESP_ERR_NO_MEM;
 ESP_LOGI("小冰语音","本地唤醒与固定指令就绪，chunk=%d",voice_capacity);return ESP_OK;
}
void hs_audio_voice_context(int command){
 if(!md||command==voice_context)return;
 esp_mn_commands_clear();
 for(unsigned i=0;i<sizeof(phrases)/sizeof(phrases[0]);i++)if(command==0||phrases[i].id==command||phrases[i].id==10)esp_mn_commands_add(phrases[i].id,phrases[i].text);
 /* Demo当前步骤可按稳定的意图前缀识别；全局词表不加入短前缀。 */
 if(command==3)esp_mn_commands_add(3,"jin wan chi");
 if(esp_mn_commands_update())ESP_LOGE("小冰语音","VOICE_CONTEXT failed=%d",command);
 voice_context=command;mn->set_det_threshold(md,command==3||command==5?0.05f:0.1f);mn->clean(md);command_samples=0;
}
void hs_audio_voice_pause(void){if(voice_open){esp_codec_dev_close(mic);voice_open=false;hs_audio_voice_reset();}}
void hs_audio_voice_listen(void){hs_voice_session_touch(&voice_session,esp_timer_get_time());if(md)mn->clean(md);command_samples=0;}
static int voice_feed(int16_t *pcm,int n,bool commands){
 /* 无论是否已唤醒，每帧都送入 WakeNet，不能被 MultiNet 的窗口挡住。 */
 if(wn->detect(wd,pcm)>0){hs_audio_voice_listen();ESP_LOGI("小冰语音","本地唤醒命中，保持60秒");return 100;}
 if(!commands||!hs_audio_voice_awake()){if(command_samples){mn->clean(md);command_samples=0;}return 0;}
 int chunk=mn->get_samp_chunksize(md);
 for(int pos=0;pos<n;){
   int count=chunk-command_samples;if(count>n-pos)count=n-pos;
   memcpy(command_pcm+command_samples,pcm+pos,count*sizeof(int16_t));command_samples+=count;pos+=count;
   if(command_samples<chunk)continue;
   command_samples=0;esp_mn_state_t state=mn->detect(md,command_pcm);
   if(state==ESP_MN_STATE_TIMEOUT){if(probing){esp_mn_results_t *r=mn->get_results(md);if(r)ESP_LOGI("小冰语音","MN timeout raw=%s graph=%s",r->raw_string,r->string);}mn->clean(md);continue;}
   if(state==ESP_MN_STATE_DETECTED){
     esp_mn_results_t *r=mn->get_results(md);int id=r&&r->num?r->command_id[0]:0;
     ESP_LOGI("小冰语音","MN command=%d probability=%.3f",id,r&&r->num?r->prob[0]:0.0);mn->clean(md);
     if(id==10){hs_audio_voice_sleep();ESP_LOGI("小冰语音","退下：结束唤醒");}
     else if(id)hs_audio_voice_listen();
     return id;
   }
 }
 return 0;
}
bool hs_audio_voice_finished(void){return voice_heard&&esp_timer_get_time()-voice_last_sound>1200000;}

int hs_audio_voice_poll(bool commands){
 if(probe_result){int result=probe_result;probe_result=0;if(result!=10)hs_audio_voice_listen();return result;}
 if(!wd||!md||!voice_stereo||!voice_mono||!command_pcm||record)return 0;
 if(!voice_open){if(esp_codec_dev_open(mic,&format)!=ESP_CODEC_DEV_OK)return 0;esp_codec_dev_set_in_gain(mic,badge_gain_analog_db(BADGE_GAIN_DEFAULT));voice_open=true;}
 int n=wn->get_samp_chunksize(wd);
 if(esp_codec_dev_read(mic,voice_stereo,n*4)!=ESP_CODEC_DEV_OK){hs_audio_voice_pause();return 0;}
 badge_gain_pcm(voice_stereo,voice_mono,n,BADGE_GAIN_DEFAULT,NULL);
 return voice_feed(voice_mono,n,commands);
}

esp_err_t hs_audio_voice_probe_request(const char *url,bool awake,int context,float threshold,const char *phrase,bool route){
 if(!probe_jobs||!command_pcm||!voice_mono||!url||strlen(url)>=240||strncmp(url,"http://",7))return ESP_ERR_INVALID_ARG;
 voice_probe_t p={.awake=awake,.context=context,.threshold=threshold,.route=route};if(phrase)strlcpy(p.phrase,phrase,sizeof(p.phrase));strlcpy(p.url,url,sizeof(p.url));return xQueueSend(probe_jobs,&p,0)==pdTRUE?ESP_OK:ESP_ERR_TIMEOUT;
}
void hs_audio_voice_probe_poll(void){
 voice_probe_t p;if(!probe_jobs||record||!xQueueReceive(probe_jobs,&p,0))return;
 int old_context=voice_context;hs_audio_voice_pause();hs_audio_voice_sleep();hs_audio_voice_context(p.context);if(p.threshold>0)mn->set_det_threshold(md,p.threshold);
 if(p.phrase[0]){esp_mn_commands_add(p.context,p.phrase);esp_mn_commands_update();}
 probing=true;mn->print_active_speech_commands(md);
 esp_http_client_config_t cfg={.url=p.url,.timeout_ms=10000,.disable_auto_redirect=true};
 esp_http_client_handle_t h=esp_http_client_init(&cfg);int length=0;int16_t *zero=calloc(voice_capacity,2);char *data=heap_caps_malloc(524288,MALLOC_CAP_SPIRAM);
 if(h&&data&&zero&&esp_http_client_open(h,0)==ESP_OK){
  esp_http_client_fetch_headers(h);
  if(esp_http_client_get_status_code(h)==200)length=esp_http_client_read_response(h,data,524288);
 }
 int result=0,n=wn->get_samp_chunksize(wd);
 if(length>44&&!memcmp(data,"RIFF",4)&&!memcmp(data+8,"WAVEfmt ",8)&&!memcmp(data+36,"data",4)&&((unsigned char*)data)[22]==1&&((unsigned char*)data)[24]==0x80&&((unsigned char*)data)[25]==0x3e){
  for(int i=0;i<40;i++)voice_feed(zero,n,false);
  hs_audio_voice_sleep();if(p.awake)hs_audio_voice_listen();
  int16_t *samples=(int16_t*)(data+44);int total=(length-44)/2;
  for(int pos=0;pos<total;pos+=n){memset(zero,0,n*2);int count=total-pos;if(count>n)count=n;memcpy(zero,samples+pos,count*2);int got=voice_feed(zero,n,true);if(got){result=got;break;}}
  for(int i=0;i<25&&!result;i++){memset(zero,0,n*2);int got=voice_feed(zero,n,true);if(got){result=got;break;}}
  ESP_LOGI("小冰语音","VOICE_PROBE result=%d bytes=%d",result,length);
 }else ESP_LOGE("小冰语音","VOICE_PROBE failed bytes=%d",length);
 if(h)esp_http_client_cleanup(h);
 free(data);free(zero);probing=false;hs_audio_voice_sleep();voice_context=-1;hs_audio_voice_context(old_context);if(p.route&&result){probe_result=result;if(result!=10&&result!=100)hs_audio_voice_listen();}
}
