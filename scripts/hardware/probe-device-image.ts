import "dotenv/config";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { createApp } from "../../services/kitchen-core/src/app";
import { createDeviceServer } from "../../services/kitchen-core/src/device-server";
const file = process.argv[2];
if (!file)
  throw Error(
    "用法：pnpm exec tsx scripts/hardware/probe-device-image.ts /绝对路径/图片.jpg；会真实发送图片至已配置视觉模型",
  );
if (process.env.AI_PROVIDER !== "openai-compatible" || !process.env.AI_API_KEY)
  throw Error("请先配置外部视觉模型；本探针不使用伪造识别结果");
const bytes = await readFile(resolve(file));
const dir = await mkdtemp(join(tmpdir(), "homestash-device-image-live-"));
const core = createApp(join(dir, "core.db"));
const token = randomBytes(32).toString("hex"),
  deviceId = "temporary-image-probe";
const device = createDeviceServer(
  core,
  {
    transcribe: async () => {
      throw Error("不应调用语音识别");
    },
    synthesize: async () => {
      throw Error("不应调用语音合成");
    },
  },
  { token, deviceId, mediaDir: join(dir, "media") },
);
try {
  await device.listen({ host: "127.0.0.1", port: 0 });
  const address = device.server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/device/v1/images/${randomUUID()}`;
  const upload = () =>
    fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "x-device-id": deviceId,
        "content-type": "image/jpeg",
      },
      body: bytes,
    });
  const first = await upload();
  assert.equal(first.status, 200, await first.clone().text());
  const receipt = (await first.json()) as { reviewId: string };
  const repeated = await upload();
  assert.equal(repeated.status, 200);
  assert.equal(
    ((await repeated.json()) as { reviewId: string }).reviewId,
    receipt.reviewId,
  );
  assert.equal(core.repo.list().length, 0);
  assert.equal(core.repo.events().length, 0);
  const review = (await core.app.inject("/api/intake/images")).json()[0];
  assert.equal(review.id, receipt.reviewId);
  const result = {
    样本: resolve(file),
    图片字节数: bytes.length,
    设备回执: receipt,
    候选: review,
    重复上传同一审核记录: true,
    库存数: 0,
    事件数: 0,
    边界: "真实本地 HTTP JPEG 上传与外部视觉模型；输入文件不代表 Korvo 实际拍摄",
  };
  await writeFile(join(dir, "result.json"), JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify(
      {
        结果目录: dir,
        候选数: review.candidates.length,
        重复上传同一审核记录: true,
        库存未改变: true,
      },
      null,
      2,
    ),
  );
} finally {
  await device.close();
  await core.app.close();
}
