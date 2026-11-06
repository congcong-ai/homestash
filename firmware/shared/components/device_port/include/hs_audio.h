#pragma once
#include "hs_error.h"
hs_err_t hs_audio_init(void);
hs_err_t hs_audio_start(const char *path);
hs_err_t hs_audio_read(void);
hs_err_t hs_audio_stop(void);
hs_err_t hs_audio_play(void);

#include <stddef.h>
#include <stdbool.h>
hs_err_t hs_audio_demo(const signed char *pcm,size_t bytes,volatile bool *cancel);
void hs_audio_demo_volume(int delta);
/* 主循环独占调用：100=小冰唤醒，1..9=固定指令，10=退下；0=无命中。 */
hs_err_t hs_audio_voice_init(void);
int hs_audio_voice_poll(bool commands);
void hs_audio_voice_pause(void);
void hs_audio_voice_listen(void);
bool hs_audio_voice_finished(void);

bool hs_audio_voice_awake(void);
void hs_audio_voice_sleep(void);
/* 清理指令上下文，保留会话期限与持续运行的WakeNet，供场景切换使用。 */
void hs_audio_voice_reset(void);

int hs_audio_volume_percent(void);
void hs_audio_volume_save(void);

/* UART请求仅排队，主循环安全执行真实模型录音诊断。 */
hs_err_t hs_audio_voice_probe_request(const char *url,bool awake,int context,float threshold,const char *phrase,bool route);
void hs_audio_voice_probe_poll(void);

void hs_audio_voice_context(int command);
