#pragma once
#include <stdint.h>
#define IMAGE_MJPEG 1
/* 仅测试替身，不用于 SDK 编译。 */
typedef struct { uint16_t width,height,index,fps_num; uint32_t *fps; } bk_uvc_frame;
typedef struct { uint16_t vendor_id,product_id; struct { bk_uvc_frame *mjpeg_frame; uint8_t mjpeg_frame_num; } all_frame; } bk_uvc_device_brief_info_t;
typedef struct { void *usb_device_param; } bk_usb_hub_port_info;
int bk_uvc_power_on(uint32_t format,uint32_t timeout);
int bk_uvc_power_off(void);
bk_usb_hub_port_info *bk_uvc_get_enum_info(uint8_t port,uint16_t format);
