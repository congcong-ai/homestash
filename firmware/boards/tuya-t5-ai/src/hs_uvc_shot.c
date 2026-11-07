/* 专用诊断：每次启动最多消费一次明确的串口拍摄指令。
 * 不注册后台常驻采集，不接库存；JPEG 仅通过诊断串口传回主机。 */
#include "hs_runtime.h"
#include "hs_display.h"
#include "media_app.h"
#include "driver/uvc_camera.h"
#include <stdlib.h>
#include <string.h>
#define MAX_JPEG (256u * 1024u)
static hs_queue_t frames;
static unsigned char *jpeg;
static bool used;
static unsigned seen,invalid;
static void receive_frame(frame_buffer_t *frame) {
  ++seen;
  if (!frame || !jpeg || !frame->frame || frame->length < 4 || frame->length > MAX_JPEG) return;
  if (frame->frame[0] != 0xff || frame->frame[1] != 0xd8) {++invalid;return;}
  size_t length=frame->length;
  while(length>2 && !(frame->frame[length-2]==0xff && frame->frame[length-1]==0xd9))--length;
  if(length<=2){++invalid;return;}
  /* 队列消息在复制完成后才发布；完成后不再改写这张照片。 */
  static bool copied;
  if(copied)return;
  memcpy(jpeg,frame->frame,length);copied=true;
  (void)hs_queue_send(frames,&length,0);
}
int hs_t5_uvc_shot(void) {
  if(used){HS_LOGW("USB相机","本次测试许可已消费；拒绝再次拍摄");return -1;}
  used=true;
  if(!frames)frames=hs_queue_create(1,sizeof(size_t));
  jpeg=malloc(MAX_JPEG);
  if(!frames||!jpeg){free(jpeg);jpeg=NULL;return -1;}
  camera_handle_t handle=NULL;
  media_camera_device_t camera={.type=UVC_CAMERA,.port=1,.format=IMAGE_MJPEG,.width=640,.height=480,.fps=15};
  hs_display_text("测试拍照：请站稳，3秒后拍摄");
  for(unsigned i=0;i<150;i++) {
    int c=hs_console_read_byte();
    if(c>32){free(jpeg);jpeg=NULL;hs_display_text("测试拍照已取消");return -1;}
    hs_delay_ms(20);
  }
  int result=bk_uvc_power_on(IMAGE_MJPEG,4000);
  if(!result){
    bk_usb_hub_port_info *port=bk_uvc_get_enum_info(1,IMAGE_MJPEG);
    bk_uvc_device_brief_info_t *info=port?port->usb_device_param:NULL;
    if(!info)result=-4;
    else {
      /* 锁定 SDK 的枚举表直接指向原始100ns帧间隔数组；设置流程却按fps使用。
       * 当前为独占诊断窗口，仅规范选中模式；断电关闭时该枚举缓存随之释放。 */
      bool found=false;
      for(unsigned i=0;i<info->all_frame.mjpeg_frame_num;i++){
        bk_uvc_frame *f=&info->all_frame.mjpeg_frame[i];
        if(f->width!=640||f->height!=480)continue;
        found=true;
        for(unsigned j=0;f->fps && j<f->fps_num;j++){
          uint32_t raw=f->fps[j];
          if(raw>1000)f->fps[j]=(10000000u+raw/2)/raw;
          HS_LOGI("USB相机","mode_interval=%u normalized_fps=%u",(unsigned)raw,(unsigned)f->fps[j]);
        }
      }
      if(!found)result=-5;
    }
  }
  if(!result)result=media_app_camera_open(&handle,&camera);
  HS_LOGI("USB相机","stage=open code=%d handle=%d",result,handle!=NULL);
  bool registered=false,safe_to_free=true;
  size_t length=0;
  frame_list_node_t *stream=NULL;
  if(!result){
    stream=frame_buffer_list_get_by_type(1,UVC_CAMERA,IMAGE_MJPEG);
    HS_LOGI("USB相机","stage=stream found=%d",stream!=NULL);
    if(!stream)result=-3;
    else {
      result=frame_buffer_fb_register(stream,MODULE_CAPTURE);
      registered=!result;
      HS_LOGI("USB相机","stage=register code=%d",result);
      for(unsigned i=0;!result && i<160 && !length;i++) {
        frame_buffer_t *frame=frame_buffer_fb_read(stream,MODULE_CAPTURE,50);
        if(frame){receive_frame(frame);frame_buffer_fb_read_free(stream,frame,MODULE_CAPTURE);}
        if(hs_queue_receive(frames,&length,0))break;
        int c=hs_console_read_byte();if(c>32){result=-1;break;}
      }
      if(!length&&!result)result=-2;
    }
  }
  if(registered){int e=frame_buffer_fb_deregister(stream,MODULE_CAPTURE);if(e&&!result)result=e;HS_LOGI("USB相机","stage=unregister code=%d",e);}
  if(handle){int e=media_app_camera_close(&handle);if(e&&!result)result=e;}
  (void)bk_uvc_power_off();
  HS_LOGI("USB相机","stage=closed seen=%u invalid=%u bytes=%u code=%d",seen,invalid,(unsigned)length,result);
  if(!result && length){
    uint32_t crc=0xffffffffu;
    for(size_t i=0;i<length;i++){crc^=jpeg[i];for(unsigned b=0;b<8;b++)crc=(crc>>1)^(0xedb88320u& (0u-(crc&1u)));}
    HS_LOGI("USB照片","BEGIN bytes=%u crc32=%08x",(unsigned)length,(unsigned)(crc^0xffffffffu));
    for(size_t offset=0;offset<length;offset+=48){
      char line[97];size_t n=length-offset;if(n>48)n=48;
      static const char hex[]="0123456789abcdef";
      for(size_t i=0;i<n;i++){line[2*i]=hex[jpeg[offset+i]>>4];line[2*i+1]=hex[jpeg[offset+i]&15];}
      line[2*n]=0;HS_LOGI("USB照片","DATA %s",line);hs_delay_ms(2);
    }
    HS_LOGI("USB照片","END");hs_display_text("测试照片已采集，相机已关闭");
  }else {HS_LOGW("USB相机","单帧测试失败 code=%d；无成功照片",result);hs_display_text("测试拍照失败，相机已关闭");}
  if(safe_to_free){free(jpeg);jpeg=NULL;}return result;
}
