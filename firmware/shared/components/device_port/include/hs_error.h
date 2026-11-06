#pragma once
/* 应用层错误约定；ESP-IDF 适配器沿用原始数值，其他平台显式映射。 */
typedef int hs_err_t;
#define HS_OK 0
#define HS_FAIL -1
#define HS_ERR_NO_MEM 0x101
#define HS_ERR_INVALID_ARG 0x102
#define HS_ERR_INVALID_STATE 0x103
#define HS_ERR_NOT_SUPPORTED 0x106
#define HS_ERR_HTTP_CONNECT 0x7002
