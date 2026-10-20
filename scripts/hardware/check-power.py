#!/usr/bin/env python3
"""编译真实电源状态代码，验证实验时长边界、休眠状态保护和失败后的状态恢复；不代表真机休眠。"""
from pathlib import Path
import subprocess
import tempfile
root = Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory(prefix='homestash-power-') as directory:
    temporary = Path(directory)
    (temporary / 'common.h').write_text('''#pragma once
#include <stdint.h>
#include <stdbool.h>
#include <assert.h>
#include <setjmp.h>
typedef int esp_err_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_ERR_INVALID_ARG 1
#define ESP_SLEEP_WAKEUP_TIMER 4
#define ESP_LOGI(...) ((void)0)
const char *esp_err_to_name(int);
int esp_sleep_enable_timer_wakeup(uint64_t);
int esp_sleep_disable_wakeup_source(int);
int esp_sleep_get_wakeup_cause(void);
int esp_light_sleep_start(void);
void esp_deep_sleep_start(void);
int64_t esp_timer_get_time(void);
''')
    for header in ['esp_err.h', 'esp_sleep.h', 'esp_timer.h', 'esp_log.h']:
        (temporary / header).write_text('#include "common.h"\n')
    (temporary / 'test.c').write_text(f'#include "{root}/firmware/freshmate-korvo/components/power/hs_power.c"\n' + '''
static uint64_t wakeup;
static int outcome, calls;
static int64_t now;
static jmp_buf deep;
const char *esp_err_to_name(int err){return err?"失败":"成功";}
int esp_sleep_enable_timer_wakeup(uint64_t us){wakeup=us;calls++;return ESP_OK;}
int esp_sleep_disable_wakeup_source(int cause){assert(cause==ESP_SLEEP_WAKEUP_TIMER);wakeup=0;return ESP_OK;}
int esp_sleep_get_wakeup_cause(void){return ESP_SLEEP_WAKEUP_TIMER;}
int64_t esp_timer_get_time(void){return now;}
int esp_light_sleep_start(void){assert(!strcmp(hs_power_state(),"Light Sleep"));hs_power_activity(true);assert(!strcmp(hs_power_state(),"Light Sleep"));now+=wakeup;return outcome;}
void esp_deep_sleep_start(void){assert(!strcmp(hs_power_state(),"Deep Sleep"));assert(wakeup==3000000);longjmp(deep,1);}
int main(void){
 assert(!strcmp(hs_power_state(),"Idle"));hs_power_activity(true);assert(!strcmp(hs_power_state(),"Active"));
 assert(hs_power_experiment(false,0)==ESP_ERR_INVALID_ARG);assert(hs_power_experiment(true,11)==ESP_ERR_INVALID_ARG);assert(calls==0);
 assert(hs_power_experiment(false,3)==ESP_OK);assert(!strcmp(hs_power_state(),"Idle"));assert(wakeup==0);
 outcome=ESP_FAIL;assert(hs_power_experiment(false,1)==ESP_FAIL);assert(!strcmp(hs_power_state(),"Idle"));assert(wakeup==0);
 if(!setjmp(deep))hs_power_experiment(true,3);
 puts("通过：时长边界、Active/Idle、休眠期间不被活动覆盖、Light Sleep失败恢复、Deep Sleep定时唤醒配置");
}
'''.replace('static uint64_t wakeup;', '#include <string.h>\nstatic uint64_t wakeup;'))
    subprocess.run(['cc', '-fsanitize=address,undefined', '-I', str(temporary), '-I', str(root / 'firmware/freshmate-korvo/components/power/include'), str(temporary / 'test.c'), '-o', str(temporary / 'test')], check=True)
    subprocess.run([str(temporary / 'test')], check=True)
