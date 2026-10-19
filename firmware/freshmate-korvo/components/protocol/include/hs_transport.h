#pragma once
#include "esp_err.h"
#include <stddef.h>
esp_err_t hs_transport_capture(const char *id, char *message, size_t size);
esp_err_t hs_transport_reply(const char *id);
esp_err_t hs_transport_heartbeat(void);
