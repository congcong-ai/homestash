#pragma once
#include "hs_error.h"
#include <stdint.h>
typedef struct { char core_url[351]; char device_id[65]; char token[129]; uint32_t revision; } hs_device_config_t;
hs_err_t hs_device_config_init(void);
void hs_device_config_get(hs_device_config_t *config);
hs_err_t hs_device_config_save(const char *url,const char *device_id,const char *token);
hs_err_t hs_device_config_validate(const char *url,const char *device_id,const char *token);
