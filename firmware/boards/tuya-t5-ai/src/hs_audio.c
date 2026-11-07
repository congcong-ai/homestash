#include "hs_audio.h"
#include "board_com_api.h"
#include "hs_fs.h"
#include "hs_runtime.h"
#include "hs_storage.h"
#include "tal_mutex.h"
#include "tdl_audio_manage.h"
#include "tkl_audio.h"
#include "tkl_asr.h"
#include <string.h>
static TDL_AUDIO_HANDLE_T audio;
static MUTEX_HANDLE lock;
static hs_file_t recording;
typedef struct {
  uint32_t size;
  uint8_t data[1280];
} pcm_frame_t;
static hs_queue_t frames;
static bool failed, collecting;
enum { WAKE_FRAME_BYTES = 640 };
typedef union {
  int16_t samples[WAKE_FRAME_BYTES / sizeof(int16_t)];
  uint8_t bytes[WAKE_FRAME_BYTES];
} wake_frame_t;
static hs_queue_t wake_frames;
static wake_frame_t wake_partial;
static unsigned wake_used;
static bool wake_enabled;
static unsigned volume = 60;
static bool barge_enabled,barge_monitor,barge_trigger;
static int64_t playback_start;
enum {
  BARGE_ENERGY_THRESHOLD = 1200,
  BARGE_VOICED_SAMPLES = 1600, /* 100 ms at 16 kHz */
  BARGE_GAP_SAMPLES = 640,    /* 40 ms between syllables */
};
static unsigned barge_samples,barge_gap,pre_write,pre_count;
static unsigned barge_frames,barge_peak,barge_longest;
static unsigned char pre_roll[16000];
void hs_t5_audio_barge_arm(bool enabled){tal_mutex_lock(lock);barge_enabled=enabled;tal_mutex_unlock(lock);}
bool hs_t5_audio_barge_requested(void){tal_mutex_lock(lock);bool requested=barge_trigger;tal_mutex_unlock(lock);return requested;}
void hs_t5_audio_barge_discard(void){tal_mutex_lock(lock);barge_trigger=false;barge_monitor=false;pre_count=pre_write=barge_samples=barge_gap=0;tal_mutex_unlock(lock);}
static void playback_monitor_start(void){tal_mutex_lock(lock);barge_monitor=barge_enabled;barge_samples=barge_gap=0;barge_frames=barge_peak=barge_longest=0;pre_count=pre_write=0;playback_start=hs_time_us();tal_mutex_unlock(lock);}
static void playback_monitor_end(void) {
  tal_mutex_lock(lock);
  bool monitored=barge_monitor, triggered=barge_trigger;
  unsigned frames_seen=barge_frames, peak=barge_peak, longest=barge_longest;
  barge_monitor=false;
  tal_mutex_unlock(lock);
  if(monitored)HS_LOGI("audio","barge frames=%u peak_mean=%u peak_voiced_samples=%u triggered=%d",
    frames_seen,peak,longest,(int)triggered);
}

static volatile bool playback_cancelled;
static bool playback_drained=true;
bool hs_t5_audio_cancelled(void){return playback_cancelled;}
void hs_t5_audio_cancel(bool cancel) {
  if(!cancel&&!playback_drained)return;
  playback_cancelled=cancel;
  if(audio)tdl_audio_volume_set(audio,cancel?0:volume);
}
static uint32_t bytes;
static bool voice_heard;
static int64_t voice_last_sound;
static unsigned voiced_samples;
static void put32(unsigned char *p, uint32_t value) {
  for (unsigned i = 0; i < 4; i++)
    p[i] = (unsigned char)(value >> (8 * i));
}
static void wav_header(unsigned char h[44], uint32_t n) {
  static const unsigned char base[44] = {
      'R', 'I', 'F', 'F', 36, 0, 0,   0,   'W', 'A',  'V',  'E', 'f', 'm', 't',
      ' ', 16,  0,   0,   0,  1, 0,   1,   0,   0x80, 0x3e, 0,   0,   0,   0x7d,
      0,   0,   2,   0,   16, 0, 'd', 'a', 't', 'a',  0,    0,   0,   0};
  memcpy(h, base, 44);
  put32(h + 4, 36 + n);
  put32(h + 40, n);
}
/* 音频回调只复制 PCM；磁盘写入由产品循环执行，队列满时明确报错。 */
static void microphone(TDL_AUDIO_FRAME_FORMAT_E type, TDL_AUDIO_STATUS_E status,
                       uint8_t *data, uint32_t n) {
  (void)status;
  if (type != TDL_AUDIO_FRAME_FORMAT_PCM || !data || !n)
    return;
  tal_mutex_lock(lock);
  if (wake_enabled && !collecting && !(n % 2)) {
    const uint8_t *pcm = data;
    uint32_t remaining = n;
    while (remaining) {
      unsigned count = WAKE_FRAME_BYTES - wake_used;
      if (count > remaining) count = remaining;
      memcpy(wake_partial.bytes + wake_used, pcm, count);
      wake_used += count;
      pcm += count;
      remaining -= count;
      if (wake_used == WAKE_FRAME_BYTES) {
        hs_queue_send(wake_frames, &wake_partial, 0);
        wake_used = 0;
      }
    }
  }
  if(!collecting&&(barge_monitor||barge_trigger)){
    for(uint32_t i=0;i<n;i++){pre_roll[pre_write]=data[i];pre_write=(pre_write+1)%sizeof(pre_roll);if(pre_count<sizeof(pre_roll))pre_count++;}
    uint64_t energy=0;for(uint32_t i=0;i+1<n;i+=2){int v=(int16_t)((unsigned)data[i]|((unsigned)data[i+1]<<8));energy+=(unsigned)(v<0?-v:v);}
    if(barge_monitor&&hs_time_us()-playback_start>350000&&n>=2){
      unsigned mean=(unsigned)(energy/(n/2));
      barge_frames++;
      if(mean>barge_peak)barge_peak=mean;
      if(!barge_trigger&&mean>BARGE_ENERGY_THRESHOLD){
        barge_gap=0;
        barge_samples+=n/2;
        if(barge_samples>barge_longest)barge_longest=barge_samples;
        if(barge_samples>=BARGE_VOICED_SAMPLES)barge_trigger=true;
      }else if(!barge_trigger&&barge_samples){
        barge_gap+=n/2;
        if(barge_gap>BARGE_GAP_SAMPLES)barge_samples=barge_gap=0;
      }
    }
  }
  if (collecting && !failed) {
    uint64_t energy=0;
    for(uint32_t i=0;i+1<n;i+=2){int v=(int16_t)((unsigned)data[i]|((unsigned)data[i+1]<<8));energy+=(unsigned)(v<0?-v:v);}
    if(n>=2 && energy/(n/2)>500){
      voiced_samples+=n/2;voice_last_sound=hs_time_us();
      if(voiced_samples>=1280)voice_heard=true;
    }else if(!voice_heard)voiced_samples=0;
    if (n % 2)
      failed = true;
    else {
      while (n) {
        pcm_frame_t frame;
        frame.size = n > sizeof(frame.data) ? sizeof(frame.data) : n;
        memcpy(frame.data, data, frame.size);
        if (!hs_queue_send(frames, &frame, 0)) {
          failed = true;
          break;
        }
        data += frame.size;
        n -= frame.size;
      }
    }
  }
  tal_mutex_unlock(lock);
}
static hs_err_t drain(void) {
  pcm_frame_t frame;
  while (hs_queue_receive(frames, &frame, 0)) {
    if (frame.size > 1920000 - bytes ||
        hs_fs_write(frame.data, frame.size, recording) != frame.size) {
      tal_mutex_lock(lock);
      failed = true;
      tal_mutex_unlock(lock);
      return HS_FAIL;
    }
    bytes += frame.size;
  }
  tal_mutex_lock(lock);
  bool ok = !failed;
  tal_mutex_unlock(lock);
  return ok ? HS_OK : HS_FAIL;
}
hs_err_t hs_audio_init(void) {
  if (tal_mutex_create_init(&lock) != OPRT_OK)
    return HS_ERR_NO_MEM;
  frames = hs_queue_create(16, sizeof(pcm_frame_t));
  if (!frames)
    return HS_ERR_NO_MEM;
  if (tdl_audio_find(AUDIO_CODEC_NAME, &audio) != OPRT_OK ||
      tdl_audio_open(audio, microphone) != OPRT_OK)
    return HS_FAIL;
  return tdl_audio_volume_set(audio, volume) == OPRT_OK ? HS_OK : HS_FAIL;
}
hs_err_t hs_audio_start(const char *path) {
  if(playback_cancelled)return HS_ERR_INVALID_STATE;
  tal_mutex_lock(lock);
  if (recording) {
    tal_mutex_unlock(lock);
    return HS_ERR_INVALID_STATE;
  }
  hs_file_info_t info;
  int exists = hs_fs_info(path, &info);
  if (exists != 1) {
    tal_mutex_unlock(lock);
    return HS_ERR_INVALID_STATE;
  }
  pcm_frame_t old;
  while (hs_queue_receive(frames, &old, 0)) {
  }
  recording = hs_fs_open(path, "wb");
  bytes = 0;voice_heard=false;voice_last_sound=0;voiced_samples=0;
  failed = false;
  unsigned char h[44];
  wav_header(h, 0);
  if (!recording) {
    tal_mutex_unlock(lock);
    return HS_FAIL;
  }
  if (hs_fs_write(h, 44, recording) != 44 || hs_fs_sync(recording)) {
    failed = true;
    hs_fs_close(recording);
    recording = NULL;
    tal_mutex_unlock(lock);
    return HS_FAIL;
  }
  if (barge_trigger) {
    unsigned offset=(pre_write+sizeof(pre_roll)-pre_count)%sizeof(pre_roll);
    unsigned first=sizeof(pre_roll)-offset;
    if(first>pre_count)first=pre_count;
    unsigned second=pre_count-first;
    if(hs_fs_write(pre_roll+offset,first,recording)!=first||
       (second&&hs_fs_write(pre_roll,second,recording)!=second)){
      hs_fs_close(recording);
      recording=NULL;
      tal_mutex_unlock(lock);
      return HS_FAIL;
    }
    bytes=pre_count;
    voice_heard=true;
    voice_last_sound=hs_time_us();
    barge_trigger=barge_monitor=false;
    pre_count=pre_write=barge_samples=barge_gap=0;
  }
  collecting = true;
  tal_mutex_unlock(lock);
  return HS_OK;
}
hs_err_t hs_audio_read(void) {
  hs_delay_ms(10);
  return recording ? drain() : HS_ERR_INVALID_STATE;
}
hs_err_t hs_audio_stop(void) {
  if (!recording)
    return HS_ERR_INVALID_STATE;
  tal_mutex_lock(lock);
  collecting = false;
  tal_mutex_unlock(lock);
  hs_err_t e = drain();
  unsigned char h[44];
  wav_header(h, bytes);
  if (!bytes)
    e = HS_FAIL;
  if (hs_fs_seek(recording, 0) || hs_fs_write(h, 44, recording) != 44 ||
      hs_fs_sync(recording))
    e = HS_FAIL;
  if (hs_fs_close(recording))
    e = HS_FAIL;
  recording = NULL;
  return e;
}
hs_err_t hs_t5_audio_play_path(const char *path) {
  hs_file_info_t info;
  if (hs_outbox_validate_wav(path) || hs_fs_info(path, &info))
    return HS_FAIL;
  hs_file_t f = hs_fs_open(path, "rb");
  if (!f)
    return HS_FAIL;
  hs_err_t e = hs_fs_seek(f, 44) ? HS_FAIL : HS_OK;
  uint64_t remaining = (uint64_t)info.size - 44;
  unsigned char frame[640];
  playback_monitor_start();
  int64_t began=hs_time_us(),read_max=0,put_max=0;uint32_t sent=0,crc=~0u;unsigned stalls=0;
  while (!e && remaining) {
    if(playback_cancelled||hs_t5_audio_barge_requested()){e=HS_ERR_INVALID_STATE;break;}
    size_t wanted =
        remaining > sizeof(frame) ? sizeof(frame) : (size_t)remaining;
    int64_t read_start=hs_time_us();
    size_t filled = 0;
    while (filled < wanted) {
      size_t n = hs_fs_read(frame + filled, wanted - filled, f);
      if (!n) {
        e = HS_FAIL;
        break;
      }
      filled += n;
    }
    if (e)
      break;
    int64_t read_us=hs_time_us()-read_start;if(read_us>read_max)read_max=read_us;
    for(size_t i=0;i<filled;i++){crc^=frame[i];for(unsigned b=0;b<8;b++)crc=(crc>>1)^((0u-(crc&1u))&0xedb88320u);}
    TKL_AUDIO_FRAME_INFO_T out = {.pbuf = (char *)frame, .used_size = filled};
    int64_t put_start=hs_time_us();
    int ret=tkl_ao_put_frame(0,0,NULL,&out);
    if(ret!=OPRT_OK){stalls++;HS_LOGW("audio","put result=%d offset=%u",(int)ret,(unsigned)sent);e=HS_FAIL;}
    int64_t put_us=hs_time_us()-put_start;if(put_us>put_max)put_max=put_us;
    sent+=filled;
    /* 用累计音频时钟节拍，避免每帧额外叠加SD和调度延迟。 */
    int64_t wait=began+(int64_t)sent*1000000/32000-hs_time_us();
    if(!e&&wait>0)hs_delay_ms((uint32_t)((wait+999)/1000));
    remaining -= filled;
  }
  playback_monitor_end();
  if (hs_fs_close(f))e=HS_FAIL;
  HS_LOGI("audio","format=s16le/16000/mono pcm_read_bytes=%u crc32=%08x elapsed_ms=%u read_max_us=%u put_max_us=%u stalls=%u result=%d",(unsigned)sent,(unsigned)~crc,(unsigned)((hs_time_us()-began)/1000),(unsigned)read_max,(unsigned)put_max,stalls,(int)e);
  return e;
}
/* SDK clear_buffer 是空实现。旧生产者退出后，保持静音，以零PCM排空播放管线。
 * 当前锁定PCM路径 raw_write=320/640字节、pipeline=320字节；200ms覆盖这些缓冲。
 * 此函数只由完成旧任务的一方调用，不能与旧播放器并发送帧。
 */
void hs_t5_audio_quiesce(void){
  unsigned char zero[640]={0};int result=0;
  for(unsigned i=0;i<10;i++){
    TKL_AUDIO_FRAME_INFO_T frame={.pbuf=(char *)zero,.used_size=sizeof(zero)};
    int r=tkl_ao_put_frame(0,0,NULL,&frame);if(r)result=r;
    hs_delay_ms(20);
  }
  playback_drained=result==0;
  HS_LOGI("audio","cancel muted drain_ms=200 result=%d",result);
}
void hs_audio_demo_volume(int delta) {
  int next = (int)volume + delta * 5;
  if (next < 0)
    next = 0;
  if (next > 100)
    next = 100;
  if (tdl_audio_volume_set(audio, (uint8_t)next) == OPRT_OK)
    volume = (unsigned)next;
}
hs_err_t hs_audio_play(void) { return hs_t5_audio_play_path(HS_REPLY); }
int hs_audio_volume_percent(void) { return (int)volume; }
void hs_audio_volume_save(void) {}
hs_err_t hs_audio_demo(const signed char *pcm, size_t n,
                       volatile bool *cancel) {
  if (!pcm || !n || n % 2 || n > 320000) return HS_ERR_INVALID_ARG;
  playback_monitor_start();
  int64_t demo_start=hs_time_us();
  HS_LOGI("audio","fixed begin bytes=%u format=s16le/16000/mono",(unsigned)n);
  for (size_t offset=0; offset<n; offset+=640) {
    if ((cancel && *cancel)||hs_t5_audio_barge_requested()){playback_monitor_end();return HS_ERR_INVALID_STATE;}
    size_t count=n-offset; if(count>640)count=640;
    TKL_AUDIO_FRAME_INFO_T out={.pbuf=(char *)(pcm+offset),.used_size=count};
    if(tkl_ao_put_frame(0,0,NULL,&out)!=OPRT_OK){playback_monitor_end();return HS_FAIL;}
    int64_t wait=demo_start+(int64_t)(offset+count)*1000000/32000-hs_time_us();
    if(wait>0)hs_delay_ms((uint32_t)((wait+999)/1000));
  }
  playback_monitor_end();
  HS_LOGI("audio","fixed end elapsed_ms=%u",(unsigned)((hs_time_us()-demo_start)/1000));
  return HS_OK;
}
hs_err_t hs_audio_voice_init(void) {
  /* SDK 将 Hey Tuya 和“你好涂鸦”映射到同一识别项。 */
  TKL_ASR_WAKEUP_WORD_E word = TKL_ASR_WAKEUP_NIHAO_TUYA;
  if (tkl_asr_get_process_uint_size() != WAKE_FRAME_BYTES)
    return HS_ERR_NOT_SUPPORTED;
  wake_frames = hs_queue_create(12, sizeof(wake_frame_t));
  if (!wake_frames)
    return HS_ERR_NO_MEM;
  if (tkl_asr_init() != OPRT_OK)
    return HS_FAIL;
  if (tkl_asr_wakeup_word_config(&word, 1) != OPRT_OK) {
    tkl_asr_deinit();
    return HS_FAIL;
  }
  return HS_OK;
}
int hs_audio_voice_poll(bool commands) {
  (void)commands;
  tal_mutex_lock(lock);
  wake_enabled = true;
  tal_mutex_unlock(lock);
  wake_frame_t frame;
  for (unsigned i = 0; i < 4 && hs_queue_receive(wake_frames, &frame, 0); i++) {
    if (tkl_asr_recognize_wakeup_word(frame.bytes, sizeof(frame.bytes)) ==
        TKL_ASR_WAKEUP_NIHAO_TUYA) {
      hs_audio_voice_pause();
      return 100;
    }
  }
  return 0;
}
void hs_audio_voice_pause(void) {
  tal_mutex_lock(lock);
  wake_enabled = false;
  wake_used = 0;
  tal_mutex_unlock(lock);
  wake_frame_t frame;
  while (hs_queue_receive(wake_frames, &frame, 0)) {}
}
void hs_audio_voice_listen(void) {}
bool hs_audio_voice_finished(void) {
  tal_mutex_lock(lock);bool done=voice_heard&&hs_time_us()-voice_last_sound>1200000;tal_mutex_unlock(lock);return done;
}
bool hs_t5_audio_heard(void){tal_mutex_lock(lock);bool heard=voice_heard;tal_mutex_unlock(lock);return heard;}
bool hs_audio_voice_awake(void) { return false; }
void hs_audio_voice_sleep(void) {}
void hs_audio_voice_reset(void) {}
hs_err_t hs_audio_voice_probe_request(const char *url, bool awake, int context,
                                      float threshold, const char *phrase,
                                      bool route) {
  (void)url;
  (void)awake;
  (void)context;
  (void)threshold;
  (void)phrase;
  (void)route;
  return HS_ERR_NOT_SUPPORTED;
}
void hs_audio_voice_probe_poll(void) {}
void hs_audio_voice_context(int command) { (void)command; }
