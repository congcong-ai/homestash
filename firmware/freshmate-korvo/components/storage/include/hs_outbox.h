#pragma once
#include <stddef.h>
/* 只有已完整落盘的 PCM 样本可以恢复；不承诺恢复 SD 控制器内部缓存。 */
#define HS_OUTBOX_OK 0
#define HS_OUTBOX_EMPTY 1
#define HS_OUTBOX_ERROR -1
#define HS_OUTBOX_PATH_SIZE 256
#ifndef HS_DATA_ROOT
#define HS_DATA_ROOT "/sdcard/homestash"
#endif
int hs_outbox_init(void);
int hs_outbox_path(const char *id, const char *extension, char *path, size_t size);
int hs_outbox_recover(char id[37]);
int hs_outbox_commit(const char *id);
int hs_outbox_complete(const char *id);
/* 派生的播报缓存可重建；不用于替换原始录音。 */
int hs_outbox_replace_cache(const char *temporary, const char *destination);
int hs_outbox_validate_wav(const char *path);
