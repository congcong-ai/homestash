#include "hs_outbox.h"
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#include <dirent.h>
#include <errno.h>
#define DIRECTORY HS_DATA_ROOT "/outbox"
#define MAX_BYTES 1920044
static bool valid_id(const char *id) {
  if (!id || strlen(id) != 36) return false;
  for (size_t i=0; i<36; i++) {
    if (i==8 || i==13 || i==18 || i==23) { if(id[i]!='-') return false; }
    else if (!((id[i]>='0' && id[i]<='9') || (id[i]>='a' && id[i]<='f'))) return false;
  }
  return true;
}
static int make_dir(const char *path) {
  if (mkdir(path,0770)==0) return 0;
  struct stat st;
  return errno==EEXIST && !stat(path,&st) && S_ISDIR(st.st_mode) ? 0 : -1;
}
int hs_outbox_init(void) { return make_dir(HS_DATA_ROOT) || make_dir(DIRECTORY) ? -1 : 0; }
int hs_outbox_path(const char *id,const char *ext,char *path,size_t size) {
  if(!valid_id(id) || (strcmp(ext,"part") && strcmp(ext,"wav") && strcmp(ext,"done"))) return -1;
  int n=snprintf(path,size,DIRECTORY "/%s.%s",id,ext);
  return n>0 && (size_t)n<size ? 0 : -1;
}
static void put32(unsigned char *p,uint32_t v) { for(unsigned i=0;i<4;i++) p[i]=(v>>(i*8))&255; }
static const unsigned char pcm_prefix[44]={
  'R','I','F','F',0,0,0,0,'W','A','V','E','f','m','t',' ',16,0,0,0,1,0,1,0,
  0x80,0x3e,0,0,0,0x7d,0,0,2,0,16,0,'d','a','t','a',0,0,0,0
};
static int check_wav(const char *path,bool repair) {
  struct stat st;
  if(stat(path,&st) || !S_ISREG(st.st_mode) || st.st_size<46 || st.st_size>MAX_BYTES || (st.st_size-44)%2) return -1;
  FILE *f=fopen(path,repair?"rb+":"rb");if(!f) return -1;
  unsigned char h[44],expected[44];int result=-1;
  if(fread(h,1,44,f)!=44) goto end;
  memcpy(expected,pcm_prefix,44);
  put32(expected+4,st.st_size-8);put32(expected+40,st.st_size-44);
  /* 只修正本固件录音的长度字段，绝不把任意数据当作 PCM。 */
  if(memcmp(h,expected,4) || memcmp(h+8,expected+8,32)) goto end;
  if(!repair) {result=memcmp(h,expected,44)?-1:0;goto end;}
  if(fseek(f,0,SEEK_SET) || fwrite(expected,1,44,f)!=44 || fflush(f) || fsync(fileno(f))) goto end;
  result=0;
end:
  if(fclose(f)) result=-1;
  return result;
}
int hs_outbox_commit(const char *id) {
  char part[HS_OUTBOX_PATH_SIZE],wav[HS_OUTBOX_PATH_SIZE];struct stat st;
  if(hs_outbox_path(id,"part",part,sizeof(part)) || hs_outbox_path(id,"wav",wav,sizeof(wav))) return -1;
  /* 不覆盖同一 ID 的既有录音，重试时必须发送原始字节。 */
  if(!stat(wav,&st)) return -1;
  if(check_wav(part,true)) return -1;
  return rename(part,wav)==0 ? 0 : -1;
}
static int migrate_legacy(void) {
  FILE *f=fopen(HS_DATA_ROOT "/pending.id","rb");
  if(!f) return errno==ENOENT?0:-1;
  char id[37]={0};size_t n=fread(id,1,36,f);int extra=fgetc(f);fclose(f);
  struct stat st;
  if(stat(HS_DATA_ROOT "/pending.wav",&st)) return errno==ENOENT?0:-1;
  if(n!=36 || extra!=EOF || !valid_id(id)) return -1;
  char wav[HS_OUTBOX_PATH_SIZE];
  if(hs_outbox_path(id,"wav",wav,sizeof(wav)) || check_wav(HS_DATA_ROOT "/pending.wav",false)) return -1;
  if(!stat(wav,&st)) return -1;
  if(rename(HS_DATA_ROOT "/pending.wav",wav)) return -1;
  /* ID 已编码在文件名里；旧 sidecar 删除失败不影响恢复。 */
  remove(HS_DATA_ROOT "/pending.id");return 0;
}
int hs_outbox_recover(char id[37]) {
  id[0]=0;
  if(hs_outbox_init() || migrate_legacy()) return -1;
  DIR *dir=opendir(DIRECTORY);if(!dir) return -1;
  struct dirent *entry;int result=HS_OUTBOX_EMPTY;
  while((entry=readdir(dir))) {
    size_t length=strlen(entry->d_name);
    bool partial=length==41 && !strcmp(entry->d_name+36,".part");
    bool ready=length==40 && !strcmp(entry->d_name+36,".wav");
    if(!partial && !ready) continue;
    char candidate[37]={0};memcpy(candidate,entry->d_name,36);
    if(!valid_id(candidate)) {result=-1;break;}
    char path[HS_OUTBOX_PATH_SIZE];struct stat st;
    if(hs_outbox_path(candidate,partial?"part":"wav",path,sizeof(path)) || stat(path,&st)) {result=-1;break;}
    /* 无 PCM 的空录音不是可提交的库存操作。 */
    if(partial && st.st_size==44) {
      unsigned char h[44],expected[44];memcpy(expected,pcm_prefix,44);put32(expected+4,36);
      FILE *empty=fopen(path,"rb");bool valid=empty && fread(h,1,44,empty)==44 && !memcmp(h,expected,44);
      if(empty) fclose(empty);
      if(!valid || remove(path)) {result=-1;break;}
      continue;
    }
    if((partial && hs_outbox_commit(candidate)) || (!partial && check_wav(path,false))) {result=-1;break;}
    if(!id[0] || strcmp(candidate,id)<0) memcpy(id,candidate,37);
    result=HS_OUTBOX_OK;
  }
  closedir(dir);
  /* 损坏文件阻止新录音；不删除、不重新编号、不偷偷丢掉旧数据。 */
  if(result<0) id[0]=0;
  return result;
}
int hs_outbox_complete(const char *id) {
  char wav[HS_OUTBOX_PATH_SIZE],done[HS_OUTBOX_PATH_SIZE];
  if(hs_outbox_path(id,"wav",wav,sizeof(wav)) || hs_outbox_path(id,"done",done,sizeof(done))) return -1;
  if(rename(wav,done)) return -1;
  /* .done 是已完成标记，清理失败或此处断电也不会再次提交。 */
  remove(done);return 0;
}
int hs_outbox_validate_wav(const char *path) { return check_wav(path,false); }
int hs_outbox_replace_cache(const char *temporary,const char *destination) {
  if(!strcmp(temporary,destination) || check_wav(temporary,false)) return -1;
  /* FAT 默认不覆盖目标。先完整校验临时文件，再清理可重新下载的缓存。 */
  if(remove(destination) && errno!=ENOENT) return -1;
  return rename(temporary,destination)==0 ? 0 : -1;
}
