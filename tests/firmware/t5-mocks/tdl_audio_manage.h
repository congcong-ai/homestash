#pragma once
#include <stdint.h>
#define TDL_AUDIO_FRAME_FORMAT_PCM 0
#define TDL_AUDIO_STATUS_RECEIVING 3
typedef uint8_t TDL_AUDIO_FRAME_FORMAT_E;
typedef uint8_t TDL_AUDIO_STATUS_E;
typedef void *TDL_AUDIO_HANDLE_T;
typedef void (*TDL_AUDIO_MIC_CB)(TDL_AUDIO_FRAME_FORMAT_E,TDL_AUDIO_STATUS_E,uint8_t *,uint32_t);
int tdl_audio_find(char *name,TDL_AUDIO_HANDLE_T *handle);
int tdl_audio_open(TDL_AUDIO_HANDLE_T handle,TDL_AUDIO_MIC_CB callback);
int tdl_audio_volume_set(TDL_AUDIO_HANDLE_T handle,uint8_t volume);
