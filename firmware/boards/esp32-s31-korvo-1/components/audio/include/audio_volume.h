#pragma once
// 扬声器独立 11 档；内部下标 0–10，屏幕显示 1–11。
#define BADGE_VOLUME_LEVELS 11
#define BADGE_VOLUME_DEFAULT 5
#define BADGE_ACTION_VOLUME 200
int badge_volume_clamp(int level);
int badge_volume_codec(int level);
int badge_volume_db(int level);
