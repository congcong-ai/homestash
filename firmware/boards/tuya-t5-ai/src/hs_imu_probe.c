#include "hs_runtime.h"
#include "tkl_i2c.h"
#include "tkl_pinmux.h"
/* 在显示/触摸启动前执行，避免与触摸轮询并发；只读取身份寄存器。
 * 用户已确认 SCL=P00、SDA=P01，S1 TX1/RX1已断开。触摸I2C0保持独立。 */
void hs_t5_imu_probe(void) {
 TUYA_IIC_BASE_CFG_T cfg={.role=TUYA_IIC_MODE_MASTER,.speed=TUYA_IIC_BUS_SPEED_100K,.addr_width=TUYA_IIC_ADDRESS_7BIT};
 OPERATE_RET e=tkl_io_pinmux_config(TUYA_GPIO_NUM_0,TUYA_IIC1_SCL);
 if(!e)e=tkl_io_pinmux_config(TUYA_GPIO_NUM_1,TUYA_IIC1_SDA);
 if(!e)e=tkl_i2c_init(TUYA_I2C_NUM_1,&cfg);
 if(e){HS_LOGW("IMU","总线诊断初始化失败 code=%d",(int)e);return;}
 bool found=false;
 for(unsigned address=0x68;address<=0x69;address++) {
  unsigned char reg=0x75,id=0;
  e=tkl_i2c_master_send(TUYA_I2C_NUM_1,address,&reg,1,true);
  if(!e)e=tkl_i2c_master_receive(TUYA_I2C_NUM_1,address,&id,1,false);
  HS_LOGI("IMU","probe addr=0x%02x result=%d WHO_AM_I=0x%02x expected=0x12 verified=%d",address,(int)e,id,!e&&id==0x12);
  if(!e&&id==0x12)found=true;
 }
 HS_LOGI("IMU","身份检测完成 found=%d；尚未验证运动采样或门事件",found);
}
