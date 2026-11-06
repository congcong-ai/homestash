#include "hs_audio.h"
#include "board_com_api.h"
#include "hs_fs.h"
#include "hs_runtime.h"
#include "hs_storage.h"
#include "tal_mutex.h"
#include "tdl_audio_manage.h"
#include "tkl_audio.h"
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
static unsigned volume = 60;
static volatile bool playback_cancelled;
void hs_t5_audio_cancel(bool cancel) { playback_cancelled=cancel; }
static uint32_t bytes;
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
  if (collecting && !failed) {
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
  bytes = 0;
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
hs_err_t hs_audio_play(void) {
  hs_file_info_t info;
  if (hs_outbox_validate_wav(HS_REPLY) || hs_fs_info(HS_REPLY, &info))
    return HS_FAIL;
  hs_file_t f = hs_fs_open(HS_REPLY, "rb");
  if (!f)
    return HS_FAIL;
  hs_err_t e = hs_fs_seek(f, 44) ? HS_FAIL : HS_OK;
  uint64_t remaining = (uint64_t)info.size - 44;
  unsigned char frame[640];
  while (!e && remaining) {
    if(playback_cancelled){e=HS_ERR_INVALID_STATE;break;}
    size_t wanted =
        remaining > sizeof(frame) ? sizeof(frame) : (size_t)remaining;
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
    TKL_AUDIO_FRAME_INFO_T out = {.pbuf = (char *)frame, .used_size = filled};
    if (tkl_ao_put_frame(0, 0, NULL, &out) != OPRT_OK)
      e = HS_FAIL;
    else
      hs_delay_ms((uint32_t)((filled + 31) / 32));
    remaining -= filled;
  }
  if (hs_fs_close(f))
    e = HS_FAIL;
  return e;
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
int hs_audio_volume_percent(void) { return (int)volume; }
void hs_audio_volume_save(void) {}
hs_err_t hs_audio_demo(const signed char *pcm, size_t n,
                       volatile bool *cancel) {
  if (!pcm || !n || n % 2 || n > 320000) return HS_ERR_INVALID_ARG;
  for (size_t offset=0; offset<n; offset+=640) {
    if (cancel && *cancel) return HS_ERR_INVALID_STATE;
    size_t count=n-offset; if(count>640)count=640;
    TKL_AUDIO_FRAME_INFO_T out={.pbuf=(char *)(pcm+offset),.used_size=count};
    if(tkl_ao_put_frame(0,0,NULL,&out)!=OPRT_OK)return HS_FAIL;
    hs_delay_ms((uint32_t)((count+31)/32));
  }
  return HS_OK;
}
hs_err_t hs_audio_voice_init(void) { return HS_ERR_NOT_SUPPORTED; }
int hs_audio_voice_poll(bool commands) {
  (void)commands;
  return 0;
}
void hs_audio_voice_pause(void) {}
void hs_audio_voice_listen(void) {}
bool hs_audio_voice_finished(void) { return false; }
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
