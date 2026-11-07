#include "hs_runtime.h"
#include "tkl_gpio.h"
#include <assert.h>
#include <stdio.h>
#include <stdarg.h>
static int bits[32],n,index_bit,fail_io;
int64_t hs_time_us(void){static int64_t t;return t+=25;}
void hs_delay_ms(uint32_t n){(void)n;}
void hs_log(const char*a,const char*b,const char*c,...){(void)a;(void)b;(void)c;}
int tkl_gpio_init(int pin,const TUYA_GPIO_BASE_CFG_T *cfg){(void)pin;assert(cfg->direct!=TUYA_GPIO_OUTPUT||cfg->level==0);return fail_io?-1:0;}
int tkl_gpio_read(int pin,int *level){if(pin==0){*level=1;return 0;}assert(index_bit<n);*level=bits[index_bit++];return 0;}
#include "../../firmware/boards/tuya-t5-ai/src/hs_imu_probe.c"
int main(void){
 int a[]={1,0,0,1,0,0,0,0,1,0,0,1,0};for(unsigned i=0;i<sizeof(a)/sizeof(a[0]);i++)bits[i]=a[i];n=13;index_bit=0;io_ok=true;unsigned char id=0;
 assert(identity(0x68,&id)&&id==0x12&&index_bit==n);
 bits[0]=1;bits[1]=1;n=2;index_bit=0;io_ok=true;assert(!identity(0x69,&id));
 fail_io=1;io_ok=true;drive(0,true);assert(!io_ok);
 puts("通过：开漏不驱动高电平、ID位序、NACK拒绝、GPIO错误传播");return 0;
}
