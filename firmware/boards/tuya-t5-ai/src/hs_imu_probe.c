#include "hs_runtime.h"
#include "tkl_gpio.h"
/* 板级低速开漏诊断：释放为上拉输入，拉低才输出；不修改锁定SDK。
 * 用户接线P00=SCL/P01=SDA，S1 TX1/RX1须OFF；UART0负责诊断输出。
 * 不访问相机、触摸总线，不配置IMU工作模式。 */
static bool io_ok;
static void pause_bus(void){int64_t until=hs_time_us()+50;while(hs_time_us()<until){} }
static void drive(TUYA_GPIO_NUM_E pin,bool release){
 TUYA_GPIO_BASE_CFG_T cfg={.mode=release?TUYA_GPIO_PULLUP:TUYA_GPIO_PUSH_PULL,
 .direct=release?TUYA_GPIO_INPUT:TUYA_GPIO_OUTPUT,.level=TUYA_GPIO_LEVEL_LOW};
 if(tkl_gpio_init(pin,&cfg)!=OPRT_OK)io_ok=false;
 pause_bus();
}
static int sense(TUYA_GPIO_NUM_E pin){TUYA_GPIO_LEVEL_E level;if(tkl_gpio_read(pin,&level)!=OPRT_OK){io_ok=false;return -1;}return level==TUYA_GPIO_LEVEL_HIGH;}
static bool clock_high(void){drive(TUYA_GPIO_NUM_0,true);int64_t end=hs_time_us()+2000;while(sense(TUYA_GPIO_NUM_0)!=1){if(!io_ok||hs_time_us()>end)return false;}pause_bus();return true;}
static void low_clock(void){drive(TUYA_GPIO_NUM_0,false);}
static void stop_bus(void){low_clock();drive(TUYA_GPIO_NUM_1,false);clock_high();drive(TUYA_GPIO_NUM_1,true);}
static bool start_bus(void){drive(TUYA_GPIO_NUM_1,true);if(!clock_high()||sense(TUYA_GPIO_NUM_1)!=1)return false;drive(TUYA_GPIO_NUM_1,false);low_clock();return io_ok;}
static bool send_byte(unsigned char b){
 for(unsigned i=0;i<8;i++){drive(TUYA_GPIO_NUM_1,(b&0x80)!=0);if(!clock_high())return false;low_clock();b<<=1;}
 drive(TUYA_GPIO_NUM_1,true);if(!clock_high())return false;
 bool ack=sense(TUYA_GPIO_NUM_1)==0;low_clock();return io_ok&&ack;
}
static bool read_byte(unsigned char *b){
 *b=0;drive(TUYA_GPIO_NUM_1,true);
 for(unsigned i=0;i<8;i++){if(!clock_high())return false;int bit=sense(TUYA_GPIO_NUM_1);if(bit<0)return false;*b=(*b<<1)|(unsigned)bit;low_clock();}
 /* 单字节读取后NACK，再STOP。 */
 drive(TUYA_GPIO_NUM_1,true);if(!clock_high())return false;low_clock();return io_ok;
}
static bool read_register(unsigned address,unsigned char reg,unsigned char *id){
 if(!start_bus())return false;
 bool ok=send_byte((unsigned char)(address<<1))&&send_byte(reg);
 if(ok)ok=start_bus()&&send_byte((unsigned char)((address<<1)|1))&&read_byte(id);
 stop_bus();return ok&&io_ok;
}
static bool identity(unsigned address,unsigned char *id){return read_register(address,0x75,id);}
void hs_t5_imu_probe(void){
 io_ok=true;drive(TUYA_GPIO_NUM_0,true);drive(TUYA_GPIO_NUM_1,true);
 int scl=sense(TUYA_GPIO_NUM_0),sda=sense(TUYA_GPIO_NUM_1);
 HS_LOGI("IMU","开漏慢速诊断 idle_scl=%d idle_sda=%d io_ok=%d",scl,sda,io_ok);
 if(!io_ok||scl!=1||sda!=1){HS_LOGW("IMU","总线空闲电平异常，停止发送。检查上拉/面包板接线/复用负载。");return;}
 unsigned matches=0;
 for(unsigned sample=0;sample<5;sample++)for(unsigned address=0x68;address<=0x69;address++){
  unsigned char id=0;bool ok=identity(address,&id);if(ok&&id==0x12)matches++;
  HS_LOGI("IMU","sample=%u addr=0x%02x transfer_ok=%d WHO_AM_I=0x%02x verified=%d",sample,address,ok,id,ok&&id==0x12);
  hs_delay_ms(10);
 }
 drive(TUYA_GPIO_NUM_0,true);drive(TUYA_GPIO_NUM_1,true);
 HS_LOGI("IMU","身份检测 matches=%u/10；尚未启用运动采样",matches);
}

/* 用户实物丝印I62与ICM-20602匹配后，手动诊断命令执行：
 * DS-000176 PWR_MGMT_1(0x6b) bit7=DEVICE_RESET；不写持久化/Flash。 */
void hs_t5_imu_reset_probe(void){
 io_ok=true;drive(TUYA_GPIO_NUM_0,true);drive(TUYA_GPIO_NUM_1,true);
 if(sense(TUYA_GPIO_NUM_0)!=1||sense(TUYA_GPIO_NUM_1)!=1||!io_ok){HS_LOGW("IMU","复位前总线异常，未发送复位");return;}
 unsigned char who=0,power=0,config=0;
 bool who_ok=read_register(0x68,0x75,&who),power_ok=read_register(0x68,0x6b,&power),config_ok=read_register(0x68,0x1a,&config);
 HS_LOGI("IMU","复位前 WHO=0x%02x ok=%d PWR=0x%02x ok=%d CONFIG=0x%02x ok=%d",who,who_ok,power,power_ok,config,config_ok);
 if(!who_ok||!power_ok||!config_ok){HS_LOGW("IMU","基础读取失败，未发送复位");return;}
 bool sent=start_bus()&&send_byte(0x68<<1)&&send_byte(0x6b)&&send_byte(0x80);stop_bus();
 HS_LOGI("IMU","DEVICE_RESET 指令传输=%d",sent&&io_ok);
 if(!sent||!io_ok)return;
 hs_delay_ms(200);hs_t5_imu_probe();
 power=0;config=0;power_ok=read_register(0x68,0x6b,&power);config_ok=read_register(0x68,0x1a,&config);
 HS_LOGI("IMU","复位后 PWR=0x%02x ok=%d expected=0x41 CONFIG=0x%02x ok=%d expected=0x80",power,power_ok,config,config_ok);
}
/* 只用于I62实物、默认寄存器吻合但身份异常的人工诊断。
 * 不输出门事件，不将raw数据作为正式受支持器件状态。结束恢复原PWR。 */
void hs_t5_imu_raw_probe(void){
 io_ok=true;drive(TUYA_GPIO_NUM_0,true);drive(TUYA_GPIO_NUM_1,true);
 unsigned char power=0,who=0,config=0;
 if(!read_register(0x68,0x75,&who)||!read_register(0x68,0x6b,&power)||!read_register(0x68,0x1a,&config)||power!=0x41||config!=0x80){HS_LOGW("IMU","默认寄存器条件不满足，未启用原始采样");return;}
 bool ok=start_bus()&&send_byte(0x68<<1)&&send_byte(0x6b)&&send_byte(0x01);stop_bus();
 if(!ok||!io_ok){HS_LOGW("IMU","诊断唤醒失败");return;}
 hs_delay_ms(200);
 HS_LOGI("IMU","RAW_DIAGNOSTIC identity_verified=0 WHO=0x%02x；请先静止再轻轻转动，20秒后恢复休眠",who);
 for(unsigned sample=0;sample<40;sample++){
  unsigned char data[14]={0};ok=true;
  for(unsigned i=0;i<14;i++)if(!read_register(0x68,(unsigned char)(0x3b+i),&data[i])){ok=false;break;}
  int value[7];for(unsigned i=0;i<7;i++){unsigned v=((unsigned)data[i*2]<<8)|data[i*2+1];value[i]=v>=32768?(int)v-65536:(int)v;}
  HS_LOGI("IMU","RAW sample=%u ok=%d ax=%d ay=%d az=%d gx=%d gy=%d gz=%d identity_verified=0",sample,ok&&io_ok,value[0],value[1],value[2],value[4],value[5],value[6]);
  if(!ok||!io_ok)break;
  hs_delay_ms(500);
 }
 ok=start_bus()&&send_byte(0x68<<1)&&send_byte(0x6b)&&send_byte(power);stop_bus();
 HS_LOGI("IMU","RAW完成，恢复PWR=0x%02x transport_ok=%d；正式身份仍未通过",power,ok&&io_ok);
}
