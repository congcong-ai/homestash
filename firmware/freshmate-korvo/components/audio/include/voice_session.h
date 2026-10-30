#pragma once
#include <stdbool.h>
#include <stdint.h>
/* 静音超时按最后一次有效交互计算，播放结束后可续期。 */
#define HS_VOICE_SESSION_US INT64_C(60000000)
typedef struct { int64_t until; } hs_voice_session_t;
static inline bool hs_voice_session_awake(hs_voice_session_t *s,int64_t now){return s->until>now;}
static inline void hs_voice_session_touch(hs_voice_session_t *s,int64_t now){s->until=now+HS_VOICE_SESSION_US;}
static inline void hs_voice_session_end(hs_voice_session_t *s){s->until=0;}
