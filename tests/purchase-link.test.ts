import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createApp } from "../services/kitchen-core/src/app";
import { canonical } from "../services/kitchen-core/src/backups";
import { MockAIProvider, type AIProvider } from "@homestash/ai";
import {
  ShoppingService,
  shoppingRemaining,
  shoppingRevision,
  shoppingReceived,
  type ImageReview,
} from "@homestash/domain";
const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6VBkAAAAASUVORK5CYII=";
const post = (
  core: ReturnType<typeof createApp>,
  url: string,
  payload: object,
) => core.app.inject({ method: "POST", url, payload });
function setup(path = ":memory:") {
  const mock = new MockAIProvider();
  const provider: AIProvider = {
    kind: "purchase-test",
    structuredOutput: (...args) => mock.structuredOutput(...args),
    async recognizeImage() {
      return {
        notes: "核对实收",
        order: { platform: null, purchasedAt: null, status: "pending" },
        candidates: [
          {
            name: "牛奶",
            category: "food",
            quantity: 3,
            unit: "箱",
            evidence: "牛奶3箱",
            confidence: "high",
            bestBeforeAt: null,
            expiresAt: null,
            orderLine: { specification: "每箱12盒", status: "pending" },
          },
        ],
      };
    },
  };
  const core = createApp(path, provider);
  return { core, shopping: new ShoppingService(core.repo) };
}
async function analyze(core: ReturnType<typeof createApp>) {
  const r = await post(core, "/api/intake/images", {
    requestId: crypto.randomUUID(),
    dataUrl: image,
    kind: "order",
  });
  assert.equal(r.statusCode, 200, r.body);
  return r.json<ImageReview>();
}
function receipt(
  review: ImageReview,
  quantity: number,
  link?: { id: string; revision?: number },
  total = 3,
) {
  return {
    requestId: crypto.randomUUID(),
    expectedRevision: review.fulfillment?.revision ?? 1,
    received: true,
    items: [
      {
        candidateId: review.candidates[0].id,
        totalQuantity: total,
        ...(link
          ? {
              shoppingId: link.id,
              shoppingRevision: shoppingRevision(link as never),
            }
          : {}),
        item: { name: "牛奶", quantity, unit: "箱" },
      },
    ],
  };
}
const receive = (
  core: ReturnType<typeof createApp>,
  review: ImageReview,
  body: object,
) => post(core, `/api/intake/images/${review.id}/confirm`, body);

test("订单分批实收同时满足采购余量，不重复创建库存；超出采购计划的实物正常入库", async () => {
  const { core, shopping } = setup();
  try {
    const planned = shopping.add({ name: "牛奶", quantity: 2, unit: "箱" });
    let order = await analyze(core);
    const body = receipt(order, 1, planned);
    const first = await receive(core, order, body);
    assert.equal(first.statusCode, 200, first.body);
    order = first.json();
    let entry = shopping.list()[0];
    assert.equal(shoppingReceived(entry), 1);
    assert.equal(shoppingRemaining(entry), 1);
    assert.equal(entry.checked, false);
    assert.equal(core.repo.list().length, 1);
    assert.equal((await receive(core, order, body)).statusCode, 200);
    assert.equal(core.repo.list().length, 1);
    const final = await receive(core, order, receipt(order, 2, entry));
    assert.equal(final.statusCode, 200, final.body);
    entry = shopping.list()[0];
    assert.equal(entry.checked, true);
    assert.equal(shoppingRemaining(entry), 0);
    assert.equal(shoppingReceived(entry), 2);
    assert.equal(core.repo.list().length, 2);
    assert.equal(
      core.repo.list().reduce((n, i) => n + i.quantity, 0),
      3,
    );
    assert.equal(entry.receipts?.[1].quantity, 1);
    const voice = await post(core, "/api/voice", {
      requestId: crypto.randomUUID(),
      text: "购物清单",
    });
    assert.equal(voice.statusCode, 200);
    assert.match(voice.json().message, /没有待购买/);
    assert.doesNotMatch(JSON.stringify(core.deviceScreen("shopping")), /牛奶/);
  } finally {
    await core.app.close();
  }
});

test("未选择关联不会自动匹配同名清单，显式选择只更新目标项", async () => {
  const { core, shopping } = setup();
  try {
    const a = shopping.add({ name: "牛奶", quantity: 2, unit: "箱" }),
      b = shopping.add(
        { name: "牛奶", quantity: 2, unit: "箱" },
        "recipe:demo",
      );
    let order = await analyze(core);
    order = (await receive(core, order, receipt(order, 1))).json();
    assert.equal(
      shopping.list().some((i) => i.receipts?.length),
      false,
    );
    const linked = await receive(core, order, receipt(order, 1, b));
    assert.equal(linked.statusCode, 200, linked.body);
    assert.equal(
      shoppingReceived(shopping.list().find((i) => i.id === a.id)!),
      0,
    );
    assert.equal(
      shoppingReceived(shopping.list().find((i) => i.id === b.id)!),
      1,
    );
  } finally {
    await core.app.close();
  }
});

test("采购版本、单位和目标存在性校验失败时库存与订单进度一起回滚", async () => {
  const { core, shopping } = setup();
  try {
    const planned = shopping.add({ name: "牛奶", quantity: 2, unit: "箱" }),
      wrong = shopping.add({ name: "牛奶", quantity: 2, unit: "盒" });
    const order = await analyze(core);
    shopping.act(planned.id, "check");
    for (const target of [planned, wrong, { id: crypto.randomUUID() }]) {
      const response = await receive(core, order, receipt(order, 1, target));
      assert.equal(response.statusCode, 409, response.body);
      assert.equal(core.repo.list().length, 0);
      assert.equal(core.repo.events().length, 0);
      assert.equal((await analyze(core)).fulfillment, undefined);
    }
    const saved = core.repo.write.bind(core.repo);
    core.repo.write = (key, value) => {
      if (key === "shopping") throw Error("模拟采购记录保存失败");
      return saved(key, value);
    };
    const response = await receive(
      core,
      order,
      receipt(order, 1, shopping.list()[0]),
    );
    assert.equal(response.statusCode, 502);
    assert.equal(core.repo.list().length, 0);
    assert.equal((await analyze(core)).fulfillment, undefined);
    core.repo.write = saved;
  } finally {
    await core.app.close();
  }
});

test("订单未满足的采购计划可另买后手动确认，版本与回执防重复", async () => {
  const { core, shopping } = setup();
  try {
    const planned = shopping.add({ name: "牛奶", quantity: 3, unit: "箱" });
    const order = await analyze(core);
    assert.equal(
      (await receive(core, order, receipt(order, 1, planned, 1))).statusCode,
      200,
    );
    const before = shopping.list()[0];
    shopping.act(before.id, "check");
    const current = shopping.list()[0];
    const body = {
      requestId: crypto.randomUUID(),
      expectedRevision: shoppingRevision(current),
      item: { name: "牛奶", quantity: 2, unit: "箱" },
    };
    const url = `/api/shopping/${current.id}/receive`;
    assert.equal(
      (
        await post(core, url, {
          ...body,
          expectedRevision: shoppingRevision(before),
        })
      ).statusCode,
      409,
    );
    const result = await post(core, url, body);
    assert.equal(result.statusCode, 200, result.body);
    assert.equal((await post(core, url, body)).statusCode, 200);
    assert.equal(core.repo.list().length, 2);
    assert.equal(shopping.list()[0].checked, true);
    assert.equal(shoppingReceived(shopping.list()[0]), 3);
    assert.equal(
      (await post(core, url, { ...body, requestId: crypto.randomUUID() }))
        .statusCode,
      409,
    );
    assert.equal(core.repo.list().length, 2);
  } finally {
    await core.app.close();
  }
});

test("食谱复核保留已关联计划，抵扣尚未收齐的计划，不重复加购", async () => {
  const { core, shopping } = setup();
  try {
    const planned = shopping.add(
      { name: "牛奶", quantity: 3, unit: "箱" },
      "recipe:demo",
    );
    const order = await analyze(core);
    await receive(core, order, receipt(order, 1, planned));
    shopping.syncRecipe("recipe:demo", [
      { name: "牛奶", quantity: 2, unit: "箱" },
    ]);
    assert.equal(shopping.list().length, 1);
    assert.equal(shoppingRemaining(shopping.list()[0]), 2);
    shopping.syncRecipe("recipe:demo", [
      { name: "牛奶", quantity: 4, unit: "箱" },
    ]);
    assert.equal(shopping.list().length, 2);
    assert.equal(
      shopping.list().filter((i) => !i.receipts?.length)[0].quantity,
      2,
    );
    shopping.syncRecipe("recipe:demo", []);
    assert.equal(shopping.list().length, 1);
    assert.equal(shoppingReceived(shopping.list()[0]), 1);
    assert.throws(() => shopping.act(planned.id, "remove"), /收货历史/);
  } finally {
    await core.app.close();
  }
});

test("采购订单关联跨重启及备份恢复，篡改入库关联和数量拒绝", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hs-purchase-link-"));
  let { core, shopping } = setup(join(dir, "core.db"));
  try {
    const planned = shopping.add({ name: "牛奶", quantity: 2, unit: "箱" });
    let order = await analyze(core);
    order = (await receive(core, order, receipt(order, 1, planned))).json();
    const backup = (await core.app.inject("/api/backups/export")).json();
    await core.app.close();
    ({ core, shopping } = setup(join(dir, "core.db")));
    assert.equal(shoppingRemaining(shopping.list()[0]), 1);
    const invalid = structuredClone(backup);
    invalid.payload.state.find(
      (r: { id: string }) => r.id === "shopping",
    ).data[0].receipts[0].quantity = 2;
    invalid.sha256 = createHash("sha256")
      .update(canonical(invalid.payload))
      .digest("hex");
    assert.equal(
      (await post(core, "/api/backups/validate", invalid)).statusCode,
      409,
    );
    const preview = await post(core, "/api/backups/validate", backup);
    assert.equal(preview.statusCode, 200, preview.body);
    const restore = await post(core, "/api/backups/restore", {
      requestId: crypto.randomUUID(),
      confirmation: "覆盖恢复",
      currentFingerprint: preview.json().currentFingerprint,
      backup,
    });
    assert.equal(restore.statusCode, 200, restore.body);
    const response = await receive(
      core,
      order,
      receipt(order, 1, shopping.list()[0]),
    );
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(shoppingRemaining(shopping.list()[0]), 0);
    assert.equal(core.repo.list().length, 2);
  } finally {
    await core.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
