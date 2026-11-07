#pragma once
#include <stdbool.h>
#include "hs_error.h"
hs_err_t hs_display_init(void);
void hs_display_text(const char *text);
void hs_display_network(const char *ssid, bool connected);
#include <stdint.h>
typedef struct { char text[1024]; char network[96]; uint32_t revision; } hs_display_snapshot_t;
void hs_display_snapshot(hs_display_snapshot_t *snapshot);
void hs_display_navigation(void (*navigate)(int));
void hs_display_select_page(int page);

hs_err_t hs_display_backlight(bool enabled);

hs_err_t hs_display_suspend(void);
hs_err_t hs_display_resume(void);

void hs_display_backend(bool connected);
typedef enum { HS_FACE_IDLE,HS_FACE_WAKE,HS_FACE_LISTEN,HS_FACE_THINK,HS_FACE_SPEAK,HS_FACE_HAPPY,HS_FACE_SURPRISE,HS_FACE_LOVE,HS_FACE_SLEEP,HS_FACE_ANGRY,HS_FACE_PHOTO,HS_FACE_ERROR } hs_face_state_t;
void hs_display_dialogue(int state);
void hs_t5_avatar_config(unsigned revision,int theme,int fullscreen);

void hs_t5_display_active(bool active);
