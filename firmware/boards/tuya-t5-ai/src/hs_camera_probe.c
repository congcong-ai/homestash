#include "hs_runtime.h"
#include "tkl_i2c.h"
#include "tkl_pinmux.h"
/* 身份协议依据 Espressif esp-video-components 的 sc101iot.h / sc101iot_regs.h：
 * https://github.com/espressif/esp-video-components/tree/master/esp_cam_sensor/sensors/sc101iot
 * 仅切换寄存器页并读取ID；无初始化表、复位、DVP时钟或图像采集。
 * 在显示/触摸线程启动之前执行，避免复合访问被触摸打断。 */
static OPERATE_RET read_byte(unsigned char reg, unsigned char *value) {
 OPERATE_RET e=tkl_i2c_master_send(TUYA_I2C_NUM_0,0x68,&reg,1,false);
 return e?e:tkl_i2c_master_receive(TUYA_I2C_NUM_0,0x68,value,1,false);
}
void hs_t5_camera_probe(void) {
 TUYA_IIC_BASE_CFG_T cfg={.role=TUYA_IIC_MODE_MASTER,.speed=TUYA_IIC_BUS_SPEED_100K,.addr_width=TUYA_IIC_ADDRESS_7BIT};
 OPERATE_RET e=tkl_io_pinmux_config(TUYA_GPIO_NUM_13,TUYA_IIC0_SCL);
 if(!e)e=tkl_io_pinmux_config(TUYA_GPIO_NUM_15,TUYA_IIC0_SDA);
 if(!e)e=tkl_i2c_init(TUYA_I2C_NUM_0,&cfg);
 if(e){HS_LOGW("相机诊断","总线初始化失败 code=%d",(int)e);return;}
 for(unsigned sample=0;sample<3;sample++){
  unsigned char page[]={0xf0,0x31},high=0,low=0;
  e=tkl_i2c_master_send(TUYA_I2C_NUM_0,0x68,page,2,false);
  if(!e)e=read_byte(0xf7,&high);
  if(!e)e=read_byte(0xf8,&low);
  unsigned pid=((unsigned)high<<8)|low;
  HS_LOGI("相机诊断","sample=%u bus=0 scl=13 sda=15 addr=0x68 result=%d pid=0x%04x expected=0xda4a verified=%d",sample,(int)e,pid,!e&&pid==0xda4a);
  hs_delay_ms(20);
 }
 HS_LOGI("相机诊断","仅检测控制通信；未启用采集，未拍照。失败不能排除缺少时钟/复位/转接映射问题。");
}
