import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../services/kitchen-core/src/app";
import { createDeviceServer } from "../services/kitchen-core/src/device-server";
import { MockAIProvider } from "@homestash/ai";
import { pcmWav } from "@homestash/ai/speech";

test("设备 JPEG 上传经过认证；重传与重启只生成一次候选，确认前不写库存", async () => {
  const dir = await mkdtemp(join(tmpdir(), "homestash-device-image-"));
  let calls = 0;
  const mock = new MockAIProvider();
  const provider = {
    kind: "image-test",
    structuredOutput: (s: string) => mock.structuredOutput(s),
    recognizeImage: async () => {
      calls++;
      return {
        notes: "数量需确认",
        candidates: [
          {
            name: "番茄",
            category: "food" as const,
            quantity: null,
            unit: null,
            evidence: "画面中的红色番茄",
            confidence: "medium" as const,
            bestBeforeAt: null,
            expiresAt: null,
          },
        ],
      };
    },
  };
  const options = {
    token: "x".repeat(32),
    deviceId: "camera-test",
    mediaDir: dir,
  };
  const speech = {
    transcribe: async () => "",
    synthesize: async () => pcmWav(Buffer.alloc(3200)),
  };
  let core = createApp(join(dir, "test.db"), provider);
  let device = createDeviceServer(core, speech, options);
  const bytes = Buffer.concat([
    Buffer.from([255, 216]),
    Buffer.alloc(32),
    Buffer.from([255, 217]),
  ]);
  const headers = {
    authorization: `Bearer ${options.token}`,
    "x-device-id": options.deviceId,
    "content-type": "image/jpeg",
  };
  const request = {
    method: "POST" as const,
    url: `/device/v1/images/${crypto.randomUUID()}`,
    headers,
    payload: bytes,
  };
  try {
    assert.equal(
      (
        await device.inject({
          ...request,
          headers: { "content-type": "image/jpeg" },
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await device.inject({
          ...request,
          headers: { ...headers, origin: "http://example.com" },
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (await device.inject({ ...request, payload: Buffer.from("invalid") }))
        .statusCode,
      400,
    );
    assert.equal(
      (
        await device.inject({
          ...request,
          payload: Buffer.alloc(3 * 1024 * 1024 + 1),
        })
      ).statusCode,
      413,
    );
    const responses = await Promise.all([
      device.inject(request),
      device.inject(request),
    ]);
    assert.deepEqual(
      responses.map((r) => r.statusCode),
      [200, 200],
    );
    assert.equal(responses[0].json().reviewId, responses[1].json().reviewId);
    assert.equal(calls, 1);
    assert.equal(core.repo.list().length, 0);
    const review = (await core.app.inject("/api/intake/images")).json()[0];
    assert.equal(review.id, responses[0].json().reviewId);
    const changed = Buffer.from(bytes);
    changed[4] = 1;
    assert.equal(
      (await device.inject({ ...request, payload: changed })).statusCode,
      409,
    );
    await device.close();
    await core.app.close();
    core = createApp(join(dir, "test.db"), provider);
    device = createDeviceServer(core, speech, options);
    assert.equal((await device.inject(request)).json().reviewId, review.id);
    assert.equal(calls, 1);
    const confirm = await core.app.inject({
      method: "POST",
      url: `/api/intake/images/${review.id}/confirm`,
      payload: {
        requestId: crypto.randomUUID(),
        items: [
          {
            candidateId: review.candidates[0].id,
            item: { name: "番茄", quantity: 2, unit: "个" },
          },
        ],
      },
    });
    assert.equal(confirm.statusCode, 200, confirm.body);
    assert.equal(core.repo.list().length, 1);
    assert.equal((await device.inject(request)).statusCode, 200);
    assert.equal(core.repo.events().length, 1);
  } finally {
    await device.close();
    await core.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
