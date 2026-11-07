/* 独立Wi-Fi不使用netmgr；复用锁定SDK的coreHTTP解析器，直接通过TAL socket连接。
 * HTTPS继续使用SDK证书校验路径。本文件不记录任何HTTP头或正文。 */
#include "http_client_interface.h"
#include "core_http_client.h"
#include "tal_network.h"
#include "tal_system.h"
#include "hs_runtime.h"
#include "hs_fs.h"
#include <string.h>
extern bool hs_t5_audio_cancelled(void);
extern bool hs_t5_maintenance_cancelled(void);
extern unsigned hs_t5_core_address_revision(void);
typedef struct {int fd;uint32_t timeout;int64_t deadline;bool cancelable;bool maintenance;unsigned address_revision;} hs_http_socket_t;
static int ready(hs_http_socket_t *s,bool write){
 for(;;){
  int64_t left=s->deadline-hs_time_us();
  if(s->address_revision!=hs_t5_core_address_revision()||left<=0||(s->cancelable&&hs_t5_audio_cancelled())||(s->maintenance&&hs_t5_maintenance_cancelled()))return -1;
  TUYA_FD_SET_T set;tal_net_fd_zero(&set);tal_net_fd_set(s->fd,&set);
  uint32_t ms=(uint32_t)(left/1000);if(ms>250)ms=250;
  int result=tal_net_select(s->fd+1,write?NULL:&set,write?&set:NULL,NULL,ms);
  if(result!=0)return result;
 }

}
static int32_t send_bytes(NetworkContext_t *context,const void *data,size_t size){
 hs_http_socket_t *s=(hs_http_socket_t *)context;
 if(ready(s,true)<=0)return -1;
 return tal_net_send(s->fd,data,size);
}
static int32_t receive_bytes(NetworkContext_t *context,void *data,size_t size){
 hs_http_socket_t *s=(hs_http_socket_t *)context;
 if(ready(s,false)<=0)return -1;
 return tal_net_recv(s->fd,data,size);
}
static http_client_status_t perform(const http_client_request_t *request,http_client_response_t *response,const char *destination,size_t limit){
 if(request->cacert)return destination?HTTP_CLIENT_SEND_FAULT:http_client_request(request,response);
 hs_http_socket_t socket={.address_revision=hs_t5_core_address_revision(),.fd=-1,.timeout=request->timeout_ms,.deadline=hs_time_us()+(int64_t)request->timeout_ms*1000,.cancelable=strstr(request->path,"/captures/")!=NULL || (strstr(request->path,"/yard/photos/") && strstr(request->path,"/upload"))};
 socket.maintenance=strstr(request->path,"/heartbeat")||strstr(request->path,"/yard/settings")||strstr(request->path,"/yard/recordings/")||strstr(request->path,"/yard/photo-archive/")||strstr(request->path,"/status");
 TUYA_IP_ADDR_T address;
 if(tal_net_gethostbyname(request->host,&address)!=OPRT_OK)return HTTP_CLIENT_SEND_FAULT;
 socket.fd=tal_net_socket_create(PROTOCOL_TCP);
 if(socket.fd<0)return HTTP_CLIENT_SEND_FAULT;
 http_client_status_t result=HTTP_CLIENT_SEND_FAULT;
 HTTPRequestHeaders_t headers={0};HTTPResponse_t reply={0};
 if(tal_net_set_block(socket.fd,false)!=OPRT_OK)goto cleanup;
 int connected=tal_net_connect(socket.fd,address,request->port);
 if(connected<0&&ready(&socket,true)<=0){HS_LOGI("transport","TCP connect timeout errno=%d",tal_net_get_errno());goto cleanup;}
 HTTPRequestInfo_t info={.pMethod=request->method,.methodLen=strlen(request->method),.pHost=request->host,.hostLen=strlen(request->host),.pPath=request->path,.pathLen=strlen(request->path)};
 headers.bufferLen=1024;headers.pBuffer=tal_malloc(headers.bufferLen);
 if(!headers.pBuffer){result=HTTP_CLIENT_MALLOC_FAULT;goto cleanup;}
 HTTPStatus_t status=HTTPClient_InitializeRequestHeaders(&headers,&info);
 for(unsigned i=0;status==HTTPSuccess&&i<request->headers_count;i++)status=HTTPClient_AddHeader(&headers,request->headers[i].key,strlen(request->headers[i].key),request->headers[i].value,strlen(request->headers[i].value));
 if(status!=HTTPSuccess){result=HTTP_CLIENT_SERIALIZE_FAULT;goto cleanup;}
 TransportInterface_t transport={.pNetworkContext=(NetworkContext_t *)&socket,.send=send_bytes,.recv=receive_bytes};
 status=HTTPClient_Request(&transport,&headers,request->body,request->body_length,&reply,destination?HTTP_SEND_DISABLE_RECV_BODY_FLAG:0);
 HS_LOGI("transport","direct HTTP result=%d",(int)status);
 if(status!=HTTPSuccess){
   /* 锁定SDK的__exit已释放缓冲但未清空指针；NetworkError分支则直接返回未释放。 */
   if(status==HTTPNetworkError){if(reply.pBuffer){tal_free(reply.pBuffer);}
   if(reply.pBody)tal_free((void *)reply.pBody);}
   goto cleanup;
 }
 response->status_code=reply.statusCode;
 if(destination){
   bool ok=reply.statusCode==200&&reply.contentLength>=46&&reply.contentLength<=limit&&reply.bodyLen<=2048;
   hs_file_t file=ok?hs_fs_open(destination,"wb"):NULL;size_t received=0;unsigned char chunk[2048];
   while(file&&ok&&received<reply.contentLength){
     size_t wanted=reply.contentLength-received;if(wanted>sizeof(chunk))wanted=sizeof(chunk);
     int count=HTTPClient_Recv(&transport,&reply,chunk,wanted);
     if(count<=0||(size_t)count>wanted||hs_t5_audio_cancelled()||hs_fs_write(chunk,(size_t)count,file)!=(size_t)count){ok=false;break;}
     received+=(size_t)count;
   }
   if(file){if(hs_fs_sync(file))ok=false;if(hs_fs_close(file))ok=false;}else ok=false;
   if(reply.pBuffer){tal_free(reply.pBuffer);}
   if(reply.pBody)tal_free((void *)reply.pBody);
   HS_LOGI("transport","audio download bytes=%u expected=%u ok=%d",(unsigned)received,(unsigned)reply.contentLength,ok);
   if(!ok){hs_fs_remove(destination);goto cleanup;}
   result=HTTP_CLIENT_SUCCESS;
 }else{
   response->buffer=reply.pBuffer;response->buffer_length=reply.bufferLen;
   response->headers=reply.pHeaders;response->headers_length=reply.headersLen;response->body=reply.pBody;response->body_length=reply.bodyLen;
   result=HTTP_CLIENT_SUCCESS;
 }

cleanup:
 if(headers.pBuffer){memset(headers.pBuffer,0,headers.bufferLen);tal_free(headers.pBuffer);}
 tal_net_close(socket.fd);return result;
}

http_client_status_t hs_http_request(const http_client_request_t *r,http_client_response_t *s){return perform(r,s,NULL,0);}
http_client_status_t hs_http_download(const http_client_request_t *r,http_client_response_t *s,const char *path,size_t limit){return perform(r,s,path,limit);}
