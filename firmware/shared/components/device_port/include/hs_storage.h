#pragma once
#include "hs_error.h"
#include "hs_outbox.h"
#define HS_REPLY HS_DATA_ROOT "/reply.wav"
#define HS_SEASONAL_GREETING HS_DATA_ROOT "/seasonal-greeting.wav"
hs_err_t hs_storage_init(void);
