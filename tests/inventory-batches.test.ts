import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../services/kitchen-core/src/app";
import {
  freshnessInfo,
  ItemInput,
  type InventoryEvent,
} from "@homestash/domain";

test("临期依据使用最早日期，区分未设日期和估算开封规则，药品不套食品规则", () => {
  const item = ItemInput.parse({
    name: "牛奶",
    bestBeforeAt: "2026-10-25",
    expiresAt: "2026-10-28",
    openedAt: "2026-10-20",
  });
  assert.deepEqual(freshnessInfo(item, "2026-10-21"), {
    status: "eat_soon",
    deadline: "2026-10-22",
    basis: "开封后2天提醒（默认规则）",
    estimated: true,
    days: 1,
  });
  assert.equal(
    freshnessInfo({ ...item, category: "medicine" }, "2026-10-21").deadline,
    "2026-10-25",
  );
  assert.equal(
    freshnessInfo({ ...item, expiresAt: "2026-10-21" }, "2026-10-21").status,
    "urgent",
  );
  assert.equal(freshnessInfo(item, "2026-10-23").status, "expired");
  assert.equal(freshnessInfo(ItemInput.parse({ name: "纸巾" })).deadline, null);
});

test("同名批次操作隔离，错误消耗可纠正；原事件不可覆盖，库存版本递增且不能重复纠正", async () => {
  const core = createApp(":memory:");
  try {
    const first = core.inventory.create({
      name: "牛奶",
      quantity: 2,
      unit: "瓶",
      locationId: "fridge",
    });
    const other = core.inventory.create({
      name: "牛奶",
      quantity: 3,
      unit: "盒",
      locationId: "pantry",
    });
    const changed = core.inventory.act(
      first.id,
      { type: "consume", quantity: "all" },
      1,
    );
    const event = core.repo
      .events()
      .find((e) => e.itemId === first.id && e.type === "ITEM_CONSUMED")!;
    const original = structuredClone(event);
    const restored = core.inventory.correct(first.id, {
      eventId: event.id,
      expectedVersion: changed.version,
      reason: "误点用完",
    });
    assert.equal(restored.quantity, 2);
    assert.equal(restored.version, 3);
    assert.deepEqual(core.repo.get(other.id), other);
    assert.deepEqual(
      core.repo.events().find((e) => e.id === event.id),
      original,
    );
    const correction = core.repo
      .events()
      .find((e) => e.type === "ITEM_CORRECTED")!;
    assert.deepEqual(correction.correction, {
      eventId: event.id,
      reason: "误点用完",
    });
    assert.equal(correction.before?.quantity, 0);
    assert.equal(correction.after.quantity, 2);
    assert.throws(() =>
      core.inventory.correct(first.id, {
        eventId: event.id,
        expectedVersion: 3,
        reason: "再来一次",
      }),
    );
    assert.throws(() =>
      core.inventory.correct(first.id, {
        eventId: correction.id,
        expectedVersion: 3,
        reason: "撤回纠正",
      }),
    );
    assert.throws(() =>
      core.inventory.correct(first.id, {
        eventId: core.repo.events().find((e) => e.itemId === other.id)!.id,
        expectedVersion: 3,
        reason: "跨批次",
      }),
    );
  } finally {
    await core.app.close();
  }
});

test("移动、开封、日期和误添加可恢复，后续真实变更与旧版本阻止覆盖", async () => {
  const core = createApp(":memory:");
  try {
    let item = core.inventory.create({
      name: "草莓",
      quantity: 1,
      unit: "盒",
      expiresAt: "2026-10-25",
      metadata: { evidence: "原始来源" },
    });
    for (const action of [
      { type: "move", locationId: "freezer" },
      { type: "discard", quantity: "all" },
      { type: "expire", date: "2026-10-22" },
      { type: "restock", quantity: 2 },
      { type: "open", date: "2026-10-21" },
      {
        type: "update",
        patch: { quantity: 8, expiresAt: "2026-10-22", name: "错名字" },
      },
    ]) {
      const before = structuredClone(item);
      item = core.inventory.act(item.id, action, item.version);
      const event = core.repo
        .events()
        .filter((e) => e.itemId === item.id)
        .at(-1)!;
      item = core.inventory.correct(item.id, {
        eventId: event.id,
        expectedVersion: item.version,
        reason: "测试误操作",
      });
      assert.deepEqual({ ...item, version: before.version }, before);
    }
    const added = core.inventory.create({ name: "误添加", quantity: 5 });
    const event = core.repo.events().find((e) => e.itemId === added.id)!;
    const removed = core.inventory.correct(added.id, {
      eventId: event.id,
      expectedVersion: 1,
      reason: "重复添加",
    });
    assert.equal(removed.quantity, 0);
    assert.ok(core.repo.get(added.id));
    const moved = core.inventory.act(item.id, {
      type: "move",
      locationId: "pantry",
    });
    const old = core.repo
      .events()
      .filter((e) => e.itemId === item.id)
      .at(-1)!;
    core.inventory.act(item.id, { type: "consume", quantity: 0.5 });
    assert.throws(() =>
      core.inventory.correct(item.id, {
        eventId: old.id,
        expectedVersion: moved.version,
        reason: "过时",
      }),
    );
    assert.throws(() =>
      core.inventory.correct(item.id, {
        eventId: old.id,
        expectedVersion: moved.version + 1,
        reason: "覆盖后续",
      }),
    );
    assert.throws(() =>
      core.inventory.act(
        item.id,
        { type: "discard", quantity: "all" },
        moved.version,
      ),
    );
    assert.equal(core.repo.get(item.id)?.quantity, 0.5);
  } finally {
    await core.app.close();
  }
});

test("HTTP动作与纠正跨重启幂等，失败回滚，按批次历史完整读取超过50条", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hs-batch-"));
  const db = join(dir, "core.db");
  let core = createApp(db);
  const post = (url: string, payload: object) =>
    core.app.inject({ method: "POST", url, payload });
  try {
    const item = core.inventory.create({ name: "番茄", quantity: 100 });
    const action = {
      requestId: crypto.randomUUID(),
      expectedVersion: 1,
      type: "consume",
      quantity: 1,
    };
    const url = `/api/items/${item.id}/actions`;
    const replies = await Promise.all([post(url, action), post(url, action)]);
    assert.deepEqual(
      replies.map((r) => r.statusCode),
      [200, 200],
    );
    assert.equal(core.repo.get(item.id)?.quantity, 99);
    assert.equal(
      (await post(url, { ...action, requestId: crypto.randomUUID() }))
        .statusCode,
      409,
    );
    const event = core.repo.events().find((e) => e.type === "ITEM_CONSUMED")!;
    const payload = {
      requestId: crypto.randomUUID(),
      eventId: event.id,
      expectedVersion: 2,
      reason: "数量点错",
    };
    const correctionUrl = `/api/items/${item.id}/corrections`;
    const save = core.repo.save.bind(core.repo);
    core.repo.save = (i, e) => {
      save(i, e);
      throw Error("模拟保存后失败");
    };
    assert.equal((await post(correctionUrl, payload)).statusCode, 502);
    assert.equal(core.repo.events().length, 2);
    assert.equal(core.repo.get(item.id)?.quantity, 99);
    core.repo.save = save;
    assert.equal((await post(correctionUrl, payload)).statusCode, 200);
    await core.app.close();
    core = createApp(db);
    assert.equal((await post(correctionUrl, payload)).statusCode, 200);
    assert.equal(core.repo.get(item.id)?.quantity, 100);
    assert.equal(core.repo.events().length, 3);
    assert.equal(
      (
        await post(correctionUrl, {
          ...payload,
          requestId: crypto.randomUUID(),
        })
      ).statusCode,
      409,
    );
    for (let i = 0; i < 55; i++)
      core.inventory.act(item.id, { type: "consume", quantity: 1 });
    const history = await core.app.inject(`/api/items/${item.id}/events`);
    assert.equal(history.statusCode, 200);
    const events = history.json<InventoryEvent[]>();
    assert.equal(events.length, 58);
    assert.equal(events[0].after.version, 58);
    assert.equal(events.at(-1)?.type, "ITEM_CREATED");
    assert.equal(
      (
        await post(correctionUrl, {
          ...payload,
          requestId: crypto.randomUUID(),
          reason: " ",
        })
      ).statusCode,
      400,
    );
  } finally {
    await core.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
