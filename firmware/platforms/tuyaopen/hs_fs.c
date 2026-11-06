#include "hs_fs.h"
#include "bk_file_utils.h"
#include "bk_posix.h"
/* 避免 FatFs DIR 与 VFS DIR 同名；结构和调用仍使用原厂定义。 */
#define DIR HS_T5_FAT_DIR
#include "ff.h"
#undef DIR
#include <errno.h>
#include <stdio.h>
#include <string.h>
/* T5 VFS 使用文件描述符；不依赖 newlib 的 FILE 与 SDK VFS 互通。 */
static int descriptor(hs_file_t file) { return (int)(intptr_t)file - 1; }
int hs_fs_info(const char *path, hs_file_info_t *info) {
  struct stat st;
  errno = 0;
  int r = stat(path, &st);
  if (r)
    return r == FR_NO_FILE || r == FR_NO_PATH || errno == ENOENT ||
                   errno == -ENOENT || r == -ENOENT
               ? 1
               : -1;
  *info = (hs_file_info_t){.size = st.st_size,
                           .regular = S_ISREG(st.st_mode),
                           .directory = S_ISDIR(st.st_mode)};
  return 0;
}
int hs_fs_mkdir(const char *path) {
  if (!mkdir(path, 0770))
    return 0;
  hs_file_info_t i;
  return !hs_fs_info(path, &i) && i.directory ? 0 : -1;
}
int hs_fs_remove(const char *path) {
  hs_file_info_t i;
  int r = hs_fs_info(path, &i);
  return r ? r : unlink(path) == 0 ? 0 : -1;
}
int hs_fs_rename(const char *a, const char *b) {
  return rename(a, b) == 0 ? 0 : -1;
}
hs_file_t hs_fs_open(const char *p, const char *m) {
  int flags = !strcmp(m, "rb")    ? O_RDONLY
              : !strcmp(m, "rb+") ? O_RDWR
              : !strcmp(m, "wb")  ? O_WRONLY | O_CREAT | O_TRUNC
                                  : -1;
  if (flags < 0)
    return NULL;
  int fd = open(p, flags);
  return fd < 0 ? NULL : (void *)(intptr_t)(fd + 1);
}
size_t hs_fs_read(void *b, size_t n, hs_file_t f) {
  ssize_t r = read(descriptor(f), b, n);
  return r < 0 ? 0 : (size_t)r;
}
size_t hs_fs_write(const void *b, size_t n, hs_file_t f) {
  ssize_t r = write(descriptor(f), b, n);
  return r < 0 ? 0 : (size_t)r;
}
int hs_fs_seek(hs_file_t f, int64_t off) {
  return lseek(descriptor(f), off, SEEK_SET) < 0 ? -1 : 0;
}
int hs_fs_sync(hs_file_t f) { return fsync(descriptor(f)); }
int hs_fs_close(hs_file_t f) { return close(descriptor(f)); }
int hs_fs_getc(hs_file_t f) {
  unsigned char c;
  return read(descriptor(f), &c, 1) == 1 ? c : -1;
}
hs_dir_t hs_fs_dir_open(const char *p) { return opendir(p); }
int hs_fs_dir_next(hs_dir_t d, char *name, size_t size) {
  /* 锁定版 VFS 的 readdir 把 FatFs I/O 错误和正常结束都转为 NULL。
   * 这里保留 VFS 的目录句柄、锁与挂载，直接检查其 FatFs 返回码。 */
  if (!d || bk_vfs_lock() != 0)
    return -1;
  FILINFO info = {0};
  FRESULT status = f_readdir((HS_T5_FAT_DIR *)((bk_dir *)d)->dir_data, &info);
  bk_vfs_unlock();
  if (status != FR_OK)
    return -1;
  if (!info.fname[0])
    return 1;
  if (strlen(info.fname) >= size)
    return -1;
  strcpy(name, info.fname);
  return 0;
}
void hs_fs_dir_close(hs_dir_t d) { closedir(d); }
