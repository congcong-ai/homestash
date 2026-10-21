#pragma once
#include "esp_err.h"
esp_err_t hs_audio_init(void);
esp_err_t hs_audio_start(const char *path);
esp_err_t hs_audio_read(void);
esp_err_t hs_audio_stop(void);
esp_err_t hs_audio_play(void);
