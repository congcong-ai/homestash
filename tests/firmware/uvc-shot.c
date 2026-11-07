#include "hs_runtime.h"
#include "uvc-shot-mocks/media_app.h"
#include "uvc-shot-mocks/driver/uvc_camera.h"
#include <assert.h>
#include <stdio.h>
#include <stdarg.h>
#include <string.h>
int hs_t5_uvc_shot(void);
static size_t queued;
static int open_count,close_count,unregistered,data_lines;
hs_queue_t hs_queue_create(unsigned n,size_t size){assert(n==1&&size==sizeof(size_t));return &queued;}
bool hs_queue_send(hs_queue_t q,const void *p,uint32_t timeout){(void)timeout;assert(q==&queued);queued=*(const size_t *)p;return true;}
bool hs_queue_receive(hs_queue_t q,void *p,uint32_t timeout){(void)timeout;assert(q==&queued);*(size_t *)p=queued;return queued!=0;}
int hs_console_read_byte(void){return EOF;}
void hs_delay_ms(uint32_t ms){(void)ms;}
void hs_display_text(const char *s){assert(s&&s[0]);}
void hs_log(const char *level,const char *tag,const char *fmt,...){(void)level;(void)tag;if(!strcmp(fmt,"DATA %s"))data_lines++;}
int media_app_camera_open(camera_handle_t *h,media_camera_device_t *c){assert(c->width==640&&c->height==480&&c->fps==15);*h=&queued;open_count++;return 0;}
int media_app_camera_close(camera_handle_t *h){assert(*h);*h=NULL;close_count++;return 0;}
int media_app_register_read_frame_callback(int fmt,void (*cb)(frame_buffer_t *)){
 assert(fmt==IMAGE_MJPEG);uint8_t bytes[]={0xff,0xd8,1,2,0xff,0xd9,0,0};frame_buffer_t f={bytes,sizeof(bytes)};cb(&f);return 0;
}
int media_app_unregister_read_frame_callback(void){unregistered++;return 0;}
static frame_list_node_t stream;
frame_list_node_t *frame_buffer_list_get_by_type(int p,int t,int f){assert(p==1&&t==UVC_CAMERA&&f==IMAGE_MJPEG);return &stream;}
int frame_buffer_fb_register(frame_list_node_t *n,int m){assert(n==&stream&&m==MODULE_CAPTURE);return 0;}
int frame_buffer_fb_deregister(frame_list_node_t *n,int m){assert(n==&stream&&m==MODULE_CAPTURE);unregistered++;return 0;}
frame_buffer_t *frame_buffer_fb_read(frame_list_node_t *n,int m,int timeout){(void)n;(void)m;(void)timeout;static uint8_t bytes[]={0xff,0xd8,1,2,0xff,0xd9,0,0};static frame_buffer_t f={bytes,sizeof(bytes)};return &f;}
void frame_buffer_fb_read_free(frame_list_node_t *n,frame_buffer_t *f,int m){assert(n==&stream&&f&&m==MODULE_CAPTURE);}
static uint32_t intervals[]={333333,666666,1000000};
static bk_uvc_frame mode={.width=640,.height=480,.fps_num=3,.fps=intervals};
static bk_uvc_device_brief_info_t descriptor={.all_frame={&mode,1}};
static bk_usb_hub_port_info usb_port={&descriptor};
int bk_uvc_power_on(uint32_t f,uint32_t t){assert(f==IMAGE_MJPEG&&t==4000);return 0;}
int bk_uvc_power_off(void){return 0;}
bk_usb_hub_port_info *bk_uvc_get_enum_info(uint8_t p,uint16_t f){assert(p==1&&f==IMAGE_MJPEG);return &usb_port;}
int main(void){assert(hs_t5_uvc_shot()==0);assert(intervals[0]==30&&intervals[1]==15&&intervals[2]==10);assert(queued==6&&open_count==1&&close_count==1&&unregistered==1&&data_lines==1);assert(hs_t5_uvc_shot()!=0&&open_count==1);puts("通过：帧间隔转FPS、单帧复制、尾填充清理、关闭与重复许可拒绝；仅测试替身。");}
