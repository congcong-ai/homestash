import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
test("T5大音频分块落盘、取消清理及SDK错误分支不重复释放", () => {
  const dir = mkdtempSync(join(tmpdir(), "hs-http-stream-"));
  try {
    const binary = join(dir, "test");
    const build = spawnSync(
      "cc",
      [
        "-Wall",
        "-Wextra",
        "-Werror",
        "-I",
        "tests/firmware/http-mocks",
        "tests/firmware/http-stream.c",
        "firmware/platforms/tuyaopen/hs_http.c",
        "-o",
        binary,
      ],
      { encoding: "utf8" },
    );
    assert.equal(build.status, 0, build.stderr);
    const run = spawnSync(binary, [], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
