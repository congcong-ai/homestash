#ifdef rename
#undef rename
#endif
#include "hs_outbox.h"
#include "wav.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/stat.h>
#include <errno.h>
/* 模拟未启用覆盖选项的真实 FAT rename，避免宿主 POSIX 行为掩盖缺陷。 */
int hs_test_fat_rename(const char *source,const char *destination) {
 if(!access(destination,F_OK)) {errno=EEXIST;return -1;}
 return rename(source,destination);
}
static const char *one="11111111-1111-4111-8111-111111111111";
static const char *two="22222222-2222-4222-8222-222222222222";
static void path(const char *id,const char *ext,char out[256]) {assert(!hs_outbox_path(id,ext,out,256));}
static void wav(const char *name,size_t bytes,int finalize) {
 FILE *f=fopen(name,"wb");assert(f);assert(!badge_wav_header(f,0));
 for(size_t i=0;i<bytes;i++) assert(fputc((i%127)+1,f)!=EOF);
 if(finalize) assert(!badge_wav_header(f,bytes));
 assert(!fclose(f));
}
static long length(const char *name) {struct stat st;assert(!stat(name,&st));return st.st_size;}
int main(void) {
 char file[256],ready[256],id[37],done[256];assert(!hs_outbox_init());
 assert(hs_outbox_recover(id)==HS_OUTBOX_EMPTY);
 assert(hs_outbox_path("../bad","wav",file,sizeof(file))<0);
 assert(hs_outbox_path(one,"../wav",file,sizeof(file))<0);
 assert(hs_outbox_path(one,"wav",file,2)<0);
 /* 录音中进程终止：只有初始头和已落盘 PCM，重启修正头，不更换 ID。 */
 path(one,"part",file);path(one,"wav",ready);wav(file,32000,0);
 assert(hs_outbox_recover(id)==0 && !strcmp(id,one));assert(access(file,F_OK));assert(length(ready)==32044);
 FILE *f=fopen(ready,"rb");unsigned char h[44];assert(fread(h,1,44,f)==44);fclose(f);
 assert(h[40]==0 && h[41]==125); // 32000 字节 PCM
 assert(hs_outbox_recover(id)==0 && !strcmp(id,one));assert(hs_outbox_commit(one)<0);
 assert(!hs_outbox_complete(one));assert(hs_outbox_recover(id)==HS_OUTBOX_EMPTY);
 /* 长度字段写完、尚未 rename 的中断仍恢复原 ID。 */
 wav(file,1024,1);assert(hs_outbox_recover(id)==0 && !strcmp(id,one));assert(!hs_outbox_complete(one));
 /* 已完成但尚未清理的录音不能再进入待上传列表。 */
 path(one,"done",done);wav(done,1024,1);assert(hs_outbox_recover(id)==HS_OUTBOX_EMPTY);remove(done);
 /* 无音频样本的空录音安全清理；损坏内容保留并阻止覆盖。 */
 wav(file,0,0);assert(hs_outbox_recover(id)==HS_OUTBOX_EMPTY);assert(access(file,F_OK));
 wav(file,3,0);assert(hs_outbox_recover(id)==HS_OUTBOX_ERROR);assert(length(file)==47);remove(file);
 wav(file,32,0);f=fopen(file,"rb+");assert(f);fputc('X',f);fclose(f);
 assert(hs_outbox_recover(id)==HS_OUTBOX_ERROR);assert(length(file)==76);remove(file);
 /* 老固件的 sidecar + WAV 迁移保持请求 ID，防止已提交录音二次入库。 */
 f=fopen(HS_DATA_ROOT "/pending.id","wb");assert(f);assert(fwrite(one,1,36,f)==36);fclose(f);
 wav(HS_DATA_ROOT "/pending.wav",4096,1);
 assert(hs_outbox_recover(id)==0 && !strcmp(id,one));assert(length(ready)==4140);assert(!hs_outbox_complete(one));
 /* 多个可恢复文件逐条完成，永远不覆盖其它录音。 */
 path(two,"part",file);wav(file,2048,0);path(one,"part",file);wav(file,1024,0);
 assert(hs_outbox_recover(id)==0 && !strcmp(id,one));assert(!hs_outbox_complete(id));
 assert(hs_outbox_recover(id)==0 && !strcmp(id,two));assert(!hs_outbox_complete(id));
 assert(hs_outbox_recover(id)==HS_OUTBOX_EMPTY);
 /* 第二条播报复用缓存路径：FAT rename 本身失败，缓存替换必须成功。 */
 const char *cache=HS_DATA_ROOT "/reply.wav", *temporary=HS_DATA_ROOT "/reply.wav.tmp";
 wav(cache,1024,1);wav(temporary,2048,1);
 assert(hs_test_fat_rename(temporary,cache)<0 && errno==EEXIST);
 assert(!hs_outbox_replace_cache(temporary,cache));assert(length(cache)==2092);
 wav(temporary,4096,1);assert(!hs_outbox_replace_cache(temporary,cache));assert(length(cache)==4140);
 /* 下载损坏时，已有缓存必须保留。 */
 wav(temporary,3,1);assert(hs_outbox_replace_cache(temporary,cache)<0);assert(length(cache)==4140);
 remove(temporary);remove(cache);
 puts("录音恢复、损坏保护、迁移、完成标记和 FAT 播报缓存回归检查通过");
 return 0;
}
