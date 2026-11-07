/* 正式小院单帧适配：仅主动动作触发，返回本次JPEG；不写串口图像或库存。 */
#include "hs_runtime.h"
#include "hs_display.h"
#include "media_app.h"
#include "driver/uvc_camera.h"
#include <stdlib.h>
#include "tal_memory.h"
#include <string.h>
#define MAX_JPEG (256u * 1024u)
static hs_queue_t frames;
static unsigned char *jpeg;
static bool copied;
static const volatile bool *cancelled;
static unsigned seen,invalid;
static void receive_frame(frame_buffer_t *frame) {
  ++seen;
  if (!frame || !jpeg || !frame->frame || frame->length < 4 || frame->length > MAX_JPEG) return;
  if (frame->frame[0] != 0xff || frame->frame[1] != 0xd8) {++invalid;return;}
  size_t length=frame->length;
  while(length>2 && !(frame->frame[length-2]==0xff && frame->frame[length-1]==0xd9))--length;
  if(length<=2){++invalid;return;}
  /* 队列消息在复制完成后才发布；完成后不再改写这张照片。 */

  if(copied)return;
  memcpy(jpeg,frame->frame,length);copied=true;
  (void)hs_queue_send(frames,&length,0);
}
int hs_t5_uvc_photo(unsigned char **bytes,size_t *size,const volatile bool *cancel) {
  *bytes=NULL;*size=0;cancelled=cancel;copied=false;seen=invalid=0;
  if(!frames)frames=hs_queue_create(1,sizeof(size_t));
  jpeg=tal_psram_malloc(MAX_JPEG);
  if(!frames||!jpeg){tal_psram_free(jpeg);jpeg=NULL;return -1;}
  camera_handle_t handle=NULL;
  media_camera_device_t camera={.type=UVC_CAMERA,.port=1,.format=IMAGE_MJPEG,.width=640,.height=480,.fps=15};
  hs_display_text("正在拍照，点停止可取消。");
  if(*cancelled){tal_psram_free(jpeg);jpeg=NULL;return -1;}
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
        if(*cancelled){result=-1;break;}
      }
      if(!length&&!result)result=-2;
    }
  }
  if(registered){int e=frame_buffer_fb_deregister(stream,MODULE_CAPTURE);if(e&&!result)result=e;HS_LOGI("USB相机","stage=unregister code=%d",e);}
  if(handle){int e=media_app_camera_close(&handle);if(e&&!result)result=e;}
  (void)bk_uvc_power_off();
  HS_LOGI("USB相机","stage=closed seen=%u invalid=%u bytes=%u code=%d",seen,invalid,(unsigned)length,result);
  if(!result && length && !*cancelled){*bytes=jpeg;*size=length;jpeg=NULL;return 0;}
  if(safe_to_free){tal_psram_free(jpeg);jpeg=NULL;}return result?result:-1;
}
