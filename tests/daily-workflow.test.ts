import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../services/kitchen-core/src/app";
import type { CookingSession } from "@homestash/recipes";
import type { ShoppingItem } from "@homestash/domain";
const post = (
  core: ReturnType<typeof createApp>,
  url: string,
  payload: object,
) => core.app.inject({ method: "POST", url, payload });
const fromRecipe = (core: ReturnType<typeof createApp>) =>
  post(core, "/api/shopping", {
    action: "from_recipe",
    recipeId: "tomato-eggs",
    people: 2,
    requestId: crypto.randomUUID(),
  });

test("日常闭环：缺货采购、分批确认、重启续做、核对扣减、补货与再次入库", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hs-daily-flow-"));
  const db = join(dir, "core.db");
  let core = createApp(db);
  try {
    const plan = await fromRecipe(core);
    assert.equal(plan.statusCode, 200, plan.body);
    const entries = plan.json<ShoppingItem[]>();
    assert.equal(entries.length, 2);
    assert.equal(core.repo.list().length, 0);
    for (const entry of entries) {
      assert.equal(
        (
          await post(core, "/api/shopping", {
            action: "check",
            id: entry.id,
            requestId: crypto.randomUUID(),
          })
        ).statusCode,
        200,
      );
      const item = {
        name: entry.name,
        quantity: entry.quantity,
        unit: entry.unit,
        locationId: "fridge",
        bestBeforeAt: "2099-01-01",
      };
      const payload = { requestId: crypto.randomUUID(), item };
      const url = `/api/shopping/${entry.id}/receive`;
      assert.equal((await post(core, url, payload)).statusCode, 200);
      assert.equal((await post(core, url, payload)).statusCode, 200);
    }
    assert.equal(core.repo.list().length, 2);
    assert.equal(core.repo.events().length, 2);
    const state = (await core.app.inject("/api/state")).json();
    assert.equal(
      state.recipes.find((r: { id: string }) => r.id === "tomato-eggs").missing
        .length,
      0,
    );
    let session = (
      await post(core, "/api/cooking", {
        action: "start",
        recipeId: "tomato-eggs",
        people: 2,
        requestId: crypto.randomUUID(),
      })
    ).json<CookingSession>();
    const next = {
      action: "next",
      sessionId: session.id,
      revision: session.revision,
      requestId: crypto.randomUUID(),
    };
    session = (await post(core, "/api/cooking", next)).json();
    assert.equal(session.step, 1);
    await core.app.close();
    core = createApp(db);
    assert.equal((await post(core, "/api/cooking", next)).json().step, 1);
    const resumed = await post(core, "/api/cooking", {
      action: "start",
      recipeId: "tomato-eggs",
      people: 2,
      requestId: crypto.randomUUID(),
    });
    assert.equal(resumed.statusCode, 200);
    assert.equal(
      resumed.json().id,
      session.id,
      "再次打开同一道菜不能创建新任务",
    );
    assert.equal(resumed.json().step, 1, "再次打开同一道菜不能从头开始");
    session = resumed.json();
    const staleSwitch = await post(core, "/api/cooking", {
      action: "start",
      recipeId: "tomato-soup",
      people: 2,
      sessionId: session.id,
      revision: (session.revision ?? 1) - 1,
      requestId: crypto.randomUUID(),
    });
    assert.equal(staleSwitch.statusCode, 409);
    assert.equal(
      core.repo.read<CookingSession | null>("cooking", null)?.id,
      session.id,
    );
    const finish = {
      action: "finish",
      sessionId: session.id,
      revision: session.revision,
      requestId: crypto.randomUUID(),
    };
    const pending = (
      await post(core, "/api/cooking", finish)
    ).json<CookingSession>();
    assert.equal(pending.status, "awaiting_confirmation");
    assert.equal(core.repo.events().length, 2);
    assert.equal(pending.consumption?.missing.length, 0);
    await core.app.close();
    core = createApp(db);
    const resumePending = await post(core, "/api/cooking", {
      action: "start",
      recipeId: "tomato-eggs",
      people: 2,
      requestId: crypto.randomUUID(),
    });
    assert.equal(resumePending.json().status, "awaiting_confirmation");
    assert.equal(resumePending.json().id, pending.id);
    const confirm = {
      action: "confirm_consumption",
      sessionId: pending.id,
      revision: pending.revision,
      requestId: crypto.randomUUID(),
    };
    const responses = await Promise.all([
      post(core, "/api/cooking", confirm),
      post(core, "/api/cooking", confirm),
    ]);
    assert.deepEqual(
      responses.map((r) => r.statusCode),
      [200, 200],
    );
    assert.equal(responses[0].json().status, "completed");
    assert.equal(core.repo.events().length, 4);
    assert.equal(
      core.repo.list().every((i) => i.quantity === 0),
      true,
    );
    const replenishment = (await fromRecipe(core)).json<ShoppingItem[]>();
    const unchecked = replenishment.filter((i) => !i.checked);
    assert.equal(unchecked.length, 2);
    await fromRecipe(core);
    assert.equal(
      (await core.app.inject("/api/shopping"))
        .json<ShoppingItem[]>()
        .filter((i) => !i.checked).length,
      2,
    );
    for (const entry of unchecked) {
      await post(core, "/api/shopping", {
        action: "check",
        id: entry.id,
        requestId: crypto.randomUUID(),
      });
      assert.equal(
        (
          await post(core, `/api/shopping/${entry.id}/receive`, {
            requestId: crypto.randomUUID(),
            item: {
              name: entry.name,
              quantity: entry.quantity + 1,
              unit: entry.unit,
            },
          })
        ).statusCode,
        200,
      );
    }
    assert.equal(core.repo.list().length, 4);
    assert.equal(core.repo.events().length, 6);
    assert.equal(core.repo.list().filter((i) => i.quantity > 0).length, 2);
    const backup = await core.app.inject("/api/backups/export");
    assert.equal(backup.statusCode, 200, backup.body);
  } finally {
    await core.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("食谱清单复核移除已齐的计划项、保留手动项，已买待确认不重复加购", async () => {
  const core = createApp(":memory:");
  try {
    const entries = (await fromRecipe(core)).json<ShoppingItem[]>();
    const tomato = entries.find((i) => i.name === "番茄")!;
    await post(core, "/api/shopping", {
      action: "check",
      id: tomato.id,
      requestId: crypto.randomUUID(),
    });
    await fromRecipe(core);
    assert.equal(
      (await core.app.inject("/api/shopping"))
        .json<ShoppingItem[]>()
        .filter((i) => i.name === "番茄").length,
      1,
      "已买待入库时不能重复生成番茄采购项",
    );
    await post(core, "/api/shopping", {
      action: "add",
      item: { name: "鸡蛋", quantity: 1, unit: "个" },
      requestId: crypto.randomUUID(),
    });
    core.inventory.create({ name: "番茄", quantity: 2 });
    core.inventory.create({ name: "鸡蛋", quantity: 3 });
    const beforeSync = core.repo.read<ShoppingItem[]>("shopping", []);
    const write = core.repo.write.bind(core.repo);
    core.repo.write = (key, value) => {
      write(key, value);
      if (key === "shopping") throw Error("模拟清单复核提交失败");
    };
    assert.equal((await fromRecipe(core)).statusCode, 502);
    assert.deepEqual(core.repo.read("shopping", []), beforeSync);
    core.repo.write = write;
    const refreshed = await fromRecipe(core);
    assert.equal(refreshed.statusCode, 200, refreshed.body);
    const list = refreshed.json<ShoppingItem[]>();
    assert.equal(
      list.filter((i) => !i.checked && i.source.startsWith("recipe:")).length,
      0,
      "食谱已齐时应移除其待购计划项",
    );
    assert.equal(list.find((i) => i.source === "manual")?.quantity, 1);
    assert.equal(list.find((i) => i.id === tomato.id)?.checked, true);
  } finally {
    await core.app.close();
  }
});
