#include "hs_audio.h"
#include "demo_adpcm.h"
#include "hs_storage.h"
#include "hs_outbox.h"
#include "audio_gain.h"
#include "audio_volume.h"
#include "wav.h"
#include "bsp/audio.h"
#include <stdio.h>
#include <unistd.h>
#include <string.h>
static esp_codec_dev_handle_t mic, speaker;
static FILE *record;
static uint32_t bytes;
static int64_t voice_last_sound;
static bool voice_heard;
#include "esp_timer.h"
static esp_codec_dev_sample_info_t format = {.sample_rate=16000,.bits_per_sample=16,.channel=2};
esp_err_t hs_audio_init(void) {
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
  esp_codec_dev_set_out_vol(speaker, badge_volume_codec(BADGE_VOLUME_DEFAULT));
  int16_t mono[512], stereo[1024]; size_t n; esp_err_t result=ESP_OK;
  while ((n=fread(mono,sizeof(int16_t),512,f))>0) {
    for(size_t i=0;i<n;i++) stereo[i*2]=stereo[i*2+1]=mono[i];
    if (esp_codec_dev_write(speaker,stereo,n*4)!=ESP_CODEC_DEV_OK) { result=ESP_FAIL;break; }
  }
  if(ferror(f)) result=ESP_FAIL;
  fclose(f); esp_codec_dev_close(speaker); return result;
}

static int demo_volume=55;
void hs_audio_demo_volume(int delta){demo_volume+=delta*5;if(demo_volume<10)demo_volume=10;if(demo_volume>85)demo_volume=85;}
esp_err_t hs_audio_demo(const signed char *pcm,size_t bytes,volatile bool *cancel){
 hs_audio_voice_pause();
 if(!pcm||!bytes||bytes%256)return ESP_ERR_INVALID_ARG;
 if(!speaker)return ESP_ERR_INVALID_STATE;
 if(esp_codec_dev_open(speaker,&format)!=ESP_CODEC_DEV_OK)return ESP_FAIL;
 esp_err_t result=ESP_OK;int16_t mono[505],out[1010];size_t pos=0;
 while(pos<bytes && !*cancel){
 int samples=demo_adpcm_decode((const uint8_t*)pcm+pos,256,mono);
 if(samples<0){result=ESP_ERR_INVALID_ARG;break;}
 for(int i=0;i<samples;i++)out[i*2]=out[i*2+1]=mono[i];
 esp_codec_dev_set_out_vol(speaker,demo_volume);
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
static bool voice_open,command_window;
static int64_t command_until;
esp_err_t hs_audio_voice_init(void){
 srmodel_list_t *models=esp_srmodel_init("model");if(!models)return ESP_FAIL;
 char *wake=esp_srmodel_filter(models,"wn9","xiaobin"),*command=esp_srmodel_filter(models,"mn7","cn");
 if(!wake||!command)return ESP_ERR_NOT_FOUND;
 wn=esp_wn_handle_from_name(wake);mn=esp_mn_handle_from_name(command);
 if(!wn||!mn)return ESP_FAIL;
 wd=wn->create(wake,DET_MODE_95);md=mn->create(command,6000);
 if(!wd||!md)return ESP_ERR_NO_MEM;
 esp_mn_commands_alloc(mn,md);esp_mn_commands_clear();
 const char *phrases[]={"jia li hai you ji dan ma","zen me la","xiao bing jin wan chi shen me","hao ya kai shi zuo","xia yi bu","ma shang gei ni chong dian","cao mei zen me yang","dian liang gao ji","da kai bing xiang"};
 for(int i=0;i<9;i++)esp_mn_commands_add(i+1,phrases[i]);
 if(esp_mn_commands_update())return ESP_FAIL;
 voice_capacity=wn->get_samp_chunksize(wd);int n=mn->get_samp_chunksize(md);if(n>voice_capacity)voice_capacity=n;
 voice_stereo=heap_caps_malloc(voice_capacity*4,MALLOC_CAP_SPIRAM);voice_mono=heap_caps_malloc(voice_capacity*2,MALLOC_CAP_SPIRAM);
 if(!voice_stereo||!voice_mono)return ESP_ERR_NO_MEM;
 ESP_LOGI("小冰语音","本地唤醒与固定指令就绪，chunk=%d",voice_capacity);return ESP_OK;
}
void hs_audio_voice_pause(void){if(voice_open){esp_codec_dev_close(mic);voice_open=false;}}
void hs_audio_voice_listen(void){command_window=true;command_until=esp_timer_get_time()+10000000;if(md)mn->clean(md);}
int hs_audio_voice_poll(bool commands){
 if(!wd||!md||!voice_stereo||!voice_mono||record)return 0;
 if(!voice_open){if(esp_codec_dev_open(mic,&format)!=ESP_CODEC_DEV_OK)return 0;esp_codec_dev_set_in_gain(mic,badge_gain_analog_db(BADGE_GAIN_DEFAULT));voice_open=true;}
 if(command_window&&esp_timer_get_time()>command_until){command_window=false;mn->clean(md);}
 bool use_commands=commands&&command_window;
 int n=use_commands?mn->get_samp_chunksize(md):wn->get_samp_chunksize(wd);
 if(esp_codec_dev_read(mic,voice_stereo,n*4)!=ESP_CODEC_DEV_OK){hs_audio_voice_pause();return 0;}
 badge_gain_pcm(voice_stereo,voice_mono,n,BADGE_GAIN_DEFAULT,NULL);
 if(use_commands){if(mn->detect(md,voice_mono)==ESP_MN_STATE_DETECTED){esp_mn_results_t *r=mn->get_results(md);int id=r&&r->num?r->command_id[0]:0;mn->clean(md);command_window=false;return id;}return 0;}
 if(wn->detect(wd,voice_mono)>0){hs_audio_voice_pause();hs_audio_voice_listen();ESP_LOGI("小冰语音","本地唤醒命中");return 100;}return 0;
}
bool hs_audio_voice_finished(void){return voice_heard&&esp_timer_get_time()-voice_last_sound>1200000;}
