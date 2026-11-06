#include "hs_fs.h"
#include "bk_posix.h"
#include "bk_file_utils.h"
#define DIR HS_T5_FAT_DIR
#include "ff.h"
#undef DIR
#include <assert.h>
#include <errno.h>
#include <string.h>
static int stat_result,read_result;
static const char *entry="";
int hs_test_stat(const char *p,struct stat *out){(void)p;memset(out,0,sizeof(*out));out->st_mode=S_IFREG;out->st_size=123;return stat_result;}
int bk_vfs_lock(void){return 0;}
void bk_vfs_unlock(void){}
FRESULT f_readdir(HS_T5_FAT_DIR *d,FILINFO *out){(void)d;strcpy(out->fname,entry);return read_result;}
int main(void){
 hs_file_info_t info;stat_result=FR_NO_FILE;assert(hs_fs_info("missing",&info)==1);
 stat_result=FR_NO_PATH;assert(hs_fs_info("missing/path",&info)==1);
 stat_result=FR_DISK_ERR;assert(hs_fs_info("broken",&info)==-1);
 stat_result=0;assert(hs_fs_info("present",&info)==0&&info.regular&&info.size==123);
 bk_dir dir={0};char name[256];entry="";read_result=FR_OK;assert(hs_fs_dir_next(&dir,name,sizeof(name))==1);
 read_result=FR_DISK_ERR;assert(hs_fs_dir_next(&dir,name,sizeof(name))==-1);
 read_result=FR_OK;entry="recording.wav";assert(hs_fs_dir_next(&dir,name,sizeof(name))==0&&!strcmp(name,entry));
 assert(hs_fs_dir_next(&dir,name,3)==-1);
 puts("通过：FatFs 文件缺失、磁盘错误、目录结束及目录错误分别处理。");return 0;
}
