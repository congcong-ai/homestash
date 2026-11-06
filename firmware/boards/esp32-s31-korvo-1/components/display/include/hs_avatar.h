#pragma once
#include "lvgl.h"
typedef enum { HS_AVATAR_IDLE, HS_AVATAR_LISTEN, HS_AVATAR_THINK, HS_AVATAR_SPEAK, HS_AVATAR_ERROR } hs_avatar_state_t;
lv_obj_t *hs_avatar_create(lv_obj_t *parent,int x,int y);
void hs_avatar_state(lv_obj_t *avatar,hs_avatar_state_t state);
