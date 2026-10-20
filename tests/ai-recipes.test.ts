import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../services/kitchen-core/src/app";
import { MockAIProvider, type RecipeRequest } from "@homestash/ai";
const post = (
  core: ReturnType<typeof createApp>,
  url: string,
  payload: unknown,
) => core.app.inject({ method: "POST", url, payload: payload as object });
test("AI 菜谱进入持久化目录、按真实库存核算缺货、启动烹饪并使用 AI 问答", async () => {
  let input: RecipeRequest | undefined;
  let asks = 0;
  const parser = new MockAIProvider();
  const core = createApp(":memory:", {
    kind: "test-ai",
    structuredOutput: (t) => parser.structuredOutput(t),
    async generateRecipes(request) {
      input = request;
      return [
        {
          name: "番茄炖豆腐",
          minutes: 20,
          ingredients: [
            { name: "番茄", quantity: 2, unit: "个" },
            { name: "豆腐", quantity: 1, unit: "盒" },
          ],
          steps: ["洗净番茄切块，豆腐切块。", "加水炖至充分熟透。"],
        },
      ];
    },
    async answerCooking(question) {
      asks++;
      assert.equal(question.recipe.name, "番茄炖豆腐");
      return "当前是准备食材，豆腐切成约两厘米的块。";
    },
  });
  try {
    core.inventory.create({ name: "番茄", quantity: 2, unit: "个" });
    core.inventory.create({
      name: "牛奶",
      quantity: 1,
      unit: "瓶",
      expiresAt: "2000-01-01",
    });
    core.inventory.create({ name: "药品", category: "medicine", quantity: 2 });
    const baseline = core.repo.list();
    const payload = {
      people: 3,
      requirements: "清淡一些",
      requestId: crypto.randomUUID(),
    };
    const response = await post(core, "/api/recipes", payload);
    assert.equal(response.statusCode, 200, response.body);
    const recipe = response.json()[0];
    assert.equal(recipe.origin, "ai");
    assert.match(recipe.missing.join(), /豆腐/);
    assert.deepEqual(recipe.used, ["番茄"]);
    assert.equal(input?.people, 3);
    assert.equal(input?.requirements, "清淡一些");
    assert.deepEqual(input?.inventory, [
      { name: "番茄", quantity: 2, unit: "个" },
    ]);
    assert.deepEqual(
      (await post(core, "/api/recipes", payload)).json(),
      response.json(),
    );
    const start = await post(core, "/api/cooking", {
      action: "start",
      recipeId: recipe.id,
      people: 3,
    });
    assert.equal(start.statusCode, 200, start.body);
    const ask = await post(core, "/api/cooking", {
      action: "ask",
      sessionId: start.json().id,
      revision: start.json().revision,
      question: "怎么切",
      requestId: crypto.randomUUID(),
    });
    assert.equal(ask.statusCode, 200, ask.body);
    assert.match(ask.json().answer, /两厘米/);
    assert.equal(asks, 1);
    assert.deepEqual(core.repo.list(), baseline);
    const shortage = await post(core, "/api/shopping", {
      action: "from_recipe",
      recipeId: recipe.id,
      people: 3,
      requestId: crypto.randomUUID(),
    });
    assert.equal(shortage.statusCode, 200, shortage.body);
    assert.equal(shortage.json()[0].name, "豆腐");
  } finally {
    await core.app.close();
  }
});
test("生成式食谱失败或非法输出不清空旧推荐、不写库存、不假装回退成功", async () => {
  let fail = false;
  const parser = new MockAIProvider();
  const core = createApp(":memory:", {
    kind: "bad-ai",
    structuredOutput: (t) => parser.structuredOutput(t),
    async generateRecipes() {
      if (fail) throw new Error("服务故障");
      return [
        {
          name: "简单番茄",
          minutes: 5,
          ingredients: [{ name: "番茄", quantity: 1, unit: "个" }],
          steps: ["煮至充分熟透。"],
        },
      ];
    },
  });
  try {
    core.inventory.create({ name: "番茄", quantity: 2 });
    const first = await post(core, "/api/recipes", { people: 2 });
    assert.equal(first.statusCode, 200);
    fail = true;
    assert.equal(
      (await post(core, "/api/recipes", { people: 2 })).statusCode,
      502,
    );
    assert.deepEqual(
      (await core.app.inject("/api/state")).json().recipes,
      first.json(),
    );
    assert.equal(core.repo.events().length, 1);
  } finally {
    await core.app.close();
  }
});
