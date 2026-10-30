import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("Wi-Fi暂停与恢复幂等，显式重连保留，合并事件以获得IP为准", () => {
  const temp = mkdtempSync(join(tmpdir(), "homestash-wifi-control-"));
  try {
    const binary = join(temp, "wifi-control");
    const build = spawnSync(
      "cc",
      [
        "-Wall",
        "-Wextra",
        "-Werror",
        "-I",
        "firmware/common/components/network/include",
        "tests/firmware/wifi-control.c",
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

test("记住多个Wi-Fi、更新密码、忘记记录及容量边界", () => {
  const temp = mkdtempSync(join(tmpdir(), "homestash-wifi-saved-"));
  try {
    const binary = join(temp, "wifi-saved");
    const build = spawnSync(
      "cc",
      [
        "-Wall",
        "-Wextra",
        "-Werror",
        "-I",
        "firmware/common/components/network/include",
        "tests/firmware/wifi-saved.c",
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

test("六个联网演示的14个步骤匹配提示指令，04和06主动开场", () => {
  const temp = mkdtempSync(join(tmpdir(), "homestash-demo-voice-"));
  try {
    const binary = join(temp, "demo-voice");
    const build = spawnSync(
      "cc",
      [
        "-Wall",
        "-Wextra",
        "-Werror",
        "-I",
        "firmware/freshmate-korvo/components/demo_mode/include",
        "tests/firmware/demo-voice.c",
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
