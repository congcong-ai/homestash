#include "../include/hs_sc101iot.h"
/* 协议事实参考 Espressif esp-video-components SC101IOT；未复制初始化表。
 * 7 位地址 0x68，0xf0 选页，0x31f7/0x31f8 为 PID。 */
hs_sc101iot_result_t hs_sc101iot_identify(const hs_sc101iot_bus_t *bus,
                                         uint16_t *pid) {
  if (!pid) return HS_SC101IOT_INVALID;
  *pid = 0;
  if (!bus || !bus->write || !bus->read) return HS_SC101IOT_INVALID;
  if (!bus->wiring_verified || !bus->power_verified ||
      !bus->clock_verified || !bus->reset_verified)
    return HS_SC101IOT_UNVERIFIED;
  uint8_t high = 0, low = 0;
  if (bus->write(bus->context, 0x68, 0xf0, 0x31) ||
      bus->read(bus->context, 0x68, 0xf7, &high) ||
      bus->read(bus->context, 0x68, 0xf8, &low)) return HS_SC101IOT_IO;
  *pid = ((uint16_t)high << 8) | low;
  return *pid == 0xda4a ? HS_SC101IOT_OK : HS_SC101IOT_WRONG_ID;
}
