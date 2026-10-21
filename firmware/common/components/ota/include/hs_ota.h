#pragma once
#include "esp_err.h"
#include <stdbool.h>
typedef struct { int progress; bool available; char version[32]; char message[192]; } hs_ota_status_t;
void hs_ota_status(hs_ota_status_t *status);
esp_err_t hs_ota_check(void);
esp_err_t hs_ota_install(void);
void hs_ota_boot_health(bool healthy);
