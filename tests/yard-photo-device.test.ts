import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../services/kitchen-core/src/app";
import { createDeviceServer } from "../services/kitchen-core/src/device-server";
import { pcmWav } from "@homestash/ai/speech";
test("独立照片协议：鉴权、真实来源标记、取消迟到上传、重试、重拍、保存与重启回看", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yard-photo-"));
  let core = createApp(join(dir, "db.sqlite"));
  const speech = {
    transcribe: async () => "",
    synthesize: async () => pcmWav(Buffer.alloc(3200)),
  };
  let server = createDeviceServer(core, speech, { mediaDir: dir });
  const web = (path: string, payload: unknown = {}) =>
    core.app.inject({
      method: "POST",
      url: `/api/yard/photo/${path}`,
      payload: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
    });
  try {
    const reg = await core.app.inject({
      method: "POST",
      url: "/api/devices",
      payload: {
        id: "photo-t5",
        name: "相机测试",
        boardId: "tuya-t5-ai-board-v1.02",
      },
    });
    assert.equal(reg.statusCode, 200, reg.body);
    const headers = {
      "x-device-id": "photo-t5",
      authorization: `Bearer ${reg.json().token}`,
    };
    // 仅协议测试替身，不是真机照片。
    const jpeg = Buffer.concat([
      Buffer.from([255, 216]),
      Buffer.alloc(30, 1),
      Buffer.from([255, 217]),
    ]);
    const device = (id: string, operation: string) =>
      server.inject({
        method: "POST",
        url: `/device/v1/yard/photos/${id}/${operation}`,
        headers: {
          ...headers,
          "content-type":
            operation === "upload" ? "image/jpeg" : "application/json",
        },
        payload: operation === "upload" ? jpeg : {},
      });
    let id = randomUUID();
    assert.equal((await device(id, "upload")).statusCode, 410);
    assert.equal(
      (
        await server.inject({
          method: "POST",
          url: `/device/v1/yard/photos/${id}/begin`,
          payload: {},
        })
      ).statusCode,
      401,
    );
    assert.equal((await device(id, "begin")).statusCode, 200);
    await web("cancel");
    assert.equal((await device(id, "upload")).statusCode, 410);
    assert.equal((await device(id, "begin")).statusCode, 410);
    id = randomUUID();
    await device(id, "begin");
    assert.equal((await device(id, "upload")).statusCode, 200);
    assert.equal((await device(id, "upload")).statusCode, 200);
    let state = (await core.app.inject({ url: "/api/yard" })).json();
    assert.equal(state.preview.source, "device");
    assert.equal(state.memories.length, 0);
    const retake = await web("retake");
    assert.equal(retake.statusCode, 200);
    assert.equal((await device(id, "upload")).statusCode, 410);
    id = retake.json().id;
    await device(id, "begin");
    await device(id, "upload");
    assert.equal(
      (await web("save", { requestId: id, title: "协议回归照片" })).statusCode,
      200,
    );
    assert.equal(
      (await web("save", { requestId: id, title: "协议回归照片" })).statusCode,
      200,
    );
    await server.close();
    await core.app.close();
    core.repo.sqlite.close();
    core = createApp(join(dir, "db.sqlite"));
    server = createDeviceServer(core, speech, { mediaDir: dir });
    state = (await core.app.inject({ url: "/api/yard" })).json();
    assert.equal(state.memories.length, 1);
    const image = await core.app.inject({ url: state.memories[0].photoUrl });
    assert.deepEqual(image.rawPayload, jpeg);
    assert.equal(
      (
        await core.app.inject({
          method: "DELETE",
          url: `/api/yard/memories/${id}`,
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await core.app.inject({ url: state.memories[0].photoUrl })).statusCode,
      404,
    );
  } finally {
    await server.close();
    await core.app.close();
    core.repo.sqlite.close();
    await rm(dir, { recursive: true, force: true });
  }
});
