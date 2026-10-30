import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../services/kitchen-core/src/app";
import { deviceReply } from "../services/kitchen-core/src/device-reply";

test("小冰按位置合并真实库存、同名同单位批次相加，不重复位置", async () => {
  const core = createApp(":memory:");
  try {
    core.inventory.create({ name: "番茄", quantity: 6, unit: "个" });
    core.inventory.create({ name: "番茄", quantity: 4, unit: "个" });
    core.inventory.create({ name: "香蕉", quantity: 2, unit: "根" });
    core.inventory.create({
      name: "饺子",
      quantity: 1,
      unit: "袋",
      locationId: "freezer",
    });
    const before = core.repo.list();
    const text = deviceReply(
      {
        intent: { intent: "inventory_query", filter: "all" },
        message: "现有库存",
        items: before,
      },
      core.repo.locations(),
    );
    assert.match(
      text,
      /有哒！冷藏室里有10个番茄、2根香蕉；冷冻室里有1袋饺子。/,
    );
    assert.equal(text.match(/冷藏室/g)?.length, 1);
    assert.deepEqual(core.repo.list(), before);
  } finally {
    await core.app.close();
  }
});
test("播报简短但保留日期警示，不吞掉确认扣减要求", () => {
  const warning = deviceReply(
    {
      intent: { intent: "inventory_query", filter: "expired" },
      message: "日期已过",
      items: [
        {
          name: "牛奶",
          quantity: 1,
          unit: "瓶",
          locationId: "fridge",
        } as never,
      ],
    },
    [{ id: "fridge", name: "冷藏室" }],
  );
  assert.match(warning, /日期已经过/);
  assert.match(warning, /不能替代实际状态检查/);
  assert.match(
    deviceReply(
      {
        intent: { intent: "cooking" },
        message: "做完后请确认扣减，尚未扣减。",
      },
      [],
    ),
    /请确认扣减，尚未扣减/,
  );
});
