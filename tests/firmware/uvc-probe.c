#include "uvc-mocks/driver/uvc_camera.h"
#include <assert.h>
#include <stddef.h>
int hs_t5_uvc_probe(void);
static int power_error,cleanup_error,missing,powered,off_count;
static bk_uvc_frame frame={.width=640,.height=480};
static bk_uvc_device_brief_info_t info={.vendor_id=0x1234,.product_id=0x5678,.all_frame={&frame,1}};
static bk_usb_hub_port_info port={&info};
int bk_uvc_power_on(uint32_t format,uint32_t timeout){assert(!powered);assert(format==IMAGE_MJPEG&&timeout==4000);powered=1;return power_error;}
int bk_uvc_power_off(void){assert(powered);powered=0;off_count++;return cleanup_error;}
bk_usb_hub_port_info *bk_uvc_get_enum_info(uint8_t p,uint16_t format){assert(powered&&!power_error);assert(p==1&&format==IMAGE_MJPEG);return missing?NULL:&port;}
int main(void){
 assert(hs_t5_uvc_probe()==0&&!powered&&off_count==1);
 power_error=-9;assert(hs_t5_uvc_probe()==-9&&!powered&&off_count==2);
 power_error=0;missing=1;assert(hs_t5_uvc_probe()!=0&&!powered&&off_count==3);
 missing=0;cleanup_error=-8;assert(hs_t5_uvc_probe()==-8&&!powered&&off_count==4);
 cleanup_error=0;info.all_frame.mjpeg_frame=NULL;assert(hs_t5_uvc_probe()!=0&&!powered&&off_count==5);
}
