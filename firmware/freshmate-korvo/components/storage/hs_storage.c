#include "hs_storage.h"
#include "hs_outbox.h"
#include "bsp/sdcard.h"
#include <sys/stat.h>
#include <errno.h>
esp_err_t hs_storage_init(void) {
  bsp_sdcard_config_t c = BSP_SDCARD_DEFAULT_CONFIG();
  esp_err_t e = bsp_sdcard_mount(&c, NULL);
  if (e != ESP_OK) return e;
  return hs_outbox_init()==0 ? ESP_OK : ESP_FAIL;
}
