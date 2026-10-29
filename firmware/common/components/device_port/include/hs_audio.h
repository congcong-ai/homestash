#pragma once
#include "esp_err.h"
esp_err_t hs_audio_init(void);
esp_err_t hs_audio_start(const char *path);
esp_err_t hs_audio_read(void);
esp_err_t hs_audio_stop(void);
esp_err_t hs_audio_play(void);

#include <stddef.h>
#include <stdbool.h>
esp_err_t hs_audio_demo(const signed char *pcm,size_t bytes,volatile bool *cancel);
void hs_audio_demo_volume(int delta);
/* 主循环独占调用：100=小冰唤醒，1..9=固定指令；0=无命中。 */
esp_err_t hs_audio_voice_init(void);
int hs_audio_voice_poll(bool commands);
void hs_audio_voice_pause(void);
void hs_audio_voice_listen(void);
bool hs_audio_voice_finished(void);
