#pragma once
#include <stdbool.h>
#include <stdint.h>
/* 事件源可替换为门磁或位移传感器；演示状态不写 NVS 或库存。 */
typedef enum {DEMO_BUTTON_DOOR_SOURCE, MAGNETIC_SENSOR_DOOR_SOURCE, MOTION_SENSOR_DOOR_SOURCE} door_event_source_t;
typedef enum {DOOR_OPEN, DOOR_CLOSE} door_event_kind_t;
typedef struct {door_event_kind_t kind;door_event_source_t source;int64_t at_us;} door_event_t;
typedef struct {unsigned count;int64_t last_open_us,close_at_us;} demo_door_t;
static inline bool demo_door_event(demo_door_t *state,door_event_t event){
 if(event.kind==DOOR_CLOSE){state->close_at_us=0;return true;}
 if(state->close_at_us)return false;
 if(state->count && event.at_us-state->last_open_us<350000)return false;
 state->count++;state->last_open_us=event.at_us;state->close_at_us=event.at_us+2500000;return true;
}
