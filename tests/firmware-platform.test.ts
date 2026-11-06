import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
const ports = "firmware/shared/components/device_port/include";
function runCompiler(args: string[]) {
  const result = spawnSync("cc", ["-Wall", "-Wextra", "-Werror", ...args], {
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr || String(result.error));
}
test("跨平台接口不把 ESP-IDF、FreeRTOS 或 LVGL 暴露给产品流程", () => {
  const app = readFileSync("firmware/apps/freshmate/freshmate_app.c", "utf8");
  assert.doesNotMatch(app, /#include\s+["<](esp_|nvs|freertos|bsp\/|lvgl)/);
  const targets = JSON.parse(readFileSync("firmware/targets.json", "utf8"));
  assert.equal(targets.targets["tuya-t5-ai"].platform, "tuyaopen");
  assert.notEqual(
    targets.targets["tuya-t5-ai"].boardId,
    targets.targets["korvo-s31"].boardId,
  );
});
test("Core 地址拆分保留端口和反向代理路径，拒绝鉴权及头注入", () => {
  const dir = mkdtempSync(join(tmpdir(), "homestash-endpoint-"));
  try {
    const file = join(dir, "test.c"),
      binary = join(dir, "test");
    writeFileSync(
      file,
      `#include "hs_endpoint.h"
#include <assert.h>
int main(void){hs_endpoint_t e;
 assert(hs_endpoint_parse("http://core.local:3101/base/",&e));
 assert(!strcmp(e.host,"core.local")&&e.port==3101&&!strcmp(e.prefix,"/base")&&!e.tls);
 assert(hs_endpoint_parse("https://example.com",&e)&&e.tls&&e.port==443);
 assert(hs_endpoint_parse("http://[::1]:3101/",&e)&&!strcmp(e.host,"::1")&&e.port==3101);
 const char *bad[]={"http://","ftp://core","http://core:0","http://core:65536","http://core:999999999999999","http://core:","http://user:password@core","http://core?token=secret","http://core/#x","http://core\\r\\nX:yes","http://core\\\\x","http://core:abc"};
 for(unsigned i=0;i<sizeof(bad)/sizeof(*bad);i++)assert(!hs_endpoint_parse(bad[i],&e));
 return 0;}
`,
    );
    runCompiler(["-I", ports, file, "-o", binary]);
    const run = spawnSync(binary, [], { encoding: "utf8", timeout: 5000 });
    assert.equal(run.status, 0, run.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("公共录音队列通过文件系统接口恢复原始 ID，拒绝损坏并兼容 FAT 缓存替换", () => {
  const dir = mkdtempSync(join(tmpdir(), "homestash-outbox-"));
  try {
    // 同一张卡保留 ESP32 的中断录音；T5 恢复与完成录音不能处理它。
    const espRoot = join(dir, "homestash");
    mkdirSync(join(espRoot, "outbox"), { recursive: true });
    const espFile = join(
      espRoot,
      "outbox",
      "11111111-1111-4111-8111-111111111111.part",
    );
    const original = Buffer.from(
      "ESP32 interrupted recording: preserve every byte",
    );
    writeFileSync(espFile, original);
    const board = readFileSync(
      "firmware/boards/tuya-t5-ai/CMakeLists.txt",
      "utf8",
    );
    const root = board.match(/HS_DATA_ROOT="\/sdcard\/([^"/]+)"/)?.[1];
    assert.equal(root, "homestash-t5");
    const binary = join(dir, "test");
    runCompiler([
      `-DHS_DATA_ROOT=${JSON.stringify(join(dir, root))}`,
      "-Drename=hs_test_fat_rename",
      "-I",
      "firmware/shared/components/outbox/include",
      "-I",
      "firmware/boards/esp32-s31-korvo-1/components/audio/include",
      "tests/firmware/outbox.c",
      "firmware/shared/components/outbox/hs_outbox.c",
      "firmware/shared/components/outbox/hs_fs_posix.c",
      "firmware/boards/esp32-s31-korvo-1/components/audio/wav.c",
      "-o",
      binary,
    ]);
    const run = spawnSync(binary, [], { encoding: "utf8", timeout: 5000 });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /回归检查通过/);
    assert.deepEqual(readFileSync(espFile), original);
    assert.deepEqual(readdirSync(join(espRoot, "outbox")), [
      "11111111-1111-4111-8111-111111111111.part",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("T5 音频适配器保留 PCM 字节、拒绝覆盖，缓冲区满和播放失败可见", () => {
  const dir = mkdtempSync(join(tmpdir(), "homestash-t5-audio-"));
  try {
    const binary = join(dir, "test");
    runCompiler([
      `-DHS_DATA_ROOT=${JSON.stringify(join(dir, "media"))}`,
      "-I",
      "tests/firmware/t5-mocks",
      "-I",
      ports,
      "-I",
      "firmware/shared/components/outbox/include",
      "tests/firmware/t5-audio.c",
      "firmware/boards/tuya-t5-ai/src/hs_audio.c",
      "firmware/shared/components/outbox/hs_outbox.c",
      "firmware/shared/components/outbox/hs_fs_posix.c",
      "-o",
      binary,
    ]);
    const run = spawnSync(binary, [], { encoding: "utf8", timeout: 5000 });
    assert.equal(run.status, 0, run.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("T5 文件系统适配区分 FatFs 文件缺失、正常结束与磁盘错误", () => {
  const dir = mkdtempSync(join(tmpdir(), "homestash-t5-fs-"));
  try {
    const binary = join(dir, "test");
    runCompiler([
      "-DHS_PLATFORM_TUYA=1",
      "-I",
      "tests/firmware/t5-fs-mocks",
      "-I",
      "firmware/shared/components/outbox/include",
      "tests/firmware/t5-filesystem.c",
      "firmware/platforms/tuyaopen/hs_fs.c",
      "-o",
      binary,
    ]);
    const run = spawnSync(binary, [], { encoding: "utf8", timeout: 5000 });
    assert.equal(run.status, 0, run.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
