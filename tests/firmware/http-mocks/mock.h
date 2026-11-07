#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#define OPRT_OK 0
#define PROTOCOL_TCP 0
#define HTTP_SEND_DISABLE_RECV_BODY_FLAG 1
#define HS_LOGI(...) ((void)0)
typedef enum{HTTP_CLIENT_SUCCESS,HTTP_CLIENT_SERIALIZE_FAULT,HTTP_CLIENT_SEND_FAULT,HTTP_CLIENT_MALLOC_FAULT}http_client_status_t;
typedef enum{HTTPSuccess,HTTPNetworkError,HTTPInsufficientMemory}HTTPStatus_t;
typedef void NetworkContext_t;
typedef unsigned TUYA_IP_ADDR_T;
typedef int TUYA_FD_SET_T;
typedef void *hs_file_t;
typedef struct{const char *key,*value;}http_client_header_t;
typedef struct{const char *host;uint16_t port;const char *path;const uint8_t *cacert;size_t cacert_len;const char *method;http_client_header_t *headers;uint8_t headers_count;const uint8_t *body;size_t body_length;uint32_t timeout_ms;}http_client_request_t;
typedef struct{uint8_t *buffer;size_t buffer_length;const uint8_t *headers;size_t headers_length;const uint8_t *body;size_t body_length;uint16_t status_code;}http_client_response_t;
typedef struct{uint8_t *pBuffer;size_t bufferLen;}HTTPRequestHeaders_t;
typedef struct{const char *pMethod;size_t methodLen;const char *pHost;size_t hostLen;const char *pPath;size_t pathLen;}HTTPRequestInfo_t;
typedef struct{uint8_t *pBuffer,*pBody,*pHeaders;size_t bufferLen,bodyLen,headersLen,contentLength;unsigned statusCode;}HTTPResponse_t;
typedef struct{NetworkContext_t *pNetworkContext;int32_t(*send)(NetworkContext_t *,const void *,size_t);int32_t(*recv)(NetworkContext_t *,void *,size_t);}TransportInterface_t;
void *tal_malloc(size_t);void tal_free(void *);
int tal_net_fd_zero(TUYA_FD_SET_T*);int tal_net_fd_set(int,TUYA_FD_SET_T*);int tal_net_select(int,TUYA_FD_SET_T*,TUYA_FD_SET_T*,void*,uint32_t);
int tal_net_send(int,const void*,size_t);int tal_net_recv(int,void*,size_t);int tal_net_gethostbyname(const char*,TUYA_IP_ADDR_T*);int tal_net_socket_create(int);int tal_net_set_block(int,bool);int tal_net_connect(int,unsigned,unsigned);int tal_net_close(int);int tal_net_get_errno(void);
int64_t hs_time_us(void);bool hs_t5_audio_cancelled(void);
hs_file_t hs_fs_open(const char*,const char*);size_t hs_fs_write(const void*,size_t,hs_file_t);int hs_fs_sync(hs_file_t);int hs_fs_close(hs_file_t);int hs_fs_remove(const char*);
HTTPStatus_t HTTPClient_InitializeRequestHeaders(HTTPRequestHeaders_t*,const HTTPRequestInfo_t*);HTTPStatus_t HTTPClient_AddHeader(HTTPRequestHeaders_t*,const char*,size_t,const char*,size_t);
HTTPStatus_t HTTPClient_Request(const TransportInterface_t*,HTTPRequestHeaders_t*,const uint8_t*,size_t,HTTPResponse_t*,unsigned);int HTTPClient_Recv(const TransportInterface_t*,HTTPResponse_t*,uint8_t*,size_t);
http_client_status_t http_client_request(const http_client_request_t*,http_client_response_t*);
