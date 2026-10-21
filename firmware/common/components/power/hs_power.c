#include "hs_power.h"
#include "esp_sleep.h"
#include "esp_timer.h"
#include "esp_log.h"
#include <stdio.h>
static int state;
static const char *names[]={"Idle","Active","Light Sleep","Deep Sleep"};
const char *hs_power_state(void) {return names[__atomic_load_n(&state,__ATOMIC_ACQUIRE)];}
void hs_power_activity(bool active) {
  int before=__atomic_load_n(&state,__ATOMIC_RELAXED);
  if(before<2)__atomic_compare_exchange_n(&state,&before,active?1:0,false,__ATOMIC_RELEASE,__ATOMIC_RELAXED);
}
void hs_power_boot(void) {ESP_LOGI("HomeStash电源","启动 wakeup_cause=%d",(int)esp_sleep_get_wakeup_cause());}
esp_err_t hs_power_experiment(bool deep,unsigned seconds) {
  if(seconds<1 || seconds>10)return ESP_ERR_INVALID_ARG;
  esp_err_t err=esp_sleep_enable_timer_wakeup((uint64_t)seconds*1000000);
  if(err!=ESP_OK)return err;
  __atomic_store_n(&state,deep?3:2,__ATOMIC_RELEASE);
  ESP_LOGI("HomeStash电源","进入 %s，定时%u秒；未测量电流",hs_power_state(),seconds);
  fflush(stdout);int64_t started=esp_timer_get_time();
  if(deep)esp_deep_sleep_start();
  err=esp_light_sleep_start();
  ESP_LOGI("HomeStash电源","Light Sleep 返回 %s，elapsed_us=%lld wakeup_cause=%d",esp_err_to_name(err),(long long)(esp_timer_get_time()-started),(int)esp_sleep_get_wakeup_cause());
  esp_sleep_disable_wakeup_source(ESP_SLEEP_WAKEUP_TIMER);
  __atomic_store_n(&state,0,__ATOMIC_RELEASE);return err;
}
