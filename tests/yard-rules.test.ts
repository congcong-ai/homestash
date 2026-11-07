import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../services/kitchen-core/src/app";
import { applyYardInteraction } from "../services/kitchen-core/src/yard";
test("剧情规则版本、拒绝非法动作、真实业务共用及重启持久化", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yard-rules-"));
  let core = createApp(join(dir, "test.db"));
  try {
    const initial = (await core.app.inject({ url: "/api/yard/rules" })).json();
    initial.rules[1].line = "一起种一颗小星星。";
    const put = () =>
      core.app.inject({
        method: "PUT",
        url: "/api/yard/rules",
        payload: initial,
      });
    const saved = await put();
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.json().version, 2);
    assert.equal((await put()).statusCode, 409);
    const bad = {
      ...saved.json(),
      rules: [{ ...initial.rules[1], action: "execute" }],
    };
    assert.equal(
      (
        await core.app.inject({
          method: "PUT",
          url: "/api/yard/rules",
          payload: bad,
        })
      ).statusCode,
      400,
    );
    assert.equal(
      applyYardInteraction(core.repo, crypto.randomUUID(), "讲讲小院故事")
        .reply,
      "一起种一颗小星星。",
    );
    const storyState = () => core.app.inject({ url: "/api/yard/story-state" });
    assert.deepEqual((await storyState()).json(), {
      mood: "curious",
      keepsakes: ["first-story"],
    });
    const repeated = crypto.randomUUID();
    applyYardInteraction(core.repo, repeated, "小院故事");
    applyYardInteraction(core.repo, repeated, "小院故事");
    assert.equal((await storyState()).json().keepsakes.length, 1);
    // 非法规则保留最后有效版本和内容。
    assert.deepEqual(
      (await core.app.inject({ url: "/api/yard/rules" })).json(),
      saved.json(),
    );
    await core.app.close();
    core.repo.sqlite.close();
    core = createApp(join(dir, "test.db"));
    assert.equal(
      (await core.app.inject({ url: "/api/yard/rules" })).json().version,
      2,
    );
    assert.equal(
      applyYardInteraction(core.repo, crypto.randomUUID(), "小院故事").reply,
      "一起种一颗小星星。",
    );
    assert.deepEqual(
      (await core.app.inject({ url: "/api/yard/story-state" })).json(),
      { mood: "curious", keepsakes: ["first-story"] },
    );
  } finally {
    await core.app.close();
    core.repo.sqlite.close();
    await rm(dir, { recursive: true, force: true });
  }
});
