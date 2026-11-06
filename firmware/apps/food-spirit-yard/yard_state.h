#pragma once
#include <stdbool.h>
#include <stdint.h>
typedef enum { YARD_REST, YARD_LISTEN, YARD_WAIT, YARD_SPEAK, YARD_FAILED } yard_phase_t;
typedef struct { yard_phase_t phase; uint64_t deadline, last_door; unsigned generation; bool silent, listening; } yard_session_t;
/* 时间由设备单调时钟提供，传感器驱动只能上报去抖后的真实门事件。 */
static inline bool yard_door(yard_session_t *s, uint64_t now) {
  if (s->phase != YARD_REST || (s->last_door && now-s->last_door < 600000)) return false;
  s->last_door=now; s->generation++; s->phase=s->listening?YARD_LISTEN:YARD_REST;
  s->deadline=now+7000; return true;
}
static inline void yard_cancel(yard_session_t *s) {s->generation++;s->phase=YARD_REST;s->deadline=0;}
static inline bool yard_current(const yard_session_t *s,unsigned generation) {return s->generation==generation;}
static inline bool yard_expire(yard_session_t *s,uint64_t now) {
  if(s->phase==YARD_LISTEN && now>=s->deadline){yard_cancel(s);return true;}return false;
}
