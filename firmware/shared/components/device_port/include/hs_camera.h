#pragma once
#include "hs_error.h"
#include <stddef.h>
/* 独立照片队列：失败或断电后沿用同一个采集 ID。 */
hs_err_t hs_camera_path(const char *id, char *path, size_t size);
hs_err_t hs_camera_capture(const char *id);
int hs_camera_recover(char id[37]);
hs_err_t hs_camera_complete(const char *id);
