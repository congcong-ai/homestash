#include "wav.h"
#include <string.h>
static void u16(uint8_t *p, uint16_t n) {
  p[0] = n;
  p[1] = n >> 8;
}
static void u32(uint8_t *p, uint32_t n) {
  u16(p, n);
  u16(p + 2, n >> 16);
}
int badge_wav_header(FILE *f, uint32_t bytes) {
  uint8_t h[44] = {0};
  memcpy(h, "RIFF", 4);
  u32(h + 4, bytes + 36);
  memcpy(h + 8, "WAVEfmt ", 8);
  u32(h + 16, 16);
  u16(h + 20, 1);
  u16(h + 22, 1);
  u32(h + 24, 16000);
  u32(h + 28, 32000);
  u16(h + 32, 2);
  u16(h + 34, 16);
  memcpy(h + 36, "data", 4);
  u32(h + 40, bytes);
  if (fseek(f, 0, SEEK_SET))
    return -1;
  return fwrite(h, 1, 44, f) == 44 ? 0 : -1;
}
