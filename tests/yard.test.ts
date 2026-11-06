import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../services/kitchen-core/src/app";
import { LocalHttpTtsProvider, pcmWav } from "@homestash/ai/speech";
import { createServer } from "node:http";

test("小院共创隔离库存、许可消费、取消、保存重试与重启回看", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yard-test-"));
  let core = createApp(join(dir, "db.sqlite"));
  const post = (url: string, payload: unknown) =>
    core.app.inject({
      method: "POST",
      url,
      payload: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
    });
  try {
    const before = core.repo.sqlite
      .prepare("SELECT * FROM inventory_items")
      .all();
    const id = randomUUID();
    const first = await post("/api/yard/interactions", {
      requestId: id,
      text: "今天买了草莓",
      simulated: true,
    });
    assert.equal(first.statusCode, 200);
    assert.deepEqual(
      (
        await post("/api/yard/interactions", {
          requestId: id,
          text: "今天买了草莓",
          simulated: true,
        })
      ).json(),
      first.json(),
    );
    await post("/api/yard/interactions", {
      requestId: randomUUID(),
      text: "叫它莓老板",
      simulated: true,
    });
    assert.deepEqual(
      core.repo.sqlite.prepare("SELECT * FROM inventory_items").all(),
      before,
    );
    const invite = () =>
      post("/api/yard/photo/invite", { requestId: randomUUID() });
    const token = (await invite()).json().token;
    const photo = randomUUID();
    // 与已有图片验证器相同的最小 JPEG fixture，仅用于软件契约测试。
    const jpeg = Buffer.from([
      0xff,
      0xd8,
      ...Array(24).fill(0),
      0xff,
      0xd9,
    ]).toString("base64");
    const body = {
      token,
      requestId: photo,
      title: "测试留影",
      jpegBase64: jpeg,
      simulated: true,
    };
    assert.equal((await post("/api/yard/photo/preview", body)).statusCode, 410);
    assert.equal(
      (await post("/api/yard/photo/consent", { token, accepted: true })).json()
        .accepted,
      true,
    );
    const preview = await post("/api/yard/photo/preview", body);
    assert.equal(preview.statusCode, 200, preview.body);
    assert.equal(
      (
        await post("/api/yard/photo/preview", {
          ...body,
          requestId: randomUUID(),
        })
      ).statusCode,
      410,
    );
    const saved = await post("/api/yard/photo/save", {
      requestId: photo,
      title: "测试留影",
    });
    assert.equal(saved.statusCode, 200, saved.body);
    const again = await post("/api/yard/photo/save", {
      requestId: photo,
      title: "测试留影",
    });
    assert.equal(again.json().photoPath, undefined);
    await core.app.close();
    core = createApp(join(dir, "db.sqlite"));
    const state = (await core.app.inject("/api/yard")).json();
    assert.equal(state.role.name, "莓老板");
    assert.equal(state.memories.length, 1);
    assert.equal(
      (await core.app.inject(state.memories[0].photoUrl)).statusCode,
      200,
    );
    assert.equal(
      (
        await core.app.inject({
          method: "DELETE",
          url: `/api/yard/memories/${photo}`,
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await core.app.inject(state.memories[0].photoUrl)).statusCode,
      404,
    );
  } finally {
    await core.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("local-http 真实 HTTP 契约、音色隔离、坏响应和取消", async () => {
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const data = JSON.parse(body);
    assert.equal(req.url, "/v1/audio/speech");
    assert.equal(data.response_format, "pcm-wav-16k-mono");
    if (data.input === "wait") return;
    res.setHeader("content-type", "audio/wav");
    res.end(
      data.input === "bad" ? Buffer.from("bad") : pcmWav(Buffer.alloc(320)),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const config = {
    endpoint: `http://127.0.0.1:${address.port}`,
    model: "fixture",
    voice: "a",
    timeoutMs: 200,
  };
  try {
    const p = new LocalHttpTtsProvider(config);
    assert.equal((await p.synthesize("收到")).length, 364);
    assert.notEqual(
      p.cacheKey,
      new LocalHttpTtsProvider({ ...config, voice: "b" }).cacheKey,
    );
    await assert.rejects(p.synthesize("bad"));
    await assert.rejects(p.synthesize("wait"));
    const abort = new AbortController();
    abort.abort();
    await assert.rejects(p.synthesize("收到", { signal: abort.signal }));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("照片文件丢失不返回保存成功，重启撤销许可并清理孤立文件", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yard-recovery-"));
  let core = createApp(join(dir, "db.sqlite"));
  const post = (url: string, payload: unknown) =>
    core.app.inject({
      method: "POST",
      url,
      payload: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
    });
  try {
    const token = (
      await post("/api/yard/photo/invite", { requestId: randomUUID() })
    ).json().token;
    await post("/api/yard/photo/consent", { token, accepted: true });
    const id = randomUUID(),
      jpeg = Buffer.from([255, 216, ...Array(24).fill(0), 255, 217]).toString(
        "base64",
      );
    assert.equal(
      (
        await post("/api/yard/photo/preview", {
          token,
          requestId: id,
          title: "测试",
          jpegBase64: jpeg,
          simulated: true,
        })
      ).statusCode,
      200,
    );
    const state = core.repo.read<{ preview: { photoPath: string } }>(
      "product:food-spirit-yard:v1",
      null!,
    );
    await rm(state.preview.photoPath);
    assert.equal(
      (await post("/api/yard/photo/save", { requestId: id, title: "测试" }))
        .statusCode,
      502,
    );
    assert.equal(
      (await core.app.inject("/api/yard")).json().memories.length,
      0,
    );
    const active = (
      await post("/api/yard/photo/invite", { requestId: randomUUID() })
    ).json().token;
    await core.app.close();
    core = createApp(join(dir, "db.sqlite"));
    assert.equal(
      (await post("/api/yard/photo/consent", { token: active, accepted: true }))
        .statusCode,
      410,
    );
  } finally {
    await core.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
