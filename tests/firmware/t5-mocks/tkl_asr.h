#pragma once
#include <stdint.h>

/* 音频适配器测试不加载板载唤醒模型。 */
typedef enum {
  TKL_ASR_WAKEUP_NONE,
  TKL_ASR_WAKEUP_NIHAO_TUYA,
} TKL_ASR_WAKEUP_WORD_E;

static inline unsigned tkl_asr_get_process_uint_size(void) { return 640; }
static inline int tkl_asr_init(void) { return 0; }
static inline void tkl_asr_deinit(void) {}
static inline int tkl_asr_wakeup_word_config(TKL_ASR_WAKEUP_WORD_E *words,
                                             unsigned count) {
  (void)words;
  (void)count;
  return 0;
}
static inline TKL_ASR_WAKEUP_WORD_E tkl_asr_recognize_wakeup_word(
    uint8_t *pcm, unsigned size) {
  (void)pcm;
  (void)size;
  return TKL_ASR_WAKEUP_NONE;
}
