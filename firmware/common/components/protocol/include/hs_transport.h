#pragma once
#include "esp_err.h"
#include <stddef.h>
esp_err_t hs_transport_capture(const char *id, char *message, size_t size);
esp_err_t hs_transport_reply(const char *id);
esp_err_t hs_transport_heartbeat(void);
esp_err_t hs_transport_photo(const char *id, char *message, size_t size);
esp_err_t hs_transport_screen(int page, char *message, size_t size);
#include "esp_http_client.h"
esp_http_client_handle_t hs_transport_client(const char *route,int timeout_ms);
