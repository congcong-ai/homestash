import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../services/kitchen-core/src/app";
import { MockAIProvider } from "@homestash/ai";
import type {
  IntakeEntry,
  ShoppingItem,
  ImageReview,
  ImageRecognition,
} from "@homestash/domain";
import { registerBarcodeIntake } from "../services/kitchen-core/src/barcode-intake";
import Fastify from "fastify";
import { SQLiteRepository } from "@homestash/database";
import { InventoryService } from "@homestash/domain";
import { registerIntakeCenter } from "../services/kitchen-core/src/intake-center";

const dataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC1lEQVR42mP8/x8AAusB9Wl6VBkAAAAASUVORK5CYII=";
const recognition: ImageRecognition = {
  notes: "小票候选",
  candidates: [
    {
      name: "番茄",
      category: "food",
      quantity: 2,
      unit: "个",
      evidence: "小票：番茄2个",
      confidence: "high",
      bestBeforeAt: null,
      expiresAt: null,
    },
  ],
};
const post = (
  core: ReturnType<typeof createApp>,
  url: string,
  payload: object,
) => core.app.inject({ method: "POST", url, payload });
async function add(core: ReturnType<typeof createApp>, name = "番茄") {
  const reply = await post(core, "/api/shopping", {
    action: "add",
    requestId: crypto.randomUUID(),
    item: { name, quantity: 2, unit: "个" },
  });
  assert.equal(reply.statusCode, 200, reply.body);
  return reply.json<ShoppingItem[]>()[0];
}
async function check(core: ReturnType<typeof createApp>, id: string) {
  const reply = await post(core, "/api/shopping", {
    action: "check",
    id,
    requestId: crypto.randomUUID(),
  });
  assert.equal(reply.statusCode, 200, reply.body);
}

test("采购确认按实物新建批次；未买、非法位置和保存失败不写入，重试/重启不重复入库", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hs-shopping-"));
  let core = createApp(join(dir, "core.db"));
  try {
    const entry = await add(core);
    const url = `/api/shopping/${entry.id}/receive`;
    const item = {
      name: "番茄",
      category: "food",
      quantity: 3,
      unit: "个",
      locationId: "pantry",
      purchasedAt: "2026-10-21",
      expiresAt: "2026-10-25",
    };
    const payload = { requestId: crypto.randomUUID(), item };
    assert.equal((await post(core, url, payload)).statusCode, 409);
    await check(core, entry.id);
    assert.equal(core.repo.list().length, 0);
    assert.equal(
      (
        await post(core, url, {
          ...payload,
          item: { ...item, locationId: "missing" },
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (await post(core, url, { ...payload, item: { ...item, quantity: 0 } }))
        .statusCode,
      400,
    );
    const write = core.repo.write.bind(core.repo);
    core.repo.write = (key, value) => {
      if (key === "shopping") throw Error("模拟购物状态写失败");
      write(key, value);
    };
    assert.equal((await post(core, url, payload)).statusCode, 502);
    assert.equal(core.repo.list().length, 0);
    assert.equal(core.repo.events().length, 0);
    core.repo.write = write;
    const responses = await Promise.all([
      post(core, url, payload),
      post(core, url, payload),
      post(core, url, { ...payload, requestId: crypto.randomUUID() }),
    ]);
    assert.deepEqual(
      responses.map((r) => r.statusCode),
      [200, 200, 200],
    );
    assert.equal(core.repo.list().length, 1);
    assert.equal(core.repo.events().length, 1);
    const saved = core.repo.list()[0];
    assert.equal(saved.quantity, 3);
    assert.equal(saved.locationId, "pantry");
    assert.equal(saved.expiresAt, item.expiresAt);
    assert.equal((saved.metadata.shopping as { id: string }).id, entry.id);
    assert.equal(
      (
        await post(core, url, {
          ...payload,
          requestId: crypto.randomUUID(),
          item: { ...item, quantity: 4 },
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await post(core, "/api/shopping", {
          action: "uncheck",
          id: entry.id,
          requestId: crypto.randomUUID(),
        })
      ).statusCode,
      409,
    );
    await core.app.close();
    core = createApp(join(dir, "core.db"));
    assert.equal(
      (await post(core, url, { ...payload, requestId: crypto.randomUUID() }))
        .statusCode,
      200,
    );
    assert.equal(core.repo.events().length, 1);
    assert.equal(
      (await core.app.inject("/api/intake/reviews")).json<IntakeEntry[]>()[0]
        .status,
      "confirmed",
    );
    assert.match(
      (await core.app.inject("/api/intake/reviews")).json<IntakeEntry[]>()[0]
        .note,
      /3个/,
    );
    core.inventory.act(saved.id, { type: "consume", quantity: 1 });
    assert.match(
      (await core.app.inject("/api/intake/reviews")).json<IntakeEntry[]>()[0]
        .note,
      /3个/,
    );
    await post(core, "/api/shopping", {
      action: "remove",
      id: entry.id,
      requestId: crypto.randomUUID(),
    });
    assert.equal(core.repo.list().length, 1);
  } finally {
    await core.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("待确认汇总跨重启保留早期待办、购物和照片/小票/条码；取消和确认后进入历史", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hs-reviews-"));
  const mock = new MockAIProvider();
  const provider = {
    kind: "test",
    structuredOutput: mock.structuredOutput.bind(mock),
    recognizeImage: async () => recognition,
  };
  let core = createApp(join(dir, "core.db"), provider);
  try {
    const entry = await add(core);
    await check(core, entry.id);
    const image = (
      await post(core, "/api/intake/images", {
        requestId: crypto.randomUUID(),
        dataUrl,
      })
    ).json<ImageReview>();
    for (let i = 0; i < 23; i++) {
      const response = await post(core, "/api/intake/barcodes", {
        requestId: crypto.randomUUID(),
        barcode: "036000291452",
      });
      assert.equal(response.statusCode, 200, response.body);
    }
    let queue = (await core.app.inject("/api/intake/reviews")).json<
      IntakeEntry[]
    >();
    assert.equal(queue.length, 25);
    assert.equal(
      queue.every((r) => r.status === "pending"),
      true,
    );
    assert.equal(
      (await core.app.inject("/api/intake/barcodes")).json().reviews.length,
      23,
    );
    assert.equal(core.repo.list().length, 0);
    const barcode = queue.find((r) => r.kind === "barcode")!;
    await post(core, `/api/intake/barcodes/${barcode.id}/cancel`, {});
    const response = await post(
      core,
      `/api/intake/images/${image.id}/confirm`,
      {
        requestId: crypto.randomUUID(),
        items: [
          {
            candidateId: image.candidates[0].id,
            item: { name: "番茄", quantity: 2 },
          },
        ],
      },
    );
    assert.equal(response.statusCode, 200, response.body);
    await core.app.close();
    core = createApp(join(dir, "core.db"), provider);
    queue = (await core.app.inject("/api/intake/reviews")).json();
    assert.equal(queue.filter((r) => r.status === "pending").length, 23);
    assert.equal(queue.find((r) => r.id === barcode.id)?.status, "cancelled");
    assert.equal(queue.find((r) => r.id === image.id)?.status, "confirmed");
    assert.equal(core.repo.list().length, 1);
  } finally {
    await core.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("图片服务失败不泄露原图/响应，重启后保留失败入口，同请求重试成功移除失败记录", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hs-retry-"));
  let fail = true;
  const mock = new MockAIProvider();
  const provider = {
    kind: "test",
    structuredOutput: mock.structuredOutput.bind(mock),
    recognizeImage: async () => {
      if (fail) throw Error("secret-upstream-response");
      return recognition;
    },
  };
  let core = createApp(join(dir, "core.db"), provider);
  try {
    const payload = { requestId: crypto.randomUUID(), dataUrl };
    assert.equal(
      (await post(core, "/api/intake/images", payload)).statusCode,
      502,
    );
    const rows = JSON.stringify(
      core.repo.sqlite.prepare("SELECT data FROM app_state").all(),
    );
    assert.equal(rows.includes("secret-upstream-response"), false);
    assert.equal(rows.includes(dataUrl.slice(30)), false);
    await core.app.close();
    core = createApp(join(dir, "core.db"), provider);
    assert.equal(
      (await core.app.inject("/api/intake/reviews")).json<IntakeEntry[]>()[0]
        .status,
      "failed",
    );
    fail = false;
    assert.equal(
      (await post(core, "/api/intake/images", payload)).statusCode,
      200,
    );
    const entries = (await core.app.inject("/api/intake/reviews")).json<
      IntakeEntry[]
    >();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].status, "pending");
    assert.equal(core.repo.list().length, 0);
  } finally {
    await core.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("条码失败可用原请求重试或忽略；不保存服务错误详情", async () => {
  const repo = new SQLiteRepository(":memory:");
  const app = Fastify();
  let fail = true;
  registerBarcodeIntake(
    app,
    repo,
    new InventoryService(repo),
    async (_key, _body, work) => {
      const commit = await work();
      return repo.transaction(commit);
    },
    {
      kind: "test",
      lookup: async () => {
        if (fail) throw Error("private-key");
        return null;
      },
    },
  );
  registerIntakeCenter(app, repo);
  const payload = { requestId: crypto.randomUUID(), barcode: "036000291452" };
  const lookup = () =>
    app.inject({ method: "POST", url: "/api/intake/barcodes", payload });
  try {
    assert.equal((await lookup()).statusCode, 500);
    let entries = (await app.inject("/api/intake/reviews")).json<
      IntakeEntry[]
    >();
    assert.equal(entries[0].barcode, payload.barcode);
    assert.equal(JSON.stringify(entries).includes("private-key"), false);
    fail = false;
    assert.equal((await lookup()).statusCode, 200);
    entries = (await app.inject("/api/intake/reviews")).json();
    assert.equal(
      entries.some((r) => r.status === "failed"),
      false,
    );
    fail = true;
    payload.requestId = crypto.randomUUID();
    await lookup();
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/api/intake/failures/barcode/${payload.requestId}/dismiss`,
          payload: {},
        })
      ).statusCode,
      200,
    );
    assert.equal(repo.read<unknown[]>("intake-failures", []).length, 0);
    assert.equal(repo.list().length, 0);
  } finally {
    await app.close();
    repo.close();
  }
});
