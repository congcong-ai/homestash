#pragma once
#include "esp_err.h"
#include <stdbool.h>
typedef struct {
  bool active, applying;
  unsigned seconds_left;
  char name[30], proof[17], message[160], state[24], request_id[37];
} hs_provision_status_t;
esp_err_t hs_provision_init(void);
esp_err_t hs_provision_start(void);
void hs_provision_stop(void);
bool hs_provision_active(void);
/* 仅供LCD本地渲染及受限UART客户端；不得进入日志、HTTP或心跳。 */
void hs_provision_status(hs_provision_status_t *status);
