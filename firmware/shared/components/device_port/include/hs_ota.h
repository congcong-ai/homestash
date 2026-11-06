#pragma once
#include "hs_error.h"
#include <stdbool.h>
typedef struct { int progress; bool available; char version[32]; char message[192]; } hs_ota_status_t;
void hs_ota_status(hs_ota_status_t *status);
hs_err_t hs_ota_check(void);
hs_err_t hs_ota_install(void);
void hs_ota_boot_health(bool healthy);
