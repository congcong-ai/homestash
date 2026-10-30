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
        "firmware/freshmate-korvo/components/audio/include",
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
