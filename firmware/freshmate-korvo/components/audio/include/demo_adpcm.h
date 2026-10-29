#pragma once
#include <stddef.h>
#include <stdint.h>
/* 固定单声道 IMA WAV 256 字节块，解码为 505 个 16 kHz PCM 样本。 */
int demo_adpcm_decode(const uint8_t *block,size_t bytes,int16_t out[505]);
