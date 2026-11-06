#pragma once
#include "hs_error.h"
#include <stdbool.h>
hs_err_t hs_settings_ui_init(void (*action)(int));
void hs_settings_ui_busy(bool busy);

bool hs_settings_ui_active(void);

void hs_settings_ui_show(bool show);
