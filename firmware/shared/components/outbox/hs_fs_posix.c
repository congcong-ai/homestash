#include "hs_fs.h"
#include <errno.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
int hs_fs_info(const char *path, hs_file_info_t *info) {
  struct stat st;
  if (stat(path, &st))
    return errno == ENOENT ? 1 : -1;
  *info = (hs_file_info_t){.size = st.st_size,
                           .regular = S_ISREG(st.st_mode),
                           .directory = S_ISDIR(st.st_mode)};
  return 0;
}
int hs_fs_mkdir(const char *path) {
  if (!mkdir(path, 0770))
    return 0;
  hs_file_info_t i;
  return errno == EEXIST && !hs_fs_info(path, &i) && i.directory ? 0 : -1;
}
int hs_fs_remove(const char *path) {
  return !remove(path) ? 0 : errno == ENOENT ? 1 : -1;
}
int hs_fs_rename(const char *a, const char *b) { return rename(a, b); }
hs_file_t hs_fs_open(const char *p, const char *m) { return fopen(p, m); }
size_t hs_fs_read(void *b, size_t n, hs_file_t f) { return fread(b, 1, n, f); }
size_t hs_fs_write(const void *b, size_t n, hs_file_t f) {
  return fwrite(b, 1, n, f);
}
int hs_fs_seek(hs_file_t f, int64_t off) { return fseek(f, off, SEEK_SET); }
int hs_fs_sync(hs_file_t f) { return fflush(f) || fsync(fileno(f)) ? -1 : 0; }
int hs_fs_close(hs_file_t f) { return fclose(f); }
int hs_fs_getc(hs_file_t f) { return fgetc(f); }
hs_dir_t hs_fs_dir_open(const char *p) { return opendir(p); }
int hs_fs_dir_next(hs_dir_t d, char *name, size_t size) {
  errno = 0;
  struct dirent *e = readdir(d);
  if (!e)
    return errno ? -1 : 1;
  if (strlen(e->d_name) >= size)
    return -1;
  strcpy(name, e->d_name);
  return 0;
}
void hs_fs_dir_close(hs_dir_t d) { closedir(d); }
