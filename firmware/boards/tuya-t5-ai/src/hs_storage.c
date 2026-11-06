#include "hs_storage.h"
#include "hs_build_config.h"
#include "tkl_fs.h"
#include <stdbool.h>
void hs_t5_storage_ready(bool ready);
hs_err_t hs_storage_init(void) {
  /* 仅挂载 SD；不调用格式化，也不猜测 Flash 剩余空间能保存最长录音。 */
  hs_err_t e = tkl_fs_mount("/sdcard", DEV_SDCARD) == 0 && hs_outbox_init() == 0
                   ? HS_OK
                   : HS_FAIL;
  hs_t5_storage_ready(e == HS_OK);
  return e;
}
