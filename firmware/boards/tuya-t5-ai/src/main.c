void yard_app_run(void);
#include "hs_runtime.h"
static void product(void *arg) {
  (void)arg;
  yard_app_run();
  for (;;)
    hs_delay_ms(1000);
}
void tuya_app_main(void) {
  HS_ASSERT(hs_task_start(product, "homestash", 24576, 3));
}
