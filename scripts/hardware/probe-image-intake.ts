import "dotenv/config";
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../services/kitchen-core/src/app";
import { type ImageReview } from "@homestash/domain";
const imagePath = process.argv[2];
if (!imagePath)
  throw Error(
    "请提供 JPEG/PNG/WebP 图片路径；探针会将该图片发送给已配置的视觉模型。",
  );
const bytes = await readFile(imagePath);
const mime =
  bytes[0] === 137
    ? "image/png"
    : bytes[0] === 255
      ? "image/jpeg"
      : "image/webp";
const directory = await mkdtemp(join(tmpdir(), "homestash-image-live-"));
const core = createApp(join(directory, "probe.db"));
try {
  const payload = {
    requestId: crypto.randomUUID(),
    dataUrl: `data:${mime};base64,${bytes.toString("base64")}`,
  };
  const reply = await core.app.inject({
    method: "POST",
    url: "/api/intake/images",
    payload,
  });
  assert.equal(reply.statusCode, 200, reply.body);
  const review = reply.json<ImageReview>();
  assert.equal(review.status, "pending");
  assert.ok(review.candidates.length > 0);
  assert.equal(core.repo.list().length, 0);
  assert.equal(core.repo.events().length, 0);
  assert.deepEqual(
    (
      await core.app.inject({
        method: "POST",
        url: "/api/intake/images",
        payload,
      })
    ).json(),
    review,
  );
  const items = review.candidates
    .filter((c) => c.quantity !== null && c.unit !== null)
    .map((c) => ({
      candidateId: c.id,
      item: {
        name: c.name,
        category: c.category,
        quantity: c.quantity,
        unit: c.unit,
        locationId: c.category === "food" ? "fridge" : "other",
        bestBeforeAt: c.bestBeforeAt,
        expiresAt: c.expiresAt,
      },
    }));
  assert.ok(
    items.length > 0,
    "样本没有可直接用于临时库确认的明确数量，请另选样本或人工审核。",
  );
  const confirmPayload = { requestId: crypto.randomUUID(), items };
  const url = `/api/intake/images/${review.id}/confirm`;
  const confirm = await core.app.inject({
    method: "POST",
    url,
    payload: confirmPayload,
  });
  assert.equal(confirm.statusCode, 200, confirm.body);
  assert.equal(core.repo.list().length, items.length);
  assert.equal(core.repo.events().length, items.length);
  const repeat = await core.app.inject({
    method: "POST",
    url,
    payload: { ...confirmPayload, requestId: crypto.randomUUID() },
  });
  assert.equal(repeat.statusCode, 200, repeat.body);
  assert.equal(core.repo.events().length, items.length);
  const result = {
    日期: new Date().toISOString(),
    说明: "真实视觉模型调用，确认入库只发生在临时 SQLite，不影响日常库存。输入样本类型由调用者提供，合成小票不等同于真实食材照片或 Korvo 拍照验收。",
    review,
    confirmed: confirm.json(),
    确认前库存数: 0,
    确认后库存数: core.repo.list().length,
    重复提交未增加库存: true,
  };
  await writeFile(
    join(directory, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify({ directory, ...result }, null, 2));
} finally {
  await core.app.close();
}
