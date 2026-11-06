#include "audio_gain.h"
int badge_gain_clamp(int level) { return level < 0 ? 0 : level >= BADGE_GAIN_LEVELS ? BADGE_GAIN_LEVELS - 1 : level; }
float badge_gain_analog_db(int level) { level=badge_gain_clamp(level); return 18.5f + 3.0f * (level < 6 ? level : 6); }
int badge_gain_digital_db(int level) { level=badge_gain_clamp(level); return level <= 6 ? 0 : (level-6)*3; }
unsigned badge_gain_pcm(const int16_t *stereo, int16_t *mono, size_t samples, int level, unsigned *peak) {
  static const int32_t scale[] = {65536,92572,130762,184706,260904};
  int digital=badge_gain_digital_db(level)/3;
  unsigned clipped=0, max=0;
  for (size_t i=0;i<samples;i++) {
    int32_t mixed=((int32_t)stereo[i*2]+stereo[i*2+1])/2;
    int64_t amplified=(int64_t)mixed*scale[digital]/65536;
    if (amplified>32767) { amplified=32767; clipped++; }
    if (amplified<-32768) { amplified=-32768; clipped++; }
    mono[i]=(int16_t)amplified;
    unsigned absolute=amplified<0?(unsigned)(-amplified):(unsigned)amplified;
    if (absolute>max) max=absolute;
  }
  if (peak) *peak=max;
  return clipped;
}
