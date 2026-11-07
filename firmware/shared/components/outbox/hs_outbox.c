#include "hs_outbox.h"
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include "hs_fs.h"
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
int hs_outbox_init(void) { return hs_fs_mkdir(HS_DATA_ROOT) || hs_fs_mkdir(DIRECTORY) ? -1 : 0; }
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
  hs_file_info_t st;
  if(hs_fs_info(path,&st) || !st.regular || st.size<46 || st.size>MAX_BYTES || (st.size-44)%2) return -1;
  hs_file_t f=hs_fs_open(path,repair?"rb+":"rb");if(!f) return -1;
  unsigned char h[44],expected[44];int result=-1;
  if(hs_fs_read(h,44,f)!=44) goto end;
  memcpy(expected,pcm_prefix,44);
  put32(expected+4,st.size-8);put32(expected+40,st.size-44);
  /* 只修正本固件录音的长度字段，绝不把任意数据当作 PCM。 */
  if(memcmp(h,expected,4) || memcmp(h+8,expected+8,32)) goto end;
  if(!repair) {result=memcmp(h,expected,44)?-1:0;goto end;}
  if(hs_fs_seek(f,0) || hs_fs_write(expected,44,f)!=44 || hs_fs_sync(f)) goto end;
  result=0;
end:
  if(hs_fs_close(f)) result=-1;
  return result;
}
int hs_outbox_commit(const char *id) {
  char part[HS_OUTBOX_PATH_SIZE],wav[HS_OUTBOX_PATH_SIZE];hs_file_info_t st;
  if(hs_outbox_path(id,"part",part,sizeof(part)) || hs_outbox_path(id,"wav",wav,sizeof(wav))) return -1;
  /* 不覆盖同一 ID 的既有录音，重试时必须发送原始字节。 */
  if(!hs_fs_info(wav,&st)) return -1;
  if(check_wav(part,true)) return -1;
  return hs_fs_rename(part,wav)==0 ? 0 : -1;
}
static int migrate_legacy(void) {
  hs_file_t f=hs_fs_open(HS_DATA_ROOT "/pending.id","rb");
  if(!f) {hs_file_info_t missing;return hs_fs_info(HS_DATA_ROOT "/pending.id",&missing)==1?0:-1;}
  char id[37]={0};size_t n=hs_fs_read(id,36,f);int extra=hs_fs_getc(f);hs_fs_close(f);
  hs_file_info_t st;
  int legacy=hs_fs_info(HS_DATA_ROOT "/pending.wav",&st);
  if(legacy) return legacy==1?0:-1;
  if(n!=36 || extra!=EOF || !valid_id(id)) return -1;
  char wav[HS_OUTBOX_PATH_SIZE];
  if(hs_outbox_path(id,"wav",wav,sizeof(wav)) || check_wav(HS_DATA_ROOT "/pending.wav",false)) return -1;
  if(!hs_fs_info(wav,&st)) return -1;
  if(hs_fs_rename(HS_DATA_ROOT "/pending.wav",wav)) return -1;
  /* ID 已编码在文件名里；旧 sidecar 删除失败不影响恢复。 */
  hs_fs_remove(HS_DATA_ROOT "/pending.id");return 0;
}
int hs_outbox_recover(char id[37]) {
  id[0]=0;
  if(hs_outbox_init() || migrate_legacy()) return -1;
  hs_dir_t dir=hs_fs_dir_open(DIRECTORY);if(!dir) return -1;
  char entry[256];int result=HS_OUTBOX_EMPTY,next;
  while((next=hs_fs_dir_next(dir,entry,sizeof(entry)))==0) {
    size_t length=strlen(entry);
    bool partial=length==41 && !strcmp(entry+36,".part");
    bool ready=length==40 && !strcmp(entry+36,".wav");
    if(!partial && !ready) continue;
    char candidate[37]={0};memcpy(candidate,entry,36);
    if(!valid_id(candidate)) {result=-1;break;}
    char path[HS_OUTBOX_PATH_SIZE];hs_file_info_t st;
    if(hs_outbox_path(candidate,partial?"part":"wav",path,sizeof(path)) || hs_fs_info(path,&st)) {result=-1;break;}
    /* 无 PCM 的空录音不是可提交的库存操作。 */
    if(partial && st.size==44) {
      unsigned char h[44],expected[44];memcpy(expected,pcm_prefix,44);put32(expected+4,36);
      hs_file_t empty=hs_fs_open(path,"rb");bool valid=empty && hs_fs_read(h,44,empty)==44 && !memcmp(h,expected,44);
      if(empty) hs_fs_close(empty);
      if(!valid || hs_fs_remove(path)) {result=-1;break;}
      continue;
    }
    if((partial && hs_outbox_commit(candidate)) || (!partial && check_wav(path,false))) {result=-1;break;}
    if(!id[0] || strcmp(candidate,id)<0) memcpy(id,candidate,37);
    result=HS_OUTBOX_OK;
  }
  if(next<0)result=-1;
  hs_fs_dir_close(dir);
  /* 损坏文件阻止新录音；不删除、不重新编号、不偷偷丢掉旧数据。 */
  if(result<0) id[0]=0;
  return result;
}
int hs_outbox_complete(const char *id) {
  char wav[HS_OUTBOX_PATH_SIZE],done[HS_OUTBOX_PATH_SIZE];
  if(hs_outbox_path(id,"wav",wav,sizeof(wav)) || hs_outbox_path(id,"done",done,sizeof(done))) return -1;
  if(hs_fs_rename(wav,done)) return -1;
  /* .done 是已完成标记，清理失败或此处断电也不会再次提交。 */
  hs_fs_remove(done);return 0;
}
int hs_outbox_validate_wav(const char *path) { return check_wav(path,false); }
int hs_outbox_replace_cache(const char *temporary,const char *destination) {
  if(!strcmp(temporary,destination) || check_wav(temporary,false)) return -1;
  /* FAT 默认不覆盖目标。先完整校验临时文件，再清理可重新下载的缓存。 */
  if(hs_fs_remove(destination)<0) return -1;
  return hs_fs_rename(temporary,destination)==0 ? 0 : -1;
}

/* 独立回忆队列。每段最多1.92MB，总量64MB；满时拒绝新增，不覆盖旧录音。 */
#define MEMDIR HS_DATA_ROOT "/recordings"
int hs_recording_archive(const char *id){
 if(!valid_id(id)||hs_fs_mkdir(MEMDIR))return -1;
 char source[HS_OUTBOX_PATH_SIZE],target[160],part[160];hs_file_info_t st;
 if(hs_outbox_path(id,"wav",source,sizeof(source)))return -1;
 snprintf(target,sizeof(target),MEMDIR "/%s.wav",id);if(!hs_fs_info(target,&st))return 0;
 hs_dir_t dir=hs_fs_dir_open(MEMDIR);if(!dir)return -1;char entry[256],path[320];int64_t total=0;unsigned count=0;int next;
 while((next=hs_fs_dir_next(dir,entry,sizeof(entry)))==0){snprintf(path,sizeof(path),MEMDIR "/%s",entry);if(!hs_fs_info(path,&st)&&st.regular){total+=st.size;count++;}}
 hs_fs_dir_close(dir);if(next<0||count>=1000||hs_fs_info(source,&st)||total+st.size>64*1024*1024)return -1;
 /* 文件在同一SD卷上原子移交，无需复制PCM或阻塞首个回复。 */
 (void)part;
 return hs_fs_rename(source,target);

}
static int media_next(const char *extension,char id[37],char path[160]){
 id[0]=0;hs_fs_mkdir(MEMDIR);hs_dir_t dir=hs_fs_dir_open(MEMDIR);if(!dir)return -1;char entry[256];int n;
 while((n=hs_fs_dir_next(dir,entry,sizeof(entry)))==0){if(strlen(entry)!=40||strcmp(entry+36,extension))continue;memcpy(id,entry,36);id[36]=0;if(!valid_id(id)){id[0]=0;continue;}char sent[160];hs_file_info_t st;snprintf(sent,sizeof(sent),MEMDIR "/%s.sent",id);if(!hs_fs_info(sent,&st)){id[0]=0;continue;}snprintf(path,160,MEMDIR "/%s%s",id,extension);break;}
 hs_fs_dir_close(dir);return id[0]?0:1;
}
int hs_recording_sent(const char *id){if(!valid_id(id))return -1;char path[160];snprintf(path,sizeof(path),MEMDIR "/%s.sent",id);hs_file_t f=hs_fs_open(path,"wb");if(!f)return -1;int e=hs_fs_sync(f);return hs_fs_close(f)||e?-1:0;}

int hs_recording_next(char id[37],char path[160]){return media_next(".wav",id,path);}
int hs_photo_next(char id[37],char path[160]){return media_next(".jpg",id,path);}
int hs_photo_archive(const char *id,const void *bytes,size_t size){
 if(!valid_id(id)||!bytes||size<4||size>350000||hs_fs_mkdir(MEMDIR))return -1;
 hs_dir_t dir=hs_fs_dir_open(MEMDIR);if(!dir)return -1;char entry[256],scan[320];int64_t total=0;unsigned count=0;hs_file_info_t st;int next;
 while((next=hs_fs_dir_next(dir,entry,sizeof(entry)))==0){snprintf(scan,sizeof(scan),MEMDIR "/%s",entry);if(!hs_fs_info(scan,&st)&&st.regular){total+=st.size;count++;}}
 hs_fs_dir_close(dir);if(next<0||count>=1000||total+(int64_t)size>64*1024*1024)return -1;
 char path[160],part[160];snprintf(path,sizeof(path),MEMDIR "/%s.jpg",id);snprintf(part,sizeof(part),MEMDIR "/%s.part",id);if(!hs_fs_info(path,&st))return -1;
 hs_file_t f=hs_fs_open(part,"wb");if(!f)return -1;bool ok=hs_fs_write(bytes,size,f)==size;if(hs_fs_sync(f))ok=false;if(hs_fs_close(f))ok=false;return ok?hs_fs_rename(part,path):-1;
}
