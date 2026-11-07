#pragma once
#include <stdio.h>
#define HS_LOGI(tag,...) do { (void)(tag); printf(__VA_ARGS__); puts(""); } while(0)
#define HS_LOGW HS_LOGI
