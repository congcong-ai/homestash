#include "mock.h"
#include <assert.h>
#include <stdlib.h>
#include <string.h>
static void *allocations[16];static unsigned live;static size_t largest,written;static bool cancel,removed,closed;static int mode;static bool maintenance_cancel,address_changed;static unsigned address_revision;
void *tal_malloc(size_t n){assert(n<=4096);if(n>largest)largest=n;void*p=malloc(n);assert(live<16);allocations[live++]=p;return p;}
void tal_free(void*p){if(!p)return;unsigned i;for(i=0;i<live;i++)if(allocations[i]==p)break;assert(i<live);allocations[i]=allocations[--live];free(p);}
int tal_net_fd_zero(int*p){*p=0;return 0;}int tal_net_fd_set(int f,int*p){(void)f;*p=1;return 0;}
int tal_net_select(int f,int*a,int*b,void*c,uint32_t ms){(void)f;(void)a;(void)b;(void)c;assert(ms<=250);return 1;}
int tal_net_send(int f,const void*p,size_t n){(void)f;(void)p;return (int)n;}int tal_net_recv(int f,void*p,size_t n){(void)f;memset(p,0,n);return (int)n;}
int tal_net_gethostbyname(const char*h,unsigned*a){(void)h;*a=123;return 0;}int tal_net_socket_create(int p){(void)p;return 3;}int tal_net_set_block(int f,bool b){(void)f;assert(!b);return 0;}int tal_net_connect(int f,unsigned a,unsigned p){(void)f;assert(a==123&&p==3101);return mode==3?-1:0;}int tal_net_close(int f){assert(f==3);return 0;}int tal_net_get_errno(void){return 0;}
int64_t hs_time_us(void){return 1000;}unsigned hs_t5_core_address_revision(void){if(address_changed&&written>=4096){address_revision++;address_changed=false;}return address_revision;}
bool hs_t5_maintenance_cancelled(void){return maintenance_cancel;}
bool hs_t5_audio_cancelled(void){return cancel&&written>=4096;}
hs_file_t hs_fs_open(const char*p,const char*m){(void)p;assert(!strcmp(m,"wb"));return (void*)1;}size_t hs_fs_write(const void*p,size_t n,void*f){(void)f;(void)p;assert(n<=2048);written+=n;return n;}int hs_fs_sync(void*f){(void)f;return 0;}int hs_fs_close(void*f){(void)f;closed=true;return 0;}int hs_fs_remove(const char*p){(void)p;removed=true;return 0;}
HTTPStatus_t HTTPClient_InitializeRequestHeaders(HTTPRequestHeaders_t*h,const HTTPRequestInfo_t*i){(void)h;(void)i;return HTTPSuccess;}HTTPStatus_t HTTPClient_AddHeader(HTTPRequestHeaders_t*h,const char*k,size_t n,const char*v,size_t m){(void)h;(void)k;(void)n;(void)v;(void)m;return HTTPSuccess;}
HTTPStatus_t HTTPClient_Request(const TransportInterface_t*t,HTTPRequestHeaders_t*h,const uint8_t*b,size_t n,HTTPResponse_t*r,unsigned flags){(void)t;(void)h;(void)b;(void)n;r->pBuffer=tal_malloc(1024);if(mode==1){tal_free(r->pBuffer);return HTTPInsufficientMemory;}if(mode==2)return HTTPNetworkError;assert(flags==1);r->statusCode=200;r->contentLength=176684;r->pBody=tal_malloc(512);r->bodyLen=512;return HTTPSuccess;}
int HTTPClient_Recv(const TransportInterface_t*t,HTTPResponse_t*r,uint8_t*b,size_t n){if(r->pBody){assert(r->bodyLen<=n);int size=(int)r->bodyLen;memcpy(b,r->pBody,r->bodyLen);tal_free(r->pBody);r->pBody=NULL;r->bodyLen=0;return size;}return t->recv(t->pNetworkContext,b,n);}
http_client_status_t http_client_request(const http_client_request_t*r,http_client_response_t*s){(void)r;(void)s;return HTTP_CLIENT_SUCCESS;}
http_client_status_t hs_http_download(const http_client_request_t*,http_client_response_t*,const char*,size_t);
int main(void){http_client_request_t req={.host="local",.port=3101,.path="/captures/x/audio",.method="GET",.timeout_ms=120000};http_client_response_t response={0};
 assert(hs_http_download(&req,&response,"temp.wav",1920044)==HTTP_CLIENT_SUCCESS);assert(written==176684&&largest<=1024&&closed&&!removed&&live==0);
 written=0;cancel=true;closed=removed=false;assert(hs_http_download(&req,&response,"temp.wav",1920044)==HTTP_CLIENT_SEND_FAULT);assert(closed&&removed&&live==0);
 cancel=false;mode=1;assert(hs_http_download(&req,&response,"temp.wav",1920044)==HTTP_CLIENT_SEND_FAULT);assert(live==0);
 mode=2;assert(hs_http_download(&req,&response,"temp.wav",1920044)==HTTP_CLIENT_SEND_FAULT);assert(live==0);
 mode=0;written=0;closed=removed=false;address_changed=true;
 assert(hs_http_download(&req,&response,"temp.wav",1920044)==HTTP_CLIENT_SEND_FAULT);assert(closed&&removed&&live==0&&address_revision==1);
 mode=3;maintenance_cancel=true;req.path="/device/v1/yard/photos/x/status";
 assert(hs_http_download(&req,&response,"temp.wav",1920044)==HTTP_CLIENT_SEND_FAULT);assert(live==0);
 req.path="/device/v1/heartbeat";assert(hs_http_download(&req,&response,"temp.wav",1920044)==HTTP_CLIENT_SEND_FAULT);assert(live==0);
 mode=0;written=0;req.path="/captures/new/audio";
 assert(hs_http_download(&req,&response,"temp.wav",1920044)==HTTP_CLIENT_SUCCESS);assert(written==176684&&live==0);
 return 0;}
