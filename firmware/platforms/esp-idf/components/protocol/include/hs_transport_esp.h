#pragma once
#include "esp_http_client.h"
esp_http_client_handle_t hs_transport_client(const char *route,int timeout_ms);
