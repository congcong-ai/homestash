import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../services/kitchen-core/src/app";
test("表情配置拒绝未知主题、脚本和越界；保留上次配置且重启持久", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yard-avatar-"));
  let core = createApp(join(dir, "test.db"));
  try {
    const save = (payload: unknown) =>
      core.app.inject({
        method: "PATCH",
        url: "/api/yard/avatar",
        payload: payload as object,
      });
    const good = await save({ theme: 3, mode: "fullscreen" });
    assert.equal(good.statusCode, 200);
    assert.equal(good.json().revision, 1);
    for (const bad of [
      { theme: 4, mode: "standard" },
      { theme: -1, mode: "standard" },
      { theme: 1.5, mode: "standard" },
      { theme: 0, mode: "script" },
      { theme: 0, mode: "standard", script: "run" },
    ])
      assert.equal((await save(bad)).statusCode, 400);
    assert.deepEqual(
      (await core.app.inject({ url: "/api/yard/avatar" })).json().config,
      good.json(),
    );
    await core.app.close();
    core.repo.sqlite.close();
    core = createApp(join(dir, "test.db"));
    assert.deepEqual(
      (await core.app.inject({ url: "/api/yard/avatar" })).json().config,
      good.json(),
    );
    assert.equal(
      (await core.app.inject({ url: "/api/yard/avatar" })).json().themes.length,
      4,
    );
  } finally {
    await core.app.close();
    core.repo.sqlite.close();
    await rm(dir, { recursive: true, force: true });
  }
});
