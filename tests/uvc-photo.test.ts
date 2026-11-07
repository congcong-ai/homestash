import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
test("正式UVC接口重复采集与取消，不输出图像串口数据", () => {
  const dir = mkdtempSync(join(tmpdir(), "uvc-photo-"));
  try {
    const binary = join(dir, "test");
    const built = spawnSync(
      "cc",
      [
        "-Wall",
        "-Wextra",
        "-Werror",
        "-I",
        "tests/firmware/photo-mocks",
        "-I",
        "tests/firmware/uvc-shot-mocks",
        "-I",
        "firmware/shared/components/device_port/include",
        "tests/firmware/uvc-photo.c",
        "firmware/boards/tuya-t5-ai/src/hs_uvc_photo.c",
        "-o",
        binary,
      ],
      { encoding: "utf8" },
    );
    assert.equal(built.status, 0, built.stderr);
    const run = spawnSync(binary, [], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
