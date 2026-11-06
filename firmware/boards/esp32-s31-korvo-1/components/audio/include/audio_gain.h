#pragma once
#include <stddef.h>
#include <stdint.h>
#define BADGE_GAIN_LEVELS 11
#define BADGE_GAIN_DEFAULT 8
int badge_gain_clamp(int level);
float badge_gain_analog_db(int level);
int badge_gain_digital_db(int level);
unsigned badge_gain_pcm(const int16_t *stereo, int16_t *mono, size_t samples, int level, unsigned *peak);
