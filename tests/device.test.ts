import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../services/kitchen-core/src/app";
import { createDeviceServer } from "../services/kitchen-core/src/device-server";
import { MockAIProvider } from "../packages/ai/src/index";
import { pcmWav, validateWav } from "../packages/ai/src/speech";

test("设备鉴权、WAV 校验、并发重放、TTS 失败和服务重启不会重复入库", async () => {
  const dir = await mkdtemp(join(tmpdir(), "homestash-device-test-"));
  const path = join(dir, "test.db");
  let core = createApp(path, new MockAIProvider());
  let stt = 0,
    tts = 0,
    failTts = true;
  const wav = pcmWav(Buffer.alloc(32000));
  const speech = {
    async transcribe() {
      stt++;
      return "买了两个西红柿";
    },
    async synthesize() {
      tts++;
      if (failTts) throw new Error("测试失败");
      return wav;
    },
  };
  const options = {
    token: "x".repeat(32),
    deviceId: "test-korvo",
    mediaDir: join(dir, "media"),
  };
  let device = createDeviceServer(core, speech, options);
  const id = randomUUID();
  const headers = {
    authorization: `Bearer ${options.token}`,
    "x-device-id": options.deviceId,
    "content-type": "audio/wav",
  };
  const upload = {
    method: "POST" as const,
    url: `/device/v1/captures/${id}`,
    headers,
    payload: wav,
  };
  try {
    assert.equal(
      (
        await device.inject({
          ...upload,
          headers: { "content-type": "audio/wav" },
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (await device.inject({ ...upload, payload: Buffer.from("bad") }))
        .statusCode,
      400,
    );
    const replies = await Promise.all([
      device.inject(upload),
      device.inject(upload),
    ]);
    assert.deepEqual(
      replies.map((r) => r.statusCode),
      [200, 200],
    );
    assert.equal(stt, 1);
    assert.equal(core.repo.list().length, 1);
    assert.equal(core.repo.list()[0].quantity, 2);
    assert.deepEqual(replies[0].json(), replies[1].json());
    const different = pcmWav(Buffer.alloc(64000));
    assert.equal(
      (await device.inject({ ...upload, payload: different })).statusCode,
      409,
    );
    const audio = {
      method: "GET" as const,
      url: `${upload.url}/audio`,
      headers,
    };
    assert.equal((await device.inject(audio)).statusCode, 503);
    assert.equal((await device.inject(upload)).statusCode, 200);
    assert.equal(stt, 1);
    failTts = false;
    const spoken = await device.inject(audio);
    assert.equal(spoken.statusCode, 200);
    assert.deepEqual(spoken.rawPayload, wav);
    await device.inject(audio);
    assert.equal(tts, 2);
    await device.close();
    await core.app.close();
    core = createApp(path, new MockAIProvider());
    device = createDeviceServer(core, speech, options);
    assert.equal((await device.inject(upload)).statusCode, 200);
    assert.equal(stt, 1);
    assert.equal(core.repo.list().length, 1);
    assert.equal(
      (
        await device.inject({
          ...audio,
          url: `/device/v1/captures/${randomUUID()}/audio`,
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (await device.inject({ method: "GET", url: "/api/state", headers }))
        .statusCode,
      404,
    );
    assert.equal(
      (
        await device.inject({
          ...upload,
          headers: { ...headers, origin: "http://evil.invalid" },
        })
      ).statusCode,
      401,
    );
  } finally {
    await device.close();
    await core.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("音频格式严格限制单声道采样率、长度和样本边界", () => {
  const wav = pcmWav(Buffer.alloc(32000));
  validateWav(wav);
  for (const offset of [4, 16, 20, 22, 24, 28, 32, 34, 40]) {
    const bad = Buffer.from(wav);
    bad[offset] ^= 1;
    assert.throws(() => validateWav(bad));
  }
  assert.throws(() => validateWav(pcmWav(Buffer.alloc(1920002))));
  assert.throws(() => validateWav(pcmWav(Buffer.alloc(1))));
});

test("真实 HTTP 在库存提交后丢失响应，重启和重传只保留一条库存事件", async () => {
  const dir = await mkdtemp(join(tmpdir(), "homestash-ack-loss-"));
  const path = join(dir, "test.db");
  let core = createApp(path, new MockAIProvider());
  let stt = 0;
  let failStt = true;
  const wav = pcmWav(Buffer.alloc(32000));
  const options = {
    token: "y".repeat(32),
    deviceId: "fault-korvo",
    mediaDir: join(dir, "media"),
  };
  const speech = {
    async transcribe() {
      stt++;
      if (failStt) throw new Error("模拟 STT 故障");
      return "买了两个西红柿";
    },
    async synthesize() {
      return wav;
    },
  };
  let device = createDeviceServer(core, speech, options);
  const id = randomUUID();
  const headers = {
    Authorization: `Bearer ${options.token}`,
    "X-Device-ID": options.deviceId,
    "Content-Type": "audio/wav",
  };
  let drop = true;
  device.addHook("onSend", async (req, reply, payload) => {
    if (
      drop &&
      req.method === "POST" &&
      req.url.endsWith(id) &&
      reply.statusCode === 200
    ) {
      drop = false;
      reply.raw.destroy();
    }
    return payload;
  });
  try {
    const failure = await device.inject({
      method: "POST",
      url: `/device/v1/captures/${id}`,
      headers,
      payload: wav,
    });
    assert.equal(failure.statusCode, 503);
    assert.equal(core.repo.list().length, 0);
    assert.equal(core.repo.events().length, 0);
    failStt = false;
    // port 0 由操作系统分配专用测试端口，无需影响正在运行的开发服务。
    await device.listen({ port: 0, host: "127.0.0.1" });
    const address = device.server.address();
    assert.ok(address && typeof address === "object");
    const url = `http://127.0.0.1:${address.port}/device/v1/captures/${id}`;
    await assert.rejects(
      fetch(url, {
        method: "POST",
        headers,
        body: new Uint8Array(wav),
        signal: AbortSignal.timeout(3000),
      }),
    );
    assert.equal(core.repo.list().length, 1);
    assert.equal(core.repo.events().length, 1);
    const itemId = core.repo.list()[0].id;
    await device.close();
    await core.app.close();
    core = createApp(path, new MockAIProvider());
    device = createDeviceServer(core, speech, options);
    const retried = await device.inject({
      method: "POST",
      url: `/device/v1/captures/${id}`,
      headers,
      payload: wav,
    });
    assert.equal(retried.statusCode, 200);
    assert.equal(stt, 2);
    assert.equal(core.repo.list().length, 1);
    assert.equal(core.repo.list()[0].id, itemId);
    assert.equal(core.repo.events().length, 1);
  } finally {
    await device.close();
    await core.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("真实设备心跳保存实际 LCD 文字，媒体请求更新心跳时保留屏幕内容", async () => {
  const core = createApp(":memory:", new MockAIProvider());
  const speech = {
    async transcribe() {
      throw new Error("不应调用");
    },
    async synthesize() {
      throw new Error("不应调用");
    },
  };
  const device = createDeviceServer(core, speech, {
    token: "z".repeat(32),
    deviceId: "screen-korvo",
    mediaDir: join(tmpdir(), "unused-homestash"),
  });
  const headers = {
    authorization: `Bearer ${"z".repeat(32)}`,
    "x-device-id": "screen-korvo",
  };
  const actual = {
    screen: "操作已完成，播报未完成。按 SET 重试不会重复执行。",
    network: "网络已连接",
    screenRevision: 5,
    uptimeMs: 12345,
  };
  try {
    assert.equal(
      (
        await device.inject({
          method: "POST",
          url: "/device/v1/heartbeat",
          headers,
          payload: actual,
        })
      ).statusCode,
      200,
    );
    const state = (
      await core.app.inject({ method: "GET", url: "/api/state" })
    ).json();
    assert.equal(state.physicalDevice.screen, actual.screen);
    assert.equal(state.physicalDevice.screenRevision, 5);
    assert.equal(
      (
        await device.inject({
          method: "POST",
          url: "/device/v1/heartbeat",
          headers,
          payload: {},
        })
      ).statusCode,
      200,
    );
    assert.equal(
      core.repo.read<{ screen: string }>("physical-device", { screen: "" })
        .screen,
      actual.screen,
    );
    assert.equal(
      (
        await device.inject({
          method: "POST",
          url: "/device/v1/heartbeat",
          headers,
          payload: { screen: "x".repeat(1025) },
        })
      ).statusCode,
      400,
    );
  } finally {
    await device.close();
    await core.app.close();
  }
});
