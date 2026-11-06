#pragma once
#include <stdint.h>
typedef struct {char *pbuf;uint32_t used_size;} TKL_AUDIO_FRAME_INFO_T;
int tkl_ao_put_frame(int card,int channel,void *handle,TKL_AUDIO_FRAME_INFO_T *frame);
