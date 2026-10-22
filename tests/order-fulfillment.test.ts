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
  orderFulfillment,
  remainingOrderQuantity,
  type ImageRecognition,
  type ImageReview,
} from "@homestash/domain";
const dataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6VBkAAAAASUVORK5CYII=";
const post = (
  core: ReturnType<typeof createApp>,
  url: string,
  payload: object,
) => core.app.inject({ method: "POST", url, payload });
const analyze = async (core: ReturnType<typeof createApp>) => {
  const response = await post(core, "/api/intake/images", {
    requestId: crypto.randomUUID(),
    dataUrl,
    kind: "order",
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json<ImageReview>();
};
function fixture() {
  const mock = new MockAIProvider();
  const result: ImageRecognition = {
    notes: "实收后确认",
    order: { platform: "测试商店", purchasedAt: null, status: "pending" },
    candidates: [
      {
        name: "牛奶",
        category: "food",
        quantity: 3,
        unit: "箱",
        evidence: "牛奶3箱，每箱12盒",
        confidence: "high",
        bestBeforeAt: null,
        expiresAt: null,
        orderLine: { specification: "每箱12盒", status: "pending" },
      },
      {
        name: "草莓",
        category: "food",
        quantity: 1,
        unit: "盒",
        evidence: "草莓1盒已退款",
        confidence: "high",
        bestBeforeAt: null,
        expiresAt: null,
        orderLine: { specification: "500克", status: "refunded" },
      },
    ],
  };
  const provider: AIProvider = {
    kind: "partial-fixture",
    structuredOutput: (...a) => mock.structuredOutput(...a),
    async recognizeImage() {
      return structuredClone(result);
    },
  };
  return { provider, result };
}
const body = (
  review: ImageReview,
  quantity: number,
  total = 3,
  index = 0,
  unit = "箱",
) => ({
  requestId: crypto.randomUUID(),
  expectedRevision: orderFulfillment(review).revision,
  received: true,
  items: [
    {
      candidateId: review.candidates[index].id,
      totalQuantity: total,
      item: { name: review.candidates[index].name, quantity, unit },
    },
  ],
});
const receive = (
  core: ReturnType<typeof createApp>,
  review: ImageReview,
  payload: object,
) => post(core, `/api/intake/images/${review.id}/confirm`, payload);

test("订单分批1箱和2箱分别入库，跨重启续做；库存消耗不减少累计收货", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hs-partial-"));
  const f = fixture();
  let core = createApp(join(dir, "core.db"), f.provider);
  try {
    const initial = await analyze(core);
    const payload = body(initial, 1);
    const first = await receive(core, initial, payload);
    assert.equal(first.statusCode, 200, first.body);
    const progress = first.json<ImageReview>();
    assert.equal(progress.status, "pending");
    assert.equal(progress.fulfillment?.revision, 2);
    assert.equal(remainingOrderQuantity(progress.fulfillment!.lines[0]), 2);
    assert.deepEqual((await receive(core, initial, payload)).json(), progress);
    assert.equal(core.repo.events().length, 1);
    core.inventory.act(core.repo.list()[0].id, {
      type: "consume",
      quantity: 1,
    });
    assert.equal(
      (await core.app.inject("/api/intake/reviews")).json()[0].status,
      "pending",
    );
    await core.app.close();
    core = createApp(join(dir, "core.db"), f.provider);
    const reopened = await analyze(core);
    assert.equal(reopened.id, initial.id);
    assert.equal(reopened.fulfillment?.lines[0].receivedQuantity, 1);
    const second = await receive(core, reopened, body(reopened, 2));
    assert.equal(second.statusCode, 200, second.body);
    assert.equal(second.json().status, "confirmed");
    assert.equal(second.json().confirmedItems.length, 2);
    assert.equal(second.json().fulfillment.lines[0].receivedQuantity, 3);
    assert.deepEqual(
      core.repo
        .list()
        .map((i) => i.quantity)
        .sort(),
      [0, 2],
    );
  } finally {
    await core.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("收货版本阻止双窗口和换请求ID重复入库，超量及单位更换拒绝", async () => {
  const core = createApp(":memory:", fixture().provider);
  try {
    const initial = await analyze(core);
    const payload = body(initial, 1);
    const replies = await Promise.all([
      receive(core, initial, payload),
      receive(core, initial, { ...payload, requestId: crypto.randomUUID() }),
    ]);
    assert.deepEqual(
      replies.map((r) => r.statusCode),
      [200, 409],
    );
    const current = replies[0].json<ImageReview>();
    const baseline = core.repo.list();
    assert.equal(
      (await receive(core, current, body(current, 3))).statusCode,
      409,
    );
    assert.equal(
      (await receive(core, current, body(current, 1, 3, 0, "盒"))).statusCode,
      409,
    );
    assert.equal(
      (await receive(core, current, body(current, 1, 0.5))).statusCode,
      409,
    );
    const missingRevision = body(current, 1);
    const { expectedRevision, ...legacy } = missingRevision;
    void expectedRevision;
    assert.equal((await receive(core, current, legacy)).statusCode, 409);
    assert.deepEqual(core.repo.list(), baseline);
    const corrected = await receive(core, current, body(current, 3, 4));
    assert.equal(corrected.statusCode, 200, corrected.body);
    assert.equal(corrected.json().fulfillment.lines[0].expectedQuantity, 4);
    assert.equal(corrected.json().status, "confirmed");
  } finally {
    await core.app.close();
  }
});

test("未知订单总量必须先核对；小数收货累计不留下浮点尾差", async () => {
  const f = fixture();
  f.result.candidates[0].quantity = null;
  f.result.candidates[0].unit = null;
  const core = createApp(":memory:", f.provider);
  try {
    const initial = await analyze(core);
    const payload = body(initial, 0.1, 0.3, 0, "斤");
    const { totalQuantity, ...line } = payload.items[0];
    void totalQuantity;
    assert.equal(
      (await receive(core, initial, { ...payload, items: [line] })).statusCode,
      409,
    );
    assert.equal(
      (await receive(core, initial, body(initial, 0.0000001, 0.3, 0, "斤")))
        .statusCode,
      400,
    );
    const first = await receive(core, initial, payload);
    assert.equal(first.statusCode, 200, first.body);
    const second = await receive(
      core,
      first.json(),
      body(first.json(), 0.2, 0.3, 0, "斤"),
    );
    assert.equal(second.statusCode, 200, second.body);
    assert.equal(second.json().status, "confirmed");
    assert.equal(second.json().fulfillment.lines[0].receivedQuantity, 0.3);
    assert.equal(remainingOrderQuantity(second.json().fulfillment.lines[0]), 0);
  } finally {
    await core.app.close();
  }
});

test("多行批次保存失败时收货进度与库存一起回滚，原请求可重试", async () => {
  const f = fixture();
  f.result.candidates[1].orderLine!.status = "pending";
  const core = createApp(":memory:", f.provider);
  try {
    const initial = await analyze(core);
    const payload = body(initial, 1);
    payload.items.push(body(initial, 1, 1, 1, "盒").items[0]);
    const save = core.repo.save.bind(core.repo);
    let writes = 0;
    core.repo.save = (...args) => {
      if (++writes === 2) throw Error("模拟第二批保存失败");
      save(...args);
    };
    assert.equal((await receive(core, initial, payload)).statusCode, 502);
    assert.equal(core.repo.list().length, 0);
    assert.equal(core.repo.events().length, 0);
    assert.equal((await analyze(core)).fulfillment, undefined);
    core.repo.save = save;
    assert.equal((await receive(core, initial, payload)).statusCode, 200);
    assert.equal(core.repo.list().length, 2);
  } finally {
    await core.app.close();
  }
});

test("结束剩余收货保留已入库批次，同图不重新入库，关闭动作幂等及冲突校验", async () => {
  const core = createApp(":memory:", fixture().provider);
  try {
    const initial = await analyze(core);
    const first = (
      await receive(core, initial, body(initial, 1))
    ).json<ImageReview>();
    const baseline = core.repo.list();
    const url = `/api/intake/images/${initial.id}/finish-order`;
    const payload = {
      requestId: crypto.randomUUID(),
      expectedRevision: 1,
      confirmation: "结束剩余收货",
    };
    assert.equal((await post(core, url, payload)).statusCode, 409);
    payload.expectedRevision = 2;
    const finish = await post(core, url, payload);
    assert.equal(finish.statusCode, 200, finish.body);
    assert.equal(finish.json().status, "confirmed");
    assert.ok(
      finish
        .json()
        .fulfillment.lines.every((l: { closed: boolean }) => l.closed),
    );
    assert.deepEqual((await post(core, url, payload)).json(), finish.json());
    assert.equal((await analyze(core)).id, first.id);
    assert.equal(
      (await post(core, `/api/intake/images/${initial.id}/cancel`, {}))
        .statusCode,
      409,
    );
    assert.deepEqual(core.repo.list(), baseline);
  } finally {
    await core.app.close();
  }
});

test("部分收货备份恢复保留累计和剩余，篡改累计或取消状态拒绝", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hs-partial-backup-"));
  const core = createApp(join(dir, "core.db"), fixture().provider);
  try {
    const initial = await analyze(core);
    await receive(core, initial, body(initial, 1));
    const backup = (await core.app.inject("/api/backups/export")).json();
    for (const mutate of [
      (r: { fulfillment: { lines: { receivedQuantity: number }[] } }) => {
        r.fulfillment.lines[0].receivedQuantity = 2;
      },
      (r: { status: string }) => {
        r.status = "cancelled";
      },
    ]) {
      const invalid = structuredClone(backup);
      const entry = invalid.payload.state.find(
        (r: { id: string }) => r.id === `image-intake:${initial.id}`,
      );
      mutate(entry.data);
      invalid.sha256 = createHash("sha256")
        .update(canonical(invalid.payload))
        .digest("hex");
      assert.equal(
        (await post(core, "/api/backups/validate", invalid)).statusCode,
        409,
      );
    }
    const preview = (await post(core, "/api/backups/validate", backup)).json();
    const restored = await post(core, "/api/backups/restore", {
      requestId: crypto.randomUUID(),
      confirmation: "覆盖恢复",
      currentFingerprint: preview.currentFingerprint,
      backup,
    });
    assert.equal(restored.statusCode, 200, restored.body);
    const reopened = await analyze(core);
    assert.equal(reopened.fulfillment?.revision, 2);
    assert.equal(reopened.fulfillment?.lines[0].receivedQuantity, 1);
    assert.equal(
      (await receive(core, reopened, body(reopened, 2))).statusCode,
      200,
    );
    assert.equal(core.repo.list().length, 2);
  } finally {
    await core.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
