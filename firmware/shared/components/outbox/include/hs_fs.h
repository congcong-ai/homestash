#pragma once
/* 文件系统适配：返回 0 成功、1 不存在、-1
 * 其他错误；目录迭代同样区分结束和失败。 */
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#ifdef HS_PLATFORM_TUYA
typedef void *hs_file_t;
typedef void *hs_dir_t;
#else
#include <dirent.h>
#include <stdio.h>
typedef FILE *hs_file_t;
typedef DIR *hs_dir_t;
#endif
typedef struct {
  int64_t size;
  bool regular, directory;
} hs_file_info_t;
int hs_fs_info(const char *path, hs_file_info_t *info);
int hs_fs_mkdir(const char *path);
int hs_fs_remove(const char *path);
int hs_fs_rename(const char *source, const char *destination);
hs_file_t hs_fs_open(const char *path, const char *mode);
size_t hs_fs_read(void *buffer, size_t bytes, hs_file_t file);
size_t hs_fs_write(const void *buffer, size_t bytes, hs_file_t file);
int hs_fs_seek(hs_file_t file, int64_t offset);
int hs_fs_sync(hs_file_t file);
int hs_fs_close(hs_file_t file);
int hs_fs_getc(hs_file_t file);
hs_dir_t hs_fs_dir_open(const char *path);
int hs_fs_dir_next(hs_dir_t dir, char *name, size_t size);
void hs_fs_dir_close(hs_dir_t dir);
