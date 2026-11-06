#pragma once
typedef struct {int placeholder;} DIR;
typedef struct {char fname[256];} FILINFO;
typedef int FRESULT;
#define FR_OK 0
#define FR_DISK_ERR 1
#define FR_NO_FILE 4
#define FR_NO_PATH 5
FRESULT f_readdir(DIR *dir,FILINFO *info);
