#pragma once
#include "esp_err.h"
#include <stdbool.h>
esp_err_t hs_settings_ui_init(void (*action)(int));
void hs_settings_ui_busy(bool busy);
