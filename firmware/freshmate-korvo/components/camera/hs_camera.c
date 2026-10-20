#include "hs_camera.h"
#include "bsp/camera.h"
#include "esp_video_device.h"
#include "esp_video_ioctl.h"
#include "esp_jpeg_enc.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include <sys/ioctl.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <fcntl.h>
#include <unistd.h>
#include <dirent.h>
#include <errno.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdbool.h>
#define PHOTO_DIR "/sdcard/homestash/photos"
#define JPEG_LIMIT (3*1024*1024)
static bool valid_id(const char *id) {
  if(!id || strlen(id)!=36) return false;
  for(int i=0;i<36;i++) {
    if(i==8 || i==13 || i==18 || i==23) { if(id[i]!='-') return false; }
    else if(!((id[i]>='0' && id[i]<='9') || (id[i]>='a' && id[i]<='f'))) return false;
  }
  return true;
}
esp_err_t hs_camera_path(const char *id,char *path,size_t size) {
  if(!valid_id(id)) return ESP_ERR_INVALID_ARG;
  return snprintf(path,size,PHOTO_DIR "/%s.jpg",id)<size?ESP_OK:ESP_ERR_INVALID_SIZE;
}
int hs_camera_recover(char id[37]) {
  if(mkdir(PHOTO_DIR,0700) && errno!=EEXIST) return -1;
  DIR *d=opendir(PHOTO_DIR); if(!d) return -1;
  struct dirent *e; int found=0;
  while((e=readdir(d))) {
    if(strlen(e->d_name)!=40 || strcmp(e->d_name+36,".jpg")) continue;
    memcpy(id,e->d_name,36); id[36]=0;
    if(valid_id(id)) {found=1;break;}
  }
  closedir(d);return found;
}
esp_err_t hs_camera_complete(const char *id) {
  char path[128];if(hs_camera_path(id,path,sizeof(path))!=ESP_OK) return ESP_FAIL;
  return remove(path)==0?ESP_OK:ESP_FAIL;
}
esp_err_t hs_camera_capture(const char *id) {
  char path[128],part[136]; if(hs_camera_path(id,path,sizeof(path))!=ESP_OK) return ESP_FAIL;
  struct stat existing;if(stat(path,&existing)==0) return ESP_OK;
  if(mkdir(PHOTO_DIR,0700) && errno!=EEXIST) return ESP_FAIL;
  snprintf(part,sizeof(part),"%s.part",path);
  /* 格式与方向沿用本地原厂 factory_demo；引脚完全由原样 BSP 提供。 */
  bsp_camera_config_t config={.width=0,.height=0,.pixel_format=BSP_CAMERA_PIXEL_FORMAT_RGB565_BE,.xclk_freq_hz=BSP_CAMERA_DEFAULT_XCLK_FREQ_HZ};
  bsp_camera_t *camera=NULL; bsp_camera_frame_t frame={0};bsp_camera_format_t format={0};
  jpeg_enc_handle_t encoder=NULL;uint8_t *input=NULL,*jpeg=NULL;bool started=false,held=false;
  esp_err_t result=bsp_camera_open(&config,&camera);if(result!=ESP_OK) goto done;
  result=bsp_camera_get_format(camera,&format);if(result!=ESP_OK) goto done;
  ESP_LOGI("hs_camera","format=%08lx %lux%lu stride=%lu",(unsigned long)format.pixelformat,(unsigned long)format.width,(unsigned long)format.height,(unsigned long)format.bytesperline);
  int fd=open(ESP_VIDEO_DVP_DEVICE_NAME,O_RDWR);
  if(fd<0) {result=ESP_FAIL;goto done;}
  struct timeval timeout={.tv_sec=3};int rc=ioctl(fd,VIDIOC_S_DQBUF_TIMEOUT,&timeout);close(fd);
  if(rc<0) {result=ESP_FAIL;goto done;}
  bool uyvy=format.pixelformat==V4L2_PIX_FMT_UYVY;
  result=bsp_camera_set_orientation(camera,!uyvy,!uyvy);if(result!=ESP_OK) goto done;
  result=bsp_camera_start(camera);if(result!=ESP_OK) goto done;started=true;
  /* 跳过初始帧，让自动曝光先稳定。每次取帧都有超时。 */
  for(int i=0;i<8;i++) {
    result=bsp_camera_get_frame(camera,&frame);if(result!=ESP_OK) goto done;held=true;
    if(i<7) {result=bsp_camera_return_frame(camera,&frame);held=false;if(result!=ESP_OK) goto done;}
  }
  jpeg_pixel_format_t pixel;
  if(format.pixelformat==V4L2_PIX_FMT_RGB565X) pixel=JPEG_PIXEL_FORMAT_RGB565_BE;
  else if(format.pixelformat==V4L2_PIX_FMT_RGB565) pixel=JPEG_PIXEL_FORMAT_RGB565_LE;
  else if(uyvy) pixel=JPEG_PIXEL_FORMAT_CbYCrY;
  else {result=ESP_ERR_NOT_SUPPORTED;goto done;}
  if(!format.width || !format.height || format.width>1920 || format.height>1080) {result=ESP_ERR_INVALID_SIZE;goto done;}
  size_t row=format.width*2, stride=format.bytesperline?format.bytesperline:row;
  if(stride<row || frame.size<stride*format.height) {result=ESP_ERR_INVALID_SIZE;goto done;}
  size_t raw=row*format.height;
  input=heap_caps_aligned_alloc(16,raw,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
  jpeg=heap_caps_malloc(JPEG_LIMIT,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
  if(!input || !jpeg) {result=ESP_ERR_NO_MEM;goto done;}
  for(unsigned y=0;y<format.height;y++) memcpy(input+y*row,(uint8_t*)frame.data+y*stride,row);
  result=bsp_camera_return_frame(camera,&frame);held=false;if(result!=ESP_OK) goto done;
  jpeg_enc_config_t enc=DEFAULT_JPEG_ENC_CONFIG();enc.width=format.width;enc.height=format.height;enc.src_type=pixel;enc.quality=80;
  if(jpeg_enc_open(&enc,&encoder)!=JPEG_ERR_OK) {result=ESP_FAIL;goto done;}
  int bytes=0;if(jpeg_enc_process(encoder,input,raw,jpeg,JPEG_LIMIT,&bytes)!=JPEG_ERR_OK || bytes<24) {result=ESP_FAIL;goto done;}
  FILE *f=fopen(part,"wb");if(!f) {result=ESP_FAIL;goto done;}
  bool saved=fwrite(jpeg,1,bytes,f)==bytes;
  if(fflush(f) || fsync(fileno(f))) saved=false;
  if(fclose(f)) saved=false;
  if(!saved || rename(part,path)) {result=ESP_FAIL;goto done;}
  ESP_LOGI("hs_camera","JPEG saved id=%s bytes=%d",id,bytes);result=ESP_OK;
done:
  if(held) bsp_camera_return_frame(camera,&frame);
  if(started) bsp_camera_stop(camera);
  if(camera) bsp_camera_close(camera);
  if(encoder) jpeg_enc_close(encoder);
  free(input);free(jpeg);
  if(result!=ESP_OK) ESP_LOGE("hs_camera","capture failed: %s",esp_err_to_name(result));
  return result;
}
