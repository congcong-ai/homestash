#include "hs_audio.h"
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
static esp_codec_dev_sample_info_t format = {.sample_rate=16000,.bits_per_sample=16,.channel=2};
esp_err_t hs_audio_init(void) {
  mic = bsp_audio_codec_microphone_init();
  speaker = bsp_audio_codec_speaker_init();
  return mic && speaker ? ESP_OK : ESP_FAIL;
}
esp_err_t hs_audio_start(const char *path) {
  if (record) return ESP_ERR_INVALID_STATE;
  record = fopen(path, "wb");
  if (!record) return ESP_FAIL;
  bytes = 0;
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
