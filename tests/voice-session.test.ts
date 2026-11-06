import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("板端会话保持60秒，交互续期、退下及重新唤醒", () => {
  const temp = mkdtempSync(join(tmpdir(), "homestash-voice-session-"));
  try {
    const binary = join(temp, "voice-session");
    const build = spawnSync(
      "cc",
      [
        "-Wall",
        "-Wextra",
        "-Werror",
        "-I",
        "firmware/boards/esp32-s31-korvo-1/components/audio/include",
        "tests/firmware/voice-session.c",
        "-o",
        binary,
      ],
      { encoding: "utf8" },
    );
    assert.equal(build.status, 0, build.stderr);
    const result = spawnSync(binary, [], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("小院门事件冷却、超时与取消代次隔离", () => {
  const temp = mkdtempSync(join(tmpdir(), "yard-session-"));
  try {
    const source = join(temp, "test.c"),
      binary = join(temp, "test");
    const script = `#include "yard_state.h"
#include <assert.h>
int main(void){yard_session_t s={.listening=true};assert(yard_door(&s,100));unsigned gen=s.generation;assert(!yard_door(&s,200));assert(!yard_expire(&s,7000));assert(yard_expire(&s,7100));assert(!yard_current(&s,gen));assert(!yard_door(&s,8000));assert(yard_door(&s,600101));yard_cancel(&s);assert(s.phase==YARD_REST);return 0;}`;
    // 临时编译产物不进入仓库。
    spawnSync("python3", [
      "-c",
      "import sys;open(sys.argv[1],'w').write(sys.argv[2])",
      source,
      script,
    ]);
    const build = spawnSync(
      "cc",
      [
        "-Wall",
        "-Wextra",
        "-Werror",
        "-I",
        "firmware/apps/food-spirit-yard",
        source,
        "-o",
        binary,
      ],
      { encoding: "utf8" },
    );
    assert.equal(build.status, 0, build.stderr);
    const run = spawnSync(binary, [], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
