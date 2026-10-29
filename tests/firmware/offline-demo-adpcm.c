/* 用真实 IMA WAV 数据与 FFmpeg PCM 结果逐样本比较，输出位于临时目录。 */
#include "demo_adpcm.h"
#include <stdio.h>
int main(int argc,char **argv){
 if(argc!=3)return 2;
 FILE *input=fopen(argv[1],"rb"),*output=fopen(argv[2],"wb");if(!input||!output)return 3;
 uint8_t block[256];int16_t pcm[505];size_t n;
 while((n=fread(block,1,sizeof(block),input))){int count=demo_adpcm_decode(block,n,pcm);if(count<0)return 4;if(fwrite(pcm,2,count,output)!=(size_t)count)return 5;}
 uint8_t invalid[256]={0};invalid[2]=89;if(demo_adpcm_decode(invalid,256,pcm)!=-1)return 6;
 fclose(input);return fclose(output)!=0;
}
