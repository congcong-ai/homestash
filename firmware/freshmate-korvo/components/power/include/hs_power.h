#pragma once
#include <stdbool.h>
#include "esp_err.h"
void hs_power_activity(bool active);
const char *hs_power_state(void);
esp_err_t hs_power_experiment(bool deep, unsigned seconds);
void hs_power_boot(void);
