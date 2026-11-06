#pragma once
#include <stdbool.h>
/* 重复请求必须幂等；仅显式重连才能重启已工作的网络。 */
static inline bool hs_wifi_control_needed(bool paused,int kind){return kind==6 || (kind==4&&!paused) || (kind==5&&paused);}
static inline bool hs_wifi_connected_event(unsigned bits,unsigned connected){return (bits&connected)!=0;}
