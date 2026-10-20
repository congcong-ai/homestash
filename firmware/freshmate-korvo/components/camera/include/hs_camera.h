#pragma once
#include "esp_err.h"
#include <stddef.h>
/* 独立照片队列：失败或断电后沿用同一个采集 ID。 */
esp_err_t hs_camera_path(const char *id, char *path, size_t size);
esp_err_t hs_camera_capture(const char *id);
int hs_camera_recover(char id[37]);
esp_err_t hs_camera_complete(const char *id);
