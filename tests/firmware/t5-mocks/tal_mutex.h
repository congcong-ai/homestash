#pragma once
#define OPRT_OK 0
typedef void *MUTEX_HANDLE;
int tal_mutex_create_init(MUTEX_HANDLE *handle);
int tal_mutex_lock(MUTEX_HANDLE handle);
int tal_mutex_unlock(MUTEX_HANDLE handle);
