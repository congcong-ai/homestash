import "dotenv/config";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../services/kitchen-core/src/app";
const directory = await mkdtemp(join(tmpdir(), "homestash-recipes-live-"));
const core = createApp(join(directory, "probe.db"));
try {
  core.inventory.create({ name: "番茄", quantity: 3, unit: "个" });
  core.inventory.create({ name: "鸡蛋", quantity: 4, unit: "个" });
  core.inventory.create({ name: "豆腐", quantity: 1, unit: "盒" });
  const baseline = core.repo.list();
  const payload = {
    people: 2,
    requirements: "20分钟内，清淡一些，优先用番茄和豆腐",
    requestId: crypto.randomUUID(),
  };
  const response = await core.app.inject({
    method: "POST",
    url: "/api/recipes",
    payload,
  });
  assert.equal(response.statusCode, 200, response.body);
  const recipes = response.json();
  assert.ok(recipes.length >= 1 && recipes.length <= 3);
  assert.ok(recipes.every((r: { origin: string }) => r.origin === "ai"));
  const start = await core.app.inject({
    method: "POST",
    url: "/api/cooking",
    payload: { action: "start", recipeId: recipes[0].id, people: 2 },
  });
  assert.equal(start.statusCode, 200, start.body);
  const ask = await core.app.inject({
    method: "POST",
    url: "/api/cooking",
    payload: {
      action: "ask",
      sessionId: start.json().id,
      revision: start.json().revision,
      question: "这一步有什么可以提前准备的？",
      requestId: crypto.randomUUID(),
    },
  });
  assert.equal(ask.statusCode, 200, ask.body);
  assert.ok(ask.json().answer.length > 5);
  assert.deepEqual(core.repo.list(), baseline);
  const result = {
    日期: new Date().toISOString(),
    说明: "真实百炼生成菜谱与烹饪问答，临时 SQLite，未改日常库存；不是物理设备测试。",
    recipes,
    answer: ask.json().answer,
    库存未改变: true,
  };
  await writeFile(
    join(directory, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify({ directory, ...result }, null, 2));
} finally {
  await core.app.close();
}
