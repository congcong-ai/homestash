/* 配对密钥的派生HMAC验证局域网发现，广播不携带Token。 */
#include "hs_device_config.h"
#include "hs_runtime.h"
#include "tal_network.h"
#include "tal_hash.h"
#include "tal_wifi.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static volatile unsigned address_revision;
unsigned hs_t5_core_address_revision(void){return address_revision;}
static void hex(const unsigned char *bytes,size_t n,char *out){static const char digits[]="0123456789abcdef";for(size_t i=0;i<n;i++){out[i*2]=digits[bytes[i]>>4];out[i*2+1]=digits[bytes[i]&15];}out[n*2]=0;}
static bool sign(const unsigned char key[32],const char *body,char out[65]){
 tal_hash_mac_context_t h={0};unsigned char digest[32];
 if(tal_sha256_mac_create_init(&h))return false;
 bool ok=!tal_sha256_mac_starts(&h,key,32)&&!tal_sha256_mac_update(&h,(const uint8_t *)body,strlen(body))&&!tal_sha256_mac_finish(&h,digest);
 tal_sha256_mac_free(&h);if(ok)hex(digest,32,out);memset(digest,0,sizeof(digest));return ok;
}
void hs_t5_discover_core(void){
 hs_device_config_t c;hs_device_config_get(&c);
 /* 显式HTTPS地址保留，不自动降级。 */
 if(strncmp(c.core_url,"http://",7)||!c.token[0]||!c.device_id[0])return;
 unsigned char key[32]={0},random[16];char nonce[33],body[240],packet[320],mac[65];TKL_HASH_HANDLE hash=NULL;
 if(tal_sha256_create_init(&hash))goto clear;
 bool ok=!tal_sha256_starts_ret(hash,0)&&!tal_sha256_update_ret(hash,(const uint8_t *)c.token,strlen(c.token))&&!tal_sha256_finish_ret(hash,key);
 tal_sha256_free(hash);if(!ok||hs_random_bytes(random,sizeof(random)))goto clear;
 hex(random,sizeof(random),nonce);snprintf(body,sizeof(body),"HS_DISCOVER_V1|%s|%s",c.device_id,nonce);
 if(!sign(key,body,mac))goto clear;
 snprintf(packet,sizeof(packet),"%s|%s",body,mac);
 int fd=tal_net_socket_create(PROTOCOL_UDP);if(fd<0)goto clear;
 if(tal_net_set_block(fd,false)||tal_net_set_broadcast(fd))goto close;
 NW_IP_S ip_info={0};
 if(tal_wifi_get_ip(WF_STATION,&ip_info)!=OPRT_OK)goto close;
 TUYA_IP_ADDR_T broadcast=tal_net_str2addr(ip_info.ip)|~tal_net_str2addr(ip_info.mask);
 if(tal_net_send_to(fd,packet,strlen(packet),broadcast,3102)<0)goto close;
 int64_t until=hs_time_us()+1000000;
 while(hs_time_us()<until){
  TUYA_FD_SET_T set;tal_net_fd_zero(&set);tal_net_fd_set(fd,&set);
  if(tal_net_select(fd+1,&set,NULL,NULL,100)<=0)continue;
  TUYA_IP_ADDR_T peer;uint16_t port;
  int n=tal_net_recvfrom(fd,packet,sizeof(packet)-1,&peer,&port);if(n<=0||n>=(int)sizeof(packet))continue;packet[n]=0;
  char *last=strrchr(packet,'|');if(!last||strlen(last+1)!=64)continue;*last=0;
  if(!sign(key,packet,mac))continue;
  unsigned diff=0;for(unsigned i=0;i<64;i++)diff|=(unsigned char)mac[i]^(unsigned char)last[1+i];if(diff)continue;
  char prefix[160];snprintf(prefix,sizeof(prefix),"HS_CORE_V1|%s|%s|",c.device_id,nonce);
  if(strncmp(packet,prefix,strlen(prefix)))continue;
  char *ip=packet+strlen(prefix),*sep=strchr(ip,'|');if(!sep)continue;*sep=0;
  char *end;long server_port=strtol(sep+1,&end,10);if(*end||server_port<1||server_port>65535||strcmp(ip,tal_net_addr2str(peer)))continue;
  char url[100];snprintf(url,sizeof(url),"http://%s:%ld",ip,server_port);
  /* 防止发现等待期间覆盖用户刚手动保存的配置。 */
  hs_device_config_t latest;hs_device_config_get(&latest);
  if(latest.revision==c.revision&&strcmp(c.core_url,url)&&!hs_device_config_save(url,c.device_id,c.token)){address_revision++;HS_LOGI("discovery","verified Core address updated host=%s port=%ld",ip,server_port);}
  memset(&latest,0,sizeof(latest));break;
 }
close:tal_net_close(fd);
clear:memset(&c,0,sizeof(c));memset(key,0,sizeof(key));
}
