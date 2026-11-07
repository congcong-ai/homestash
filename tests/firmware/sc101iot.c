#include "../../firmware/boards/tuya-t5-ai/include/hs_sc101iot.h"
#include <assert.h>
#include <stdio.h>
static int calls, failure, wrong;
static int write_reg(void *ctx, uint8_t addr, uint8_t reg, uint8_t value) {
  (void)ctx; assert(calls++ == 0); assert(addr == 0x68 && reg == 0xf0 && value == 0x31);
  return failure == calls;
}
static int read_reg(void *ctx, uint8_t addr, uint8_t reg, uint8_t *value) {
  (void)ctx; assert(addr == 0x68); assert(reg == (calls == 1 ? 0xf7 : 0xf8));
  *value = calls++ == 1 ? 0xda : (wrong ? 0 : 0x4a);
  return failure == calls;
}
int main(void) {
  uint16_t pid = 99;
  hs_sc101iot_bus_t bus = {.write=write_reg,.read=read_reg};
  assert(hs_sc101iot_identify(&bus,&pid)==HS_SC101IOT_UNVERIFIED && !calls && !pid);
  bus.wiring_verified=bus.power_verified=bus.clock_verified=bus.reset_verified=true;
  assert(hs_sc101iot_identify(&bus,&pid)==HS_SC101IOT_OK && pid==0xda4a);
  for (failure=1;failure<=3;failure++) {
    calls=0; pid=99;
    assert(hs_sc101iot_identify(&bus,&pid)==HS_SC101IOT_IO && !pid && calls==failure);
  }
  failure=0;calls=0;wrong=1;
  assert(hs_sc101iot_identify(&bus,&pid)==HS_SC101IOT_WRONG_ID);
  assert(hs_sc101iot_identify(NULL,&pid)==HS_SC101IOT_INVALID && !pid);
  puts("SC101IOT 主机协议测试通过；未访问硬件。");
}
