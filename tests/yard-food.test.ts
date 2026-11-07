import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../services/kitchen-core/src/app";
import {
  foodInteraction,
  readFood,
  mealNow,
} from "../services/kitchen-core/src/yard-food";
test("饭点按北京时间、每餐只问一次、原话留存且不推断成员", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yard-food-"));
  let core = createApp(join(dir, "test.db"));
  try {
    const lunch = new Date("2026-11-07T04:00:00Z");
    assert.equal(mealNow(core.repo, lunch)?.meal, "午餐");
    assert.equal(mealNow(core.repo, new Date("2000-01-01")), null);
    assert.equal(
      foodInteraction(core.repo, "a", "你好", lunch),
      "今天午餐吃什么呀？",
    );
    assert.equal(foodInteraction(core.repo, "b", "你好", lunch), undefined);
    foodInteraction(core.repo, "c", "今天中午吃了番茄炒蛋，是爸爸做的", lunch);
    assert.equal(readFood(core.repo).entries.length, 1);
    assert.equal(readFood(core.repo).entries[0].speakerId, null);
    foodInteraction(core.repo, "c", "今天中午吃了番茄炒蛋", lunch);
    assert.equal(readFood(core.repo).entries.length, 1);
    await core.app.close();
    core.repo.sqlite.close();
    core = createApp(join(dir, "test.db"));
    assert.equal(foodInteraction(core.repo, "d", "你好", lunch), undefined);
    assert.equal(
      foodInteraction(core.repo, "e", "你好", new Date("2026-11-08T04:00:00Z")),
      "今天午餐吃什么呀？",
    );
  } finally {
    await core.app.close();
    core.repo.sqlite.close();
    await rm(dir, { recursive: true, force: true });
  }
});
