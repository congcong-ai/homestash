#pragma once
#include <stdbool.h>
#include <stdint.h>
/* 仅身份控制适配。调用者独占 SCCB 总线；不配置 GPIO、不启动视频。 */
typedef struct {
  void *context;
  int (*write)(void *, uint8_t address, uint8_t reg, uint8_t value);
  int (*read)(void *, uint8_t address, uint8_t reg, uint8_t *value);
  bool wiring_verified;
  bool power_verified;
  bool clock_verified;
  bool reset_verified;
} hs_sc101iot_bus_t;
typedef enum {
  HS_SC101IOT_OK = 0,
  HS_SC101IOT_INVALID = -1,
  HS_SC101IOT_UNVERIFIED = -2,
  HS_SC101IOT_IO = -3,
  HS_SC101IOT_WRONG_ID = -4
} hs_sc101iot_result_t;
/* 成功也只表示读到 PID，不表示驱动、图像或 JPEG 可用。 */
hs_sc101iot_result_t hs_sc101iot_identify(const hs_sc101iot_bus_t *bus,
                                         uint16_t *pid);
