#pragma once
#include "esp_err.h"
#include "hs_outbox.h"
#define HS_REPLY HS_DATA_ROOT "/reply.wav"
esp_err_t hs_storage_init(void);
