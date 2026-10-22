import { createHash } from "node:crypto";
import { canonical } from "../services/kitchen-core/src/backups";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createApp } from "../services/kitchen-core/src/app";
import {
  MockAIProvider,
  OpenAICompatibleProvider,
  type AIProvider,
} from "@homestash/ai";
import {
  OrderRecognition,
  type ImageRecognition,
  type ImageReview,
  ItemInput,
} from "@homestash/domain";
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC1lEQVR42mP8/x8AAusB9Wl6VBkAAAAASUVORK5CYII=";
const dataUrl = "data:image/png;base64," + png;
function fixture() {
  const result: ImageRecognition = {
    notes: "套餐不自动拆分，实际收货后核对",
    order: {
      platform: "示例商店",
      purchasedAt: "2026-10-20",
      status: "pending",
    },
    candidates: [
      {
        name: "牛奶",
        category: "food",
        quantity: 2,
        unit: "箱",
        evidence: "牛奶 一箱12盒 ×2 待收货",
        confidence: "high",
        bestBeforeAt: null,
        expiresAt: null,
        orderLine: { specification: "一箱12盒，每盒250ml", status: "pending" },
      },
      {
        name: "草莓",
        category: "food",
        quantity: 1,
        unit: "盒",
        evidence: "草莓 1盒 已退款",
        confidence: "high",
        bestBeforeAt: null,
        expiresAt: null,
        orderLine: { specification: "500克/盒", status: "refunded" },
      },
    ],
  };
  let calls = 0,
    fail = false;
  const mock = new MockAIProvider();
  const provider: AIProvider = {
    kind: "order-fixture",
    structuredOutput: (...a) => mock.structuredOutput(...a),
    async recognizeImage(image, kind) {
      assert.equal(image, dataUrl);
      assert.equal(kind, "order");
      calls++;
      if (fail) throw Error("视觉接口失败");
      return structuredClone(result);
    },
  };
  return {
    provider,
    result,
    get calls() {
      return calls;
    },
    set fail(value: boolean) {
      fail = value;
    },
  };
}
const post = (
  core: ReturnType<typeof createApp>,
  url: string,
  payload: object,
) => core.app.inject({ method: "POST", url, payload });
const analyze = (
  core: ReturnType<typeof createApp>,
  requestId = crypto.randomUUID(),
) => post(core, "/api/intake/images", { requestId, dataUrl, kind: "order" });
const selection = (review: ImageReview, index = 0) => [
  {
    candidateId: review.candidates[index].id,
    item: ItemInput.parse({
      name: review.candidates[index].name,
      quantity: 2,
      unit: "箱",
      purchasedAt: "2026-10-21",
      locationId: "pantry",
      source: "manual",
    }),
  },
];

test("订单必填结构与空候选校验，不允许地址或订单号字段", () => {
  const result = fixture().result;
  assert.ok(OrderRecognition.safeParse(result).success);
  assert.ok(
    !OrderRecognition.safeParse({ ...result, order: undefined }).success,
  );
  assert.ok(
    !OrderRecognition.safeParse({
      ...result,
      order: { ...result.order, address: "不应提取" },
    }).success,
  );
  assert.ok(
    !OrderRecognition.safeParse({
      ...result,
      candidates: [{ ...result.candidates[0], orderLine: undefined }],
    }).success,
  );
  assert.ok(OrderRecognition.safeParse({ ...result, candidates: [] }).success);
});

test("订单只生成候选；同图不同请求和重启复用，收货确认后按实收单位入库且重放不重复", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hs-order-"));
  const db = join(dir, "core.db");
  const f = fixture();
  let core = createApp(db, f.provider);
  try {
    const first = await analyze(core);
    assert.equal(first.statusCode, 200, first.body);
    const review = first.json<ImageReview>();
    assert.equal(core.repo.list().length, 0);
    assert.equal(review.kind, "order");
    assert.equal((await analyze(core)).json().id, review.id);
    assert.equal(f.calls, 1);
    const entry = (await core.app.inject("/api/intake/reviews")).json()[0];
    assert.equal(entry.imageKind, "order");
    await core.app.close();
    core = createApp(db, f.provider);
    assert.equal((await analyze(core)).json().id, review.id);
    assert.equal(f.calls, 1);
    const url = `/api/intake/images/${review.id}/confirm`;
    const items = selection(review);
    const noReceipt = await post(core, url, {
      requestId: crypto.randomUUID(),
      items,
    });
    assert.equal(noReceipt.statusCode, 409);
    assert.equal(core.repo.list().length, 0);
    const payload = { requestId: crypto.randomUUID(), items, received: true };
    const responses = await Promise.all([
      post(core, url, payload),
      post(core, url, payload),
    ]);
    assert.deepEqual(
      responses.map((r) => r.statusCode),
      [200, 200],
    );
    const item = core.repo.list()[0];
    assert.equal(item.source, "order");
    assert.equal(item.quantity, 2);
    assert.equal(item.unit, "箱");
    assert.equal(item.purchasedAt, "2026-10-21");
    const metadata = item.metadata.imageIntake as {
      receivedConfirmed: boolean;
      orderLine: { specification: string };
    };
    assert.equal(metadata.receivedConfirmed, true);
    assert.equal(metadata.orderLine.specification, "一箱12盒，每盒250ml");
    assert.equal(core.repo.events().length, 1);
    assert.equal((await analyze(core)).json().status, "confirmed");
    assert.equal(f.calls, 1);
    assert.equal(
      (await post(core, url, { ...payload, requestId: crypto.randomUUID() }))
        .statusCode,
      200,
    );
    assert.equal(core.repo.events().length, 1);
    const content = JSON.stringify(
      core.repo.sqlite.prepare("SELECT data FROM app_state").all(),
    );
    assert.ok(!content.includes(png));
  } finally {
    await core.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("退款、取消与伪造收货确认不能入库；取消候选后可重新识别", async () => {
  const f = fixture(),
    core = createApp(":memory:", f.provider);
  try {
    const review = (await analyze(core)).json<ImageReview>();
    const url = `/api/intake/images/${review.id}/confirm`;
    const refund = await post(core, url, {
      requestId: crypto.randomUUID(),
      items: selection(review, 1),
      received: true,
    });
    assert.equal(refund.statusCode, 409);
    assert.equal(core.repo.events().length, 0);
    assert.equal(
      (
        await post(core, url, {
          requestId: crypto.randomUUID(),
          items: selection(review),
          received: "true",
        })
      ).statusCode,
      400,
    );
    await post(core, `/api/intake/images/${review.id}/cancel`, {});
    assert.equal(
      (
        await post(core, url, {
          requestId: crypto.randomUUID(),
          items: selection(review),
          received: true,
        })
      ).statusCode,
      409,
    );
    f.result.order!.status = "cancelled";
    const next = (await analyze(core)).json<ImageReview>();
    assert.notEqual(next.id, review.id);
    assert.equal(
      (
        await post(core, `/api/intake/images/${next.id}/confirm`, {
          requestId: crypto.randomUUID(),
          items: selection(next),
          received: true,
        })
      ).statusCode,
      409,
    );
    assert.equal(core.repo.list().length, 0);
  } finally {
    await core.app.close();
  }
});

test("订单视觉失败保留模式供重试；相同请求ID不能切换识别模式", async () => {
  const f = fixture(),
    core = createApp(":memory:", f.provider);
  const id = crypto.randomUUID();
  try {
    f.fail = true;
    assert.equal((await analyze(core, id)).statusCode, 502);
    const entry = (await core.app.inject("/api/intake/reviews")).json()[0];
    assert.equal(entry.imageKind, "order");
    assert.equal(entry.status, "failed");
    f.fail = false;
    assert.equal((await analyze(core, id)).statusCode, 200);
    assert.ok(
      (await core.app.inject("/api/intake/reviews"))
        .json()
        .every((r: { status: string }) => r.status !== "failed"),
    );
    assert.equal(
      (
        await post(core, "/api/intake/images", {
          requestId: id,
          dataUrl,
          kind: "photo",
        })
      ).statusCode,
      409,
    );
    assert.equal(core.repo.list().length, 0);
  } finally {
    await core.app.close();
  }
});

test("订单候选与来源随备份恢复；恢复后同图仍去重", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hs-order-backup-"));
  const f = fixture(),
    core = createApp(join(dir, "core.db"), f.provider);
  try {
    const review = (await analyze(core)).json<ImageReview>();
    await post(core, `/api/intake/images/${review.id}/confirm`, {
      requestId: crypto.randomUUID(),
      items: selection(review),
      received: true,
    });
    const backup = (await core.app.inject("/api/backups/export")).json();
    const invalid = structuredClone(backup);
    const invalidReview = invalid.payload.state.find(
      (r: { id: string }) => r.id === `image-intake:${review.id}`,
    );
    delete invalidReview.data.candidates[0].orderLine;
    invalid.sha256 = createHash("sha256")
      .update(canonical(invalid.payload))
      .digest("hex");
    assert.equal(
      (await post(core, "/api/backups/validate", invalid)).statusCode,
      400,
    );
    const preview = (await post(core, "/api/backups/validate", backup)).json();
    const response = await post(core, "/api/backups/restore", {
      requestId: crypto.randomUUID(),
      confirmation: "覆盖恢复",
      currentFingerprint: preview.currentFingerprint,
      backup,
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal((await analyze(core)).json().id, review.id);
    assert.equal(core.repo.list()[0].source, "order");
    assert.equal(core.repo.events().length, 1);
    assert.equal(f.calls, 1);
  } finally {
    await core.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("OpenAI兼容视觉接口按订单Schema发送真实HTTP，缺失订单字段拒绝", async () => {
  const result = fixture().result;
  let invalid = false;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += String(chunk);
    const body = JSON.parse(raw);
    assert.equal(body.model, "vision-fixture");
    assert.equal(body.messages[1].content[1].image_url.url, dataUrl);
    assert.match(body.messages[0].content, /订单截图/);
    assert.match(body.messages[0].content, /净含量不是购买数量/);
    assert.match(body.messages[0].content, /不要提取姓名/);
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify(
                invalid ? { notes: "缺失订单", candidates: [] } : result,
              ),
            },
          },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const provider = new OpenAICompatibleProvider(
    {
      mode: "openai-compatible",
      baseUrl: `http://127.0.0.1:${address.port}`,
      model: "text-fixture",
      visionModel: "vision-fixture",
    },
    "",
  );
  try {
    assert.deepEqual(await provider.recognizeImage(dataUrl, "order"), result);
    invalid = true;
    await assert.rejects(provider.recognizeImage(dataUrl, "order"));
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
});
