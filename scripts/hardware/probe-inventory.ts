import "dotenv/config";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../services/kitchen-core/src/app";
const directory = await mkdtemp(join(tmpdir(), "homestash-inventory-live-"));
const core = createApp(join(directory, "probe.db"));
const records: unknown[] = [];
try {
  const milk = core.inventory.create({ name: "牛奶", quantity: 1, unit: "瓶" });
  core.inventory.create({ name: "番茄", quantity: 3, unit: "个" });
  core.inventory.create({ name: "鸡蛋", quantity: 1, unit: "个" });
  core.inventory.create({
    name: "草莓",
    quantity: 1,
    unit: "盒",
    bestBeforeAt: new Date().toISOString().slice(0, 10),
  });
  async function voice(text: string, expected: RegExp) {
    const response = await core.app.inject({
      method: "POST",
      url: "/api/voice",
      payload: { text, requestId: crypto.randomUUID() },
    });
    assert.equal(response.statusCode, 200, response.body);
    const result = response.json();
    assert.match(result.message, expected);
    records.push({ text, ...result });
    return result;
  }
  await voice("家里有什么", /牛奶1瓶/);
  await voice("今天先吃什么", /草莓1盒/);
  await voice("牛奶开封了", /开封/);
  assert.ok(core.repo.get(milk.id)?.openedAt);
  await voice("把牛奶移到冷冻室", /冷冻/);
  assert.equal(core.repo.get(milk.id)?.locationId, "freezer");
  await voice("做番茄炒蛋缺什么", /鸡蛋2个/);
  assert.equal((await core.app.inject("/api/shopping")).json().length, 0);
  await voice("把番茄炒蛋缺的加入购物清单", /已加入/);
  await voice("购物清单加一瓶牛奶", /牛奶1瓶/);
  await voice("看看购物清单", /牛奶1瓶/);
  await voice("牛奶买到了", /未自动增加/);
  const result = {
    日期: new Date().toISOString(),
    说明: "真实百炼结构化意图联调，全部使用临时 SQLite；未修改日常库存，未调用设备麦克风。",
    records,
  };
  await writeFile(
    join(directory, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify({ directory, ...result }, null, 2));
} finally {
  await core.app.close();
}
