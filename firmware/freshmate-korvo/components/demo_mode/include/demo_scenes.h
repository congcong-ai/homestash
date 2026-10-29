#pragma once
#include <stddef.h>
typedef struct { const char *cue,*reply; const signed char *pcm; size_t bytes; } demo_step_t;
typedef struct {const char *title,*seed; int count; const demo_step_t *steps;} demo_scene_t;
extern const demo_scene_t demo_scenes[6];
