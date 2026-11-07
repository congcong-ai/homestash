#include "hs_board.h"
#include "hs_runtime.h"
#include "tkl_gpio.h"
/* 引脚依据锁定 SDK 的 TUYA_T5AI_BOARD BSP：按键 12、功放 28。 */
static const char target[] = "HS_TARGET_V1:tuya-t5-ai-board-v1.02";
static hs_board_descriptor_t board = {
    .id = target + sizeof("HS_TARGET_V1:") - 1,
    .chip = "t5ai",
    .capabilities = HS_CAP_AUDIO_INPUT | HS_CAP_AUDIO_OUTPUT | HS_CAP_BUTTONS |
                    HS_CAP_WIFI | HS_CAP_DISPLAY | HS_CAP_TOUCH};
const hs_board_descriptor_t *hs_board_descriptor(void) { return &board; }
bool hs_board_has(hs_capability_t c) { return (board.capabilities & c) == c; }
static void (*dispatch)(hs_action_t);
static void button_poll(void *arg) {
  (void)arg;
  bool down = false;
  int64_t changed = 0, pressed = 0;
  bool held = false;
  for (;;) {
    TUYA_GPIO_LEVEL_E level;
    if (tkl_gpio_read(TUYA_GPIO_NUM_12, &level) == OPRT_OK) {
      bool next = level == TUYA_GPIO_LEVEL_LOW;
      if (next != down && hs_time_us() - changed >= 50000) {
        down = next;
        changed = hs_time_us();
        if (down) { pressed = changed; held = false; }
        else if (!held) dispatch(HS_ACTION_VOICE_TOGGLE);
      }
    }
    if (down && !held && hs_time_us()-pressed >= 1200000) {
      held = true; dispatch(HS_ACTION_PHOTO); /* 小院将值3解释为取消，不触发拍照。 */
    }
    hs_delay_ms(10);
  }
}
hs_err_t hs_board_inputs_init(void (*callback)(hs_action_t)) {
  if (!callback || dispatch)
    return HS_ERR_INVALID_STATE;
  TUYA_GPIO_BASE_CFG_T cfg = {.mode = TUYA_GPIO_PULLUP,
                              .direct = TUYA_GPIO_INPUT,
                              .level = TUYA_GPIO_LEVEL_HIGH};
  if (tkl_gpio_init(TUYA_GPIO_NUM_12, &cfg) != OPRT_OK)
    return HS_FAIL;
  dispatch = callback;
  return hs_task_start(button_poll, "hs-button", 2048, 3) ? HS_OK : HS_FAIL;
}

void hs_t5_storage_ready(bool ready) {
  if (ready)
    board.capabilities |= HS_CAP_PERSISTENT_STORAGE;
  else
    board.capabilities &= ~HS_CAP_PERSISTENT_STORAGE;
}
