#pragma once
#include "esp_err.h"
#include <stdint.h>
typedef struct { char core_url[351]; char device_id[65]; char token[129]; uint32_t revision; } hs_device_config_t;
esp_err_t hs_device_config_init(void);
void hs_device_config_get(hs_device_config_t *config);
esp_err_t hs_device_config_save(const char *url,const char *device_id,const char *token);
