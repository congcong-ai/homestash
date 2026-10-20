import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createApp } from "../services/kitchen-core/src/app";
import { MockAIProvider, OpenAICompatibleProvider } from "@homestash/ai";
import { ItemInput, type ImageRecognition } from "@homestash/domain";
import { validateImage } from "../services/kitchen-core/src/image-intake";
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6VBkAAAAASUVORK5CYII=";
const dataUrl = `data:image/png;base64,${png}`;
const result: ImageRecognition = {
  notes: "仅候选，尚未入库",
  candidates: [
    {
      name: "西红柿",
      category: "food",
      quantity: 2,
      unit: "个",
      evidence: "小票写有西红柿 2个",
      confidence: "high",
      bestBeforeAt: null,
      expiresAt: null,
    },
    {
      name: "草莓",
      category: "food",
      quantity: null,
      unit: null,
      evidence: "图片有草莓，包装数量看不清",
      confidence: "low",
      bestBeforeAt: null,
      expiresAt: null,
    },
  ],
};
const post = (
  core: ReturnType<typeof createApp>,
  url: string,
  payload: unknown,
) => core.app.inject({ method: "POST", url, payload: payload as object });
function fixture() {
  let calls = 0;
  const mock = new MockAIProvider();
  return {
    get calls() {
      return calls;
    },
    provider: {
      kind: "vision-test",
      structuredOutput: (t) => mock.structuredOutput(t),
      async recognizeImage() {
        calls++;
        return result;
      },
    } satisfies import("@homestash/ai").AIProvider,
  };
}
test("图片识别仅保存候选；跨重启编辑确认、并发重试和新请求重放均不重复入库", async () => {
  const dir = await mkdtemp(join(tmpdir(), "homestash-image-"));
  const db = join(dir, "core.db");
  const f = fixture();
  let core = createApp(db, f.provider);
  try {
    const analyze = { requestId: crypto.randomUUID(), dataUrl };
    const first = await post(core, "/api/intake/images", analyze);
    assert.equal(first.statusCode, 200, first.body);
    const review = first.json();
    assert.equal(review.status, "pending");
    assert.equal(review.candidates[0].name, "番茄");
    assert.equal(review.candidates[1].quantity, null);
    assert.deepEqual(
      (await post(core, "/api/intake/images", analyze)).json(),
      review,
    );
    assert.equal(f.calls, 1);
    assert.equal(core.repo.list().length, 0);
    assert.equal(core.repo.events().length, 0);
    const rows = core.repo.sqlite
      .prepare("SELECT data FROM app_state")
      .all() as { data: string }[];
    assert.ok(rows.every((row) => !row.data.includes(png)));
    await core.app.close();
    core = createApp(db, f.provider);
    assert.equal(
      (await core.app.inject("/api/intake/images")).json()[0].id,
      review.id,
    );
    const selection = [
      {
        candidateId: review.candidates[0].id,
        item: {
          name: "番茄",
          category: "food",
          quantity: 3,
          unit: "个",
          locationId: "pantry",
          expiresAt: "2099-01-01",
        },
      },
    ];
    const payload = { requestId: crypto.randomUUID(), items: selection };
    const url = `/api/intake/images/${review.id}/confirm`;
    const replies = await Promise.all([
      post(core, url, payload),
      post(core, url, payload),
    ]);
    assert.deepEqual(
      replies.map((r) => r.statusCode),
      [200, 200],
    );
    assert.equal(core.repo.list().length, 1);
    const item = core.repo.list()[0];
    assert.equal(item.quantity, 3);
    assert.equal(item.locationId, "pantry");
    assert.equal(item.source, "camera");
    assert.equal(item.expiresAt, "2099-01-01");
    assert.equal(core.repo.events().length, 1);
    assert.equal(
      (item.metadata.imageIntake as { evidence: string }).evidence,
      result.candidates[0].evidence,
    );
    assert.equal(
      (await post(core, url, { ...payload, requestId: crypto.randomUUID() }))
        .statusCode,
      200,
    );
    assert.equal(core.repo.events().length, 1);
    assert.equal(
      (await post(core, "/api/intake/images", analyze)).json().status,
      "confirmed",
    );
    assert.equal(
      (
        await post(core, url, {
          ...payload,
          requestId: crypto.randomUUID(),
          items: [
            { ...selection[0], item: { ...selection[0].item, quantity: 4 } },
          ],
        })
      ).statusCode,
      409,
    );
  } finally {
    await core.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("取消、候选越权、空选择和批量失败不污染库存，失败后保留候选供重试", async () => {
  const core = createApp(":memory:", fixture().provider);
  try {
    const review = (
      await post(core, "/api/intake/images", {
        requestId: crypto.randomUUID(),
        dataUrl,
      })
    ).json();
    const url = `/api/intake/images/${review.id}/confirm`;
    const item = ItemInput.parse({ name: "番茄", quantity: 2 });
    assert.equal(
      (await post(core, url, { requestId: crypto.randomUUID(), items: [] }))
        .statusCode,
      400,
    );
    assert.equal(
      (
        await post(core, url, {
          requestId: crypto.randomUUID(),
          items: [{ candidateId: crypto.randomUUID(), item }],
        })
      ).statusCode,
      409,
    );
    const selection = review.candidates.map(
      (c: { id: string }, index: number) => ({
        candidateId: c.id,
        item: ItemInput.parse({ name: index ? "草莓" : "番茄", quantity: 1 }),
      }),
    );
    const save = core.repo.save.bind(core.repo);
    let writes = 0;
    core.repo.save = (...args) => {
      if (++writes === 2) throw Error("模拟第二项保存失败");
      save(...args);
    };
    assert.equal(
      (
        await post(core, url, {
          requestId: crypto.randomUUID(),
          items: selection,
        })
      ).statusCode,
      502,
    );
    assert.equal(core.repo.list().length, 0);
    assert.equal(core.repo.events().length, 0);
    assert.equal(
      (await core.app.inject("/api/intake/images")).json()[0].status,
      "pending",
    );
    core.repo.save = save;
    await post(core, `/api/intake/images/${review.id}/cancel`, {});
    assert.equal(
      (
        await post(core, url, {
          requestId: crypto.randomUUID(),
          items: selection,
        })
      ).statusCode,
      409,
    );
  } finally {
    await core.app.close();
  }
});
test("图片校验拒绝远程 URL、伪装格式、异常尺寸和超限；Mock 不伪造识别", async () => {
  const core = createApp(":memory:", new MockAIProvider());
  try {
    validateImage(dataUrl);
    for (const invalid of [
      "https://example.com/photo.png",
      dataUrl.replace("image/png", "image/jpeg"),
      "data:image/svg+xml;base64," + png,
    ])
      assert.throws(() => validateImage(invalid));
    assert.throws(() =>
      validateImage(
        `data:image/png;base64,${Buffer.alloc(3 * 1024 * 1024 + 1).toString("base64")}`,
      ),
    );
    const huge = Buffer.from(png, "base64");
    huge.writeUInt32BE(100000, 16);
    assert.throws(() =>
      validateImage(`data:image/png;base64,${huge.toString("base64")}`),
    );
    const response = await post(core, "/api/intake/images", {
      requestId: crypto.randomUUID(),
      dataUrl,
    });
    assert.equal(response.statusCode, 409);
    assert.match(response.json().error, /Mock/);
    assert.equal(core.repo.list().length, 0);
  } finally {
    await core.app.close();
  }
});
test("真实 HTTP 视觉适配发送图像和 JSON Schema，拒绝非法候选响应", async () => {
  let invalid = false;
  const server = createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += String(chunk);
    const body = JSON.parse(text);
    assert.equal(body.model, "vision-fixture");
    assert.equal(body.response_format.type, "json_object");
    assert.equal(body.messages[1].content[1].image_url.url, dataUrl);
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify(
                invalid
                  ? { notes: "错误", candidates: [{ name: "伪造" }] }
                  : result,
              ),
            },
          },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const provider = new OpenAICompatibleProvider(
    {
      mode: "openai-compatible",
      baseUrl: `http://127.0.0.1:${addr.port}`,
      model: "text-fixture",
      visionModel: "vision-fixture",
    },
    "",
  );
  try {
    assert.deepEqual(await provider.recognizeImage(dataUrl), result);
    invalid = true;
    await assert.rejects(provider.recognizeImage(dataUrl));
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});
