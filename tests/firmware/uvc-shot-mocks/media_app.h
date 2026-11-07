#pragma once
#include <stddef.h>
#include <stdint.h>
#define UVC_CAMERA 1
#define IMAGE_MJPEG 1
#define FPS15 4
typedef void *camera_handle_t;
typedef struct {int type,port,format,width,height,fps;} media_camera_device_t;
typedef struct {uint8_t *frame;size_t length;} frame_buffer_t;
int media_app_camera_open(camera_handle_t *,media_camera_device_t *);
int media_app_camera_close(camera_handle_t *);
int media_app_register_read_frame_callback(int,void (*)(frame_buffer_t *));
int media_app_unregister_read_frame_callback(void);

typedef struct {int dummy;} frame_list_node_t;
#define MODULE_CAPTURE 1
frame_list_node_t *frame_buffer_list_get_by_type(int,int,int);
int frame_buffer_fb_register(frame_list_node_t *,int);
int frame_buffer_fb_deregister(frame_list_node_t *,int);
frame_buffer_t *frame_buffer_fb_read(frame_list_node_t *,int,int);
void frame_buffer_fb_read_free(frame_list_node_t *,frame_buffer_t *,int);
