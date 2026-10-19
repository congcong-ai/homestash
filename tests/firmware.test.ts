import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
test("直接编译固件 outbox C 代码，检查各落盘阶段中断后的文件恢复", () => {
  const temp = mkdtempSync(join(tmpdir(), "homestash-outbox-"));
  const project = resolve("firmware/freshmate-korvo");
  try {
    const binary = join(temp, "outbox-test");
    execFileSync("cc", [
      "-std=c11",
      "-D_POSIX_C_SOURCE=200809L",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-Drename=hs_test_fat_rename",
      `-DHS_DATA_ROOT="${join(temp, "data")}"`,
      "-I",
      join(project, "components/storage/include"),
      "-I",
      join(project, "components/audio/include"),
      "tests/firmware/outbox.c",
      join(project, "components/storage/hs_outbox.c"),
      join(project, "components/audio/wav.c"),
      "-o",
      binary,
    ]);
    const output = execFileSync(binary, { encoding: "utf8" });
    assert.match(output, /检查通过/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
