#include "audio_volume.h"
int badge_volume_clamp(int level) {
 return level<0?0:level>=BADGE_VOLUME_LEVELS?BADGE_VOLUME_LEVELS-1:level;
}
int badge_volume_codec(int level) {
 // SDK 默认曲线：0–100 映射为 -50–0 dB，0 同时执行静音。
 static const int curve[BADGE_VOLUME_LEVELS]={0,50,64,74,82,88,92,94,96,98,100};
 return curve[badge_volume_clamp(level)];
}
int badge_volume_db(int level) {return badge_volume_codec(level)/2-50;}
