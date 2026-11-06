#pragma once
#include "hs_error.h"
#include <stddef.h>
hs_err_t hs_transport_capture(const char *id, char *message, size_t size);
hs_err_t hs_transport_reply(const char *id);
hs_err_t hs_transport_heartbeat(void);
hs_err_t hs_transport_photo(const char *id, char *message, size_t size);
hs_err_t hs_transport_screen(int page, char *message, size_t size);
