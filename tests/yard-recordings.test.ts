import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../services/kitchen-core/src/app";
import { createDeviceServer } from "../services/kitchen-core/src/device-server";
import { pcmWav } from "@homestash/ai/speech";
test("录音回忆保存、重试不重复、默认不收费、权限隔离与重启回听", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yard-recordings-"));
  let core = createApp(join(dir, "db"));
  let calls = 0;
  let server = createDeviceServer(
    core,
    {
      transcribe: async () => {
        calls++;
        return "午饭吃了面";
      },
      synthesize: async () => pcmWav(Buffer.alloc(320)),
    },
    { mediaDir: dir },
  );
  try {
    const reg = await core.app.inject({
      method: "POST",
      url: "/api/devices",
      payload: {
        id: "audio-t5",
        name: "测试",
        boardId: "tuya-t5-ai-board-v1.02",
      },
    });
    const headers = {
      "x-device-id": "audio-t5",
      authorization: `Bearer ${reg.json().token}`,
      "content-type": "audio/wav",
    };
    const photoId = crypto.randomUUID();
    const jpeg = Buffer.concat([
      Buffer.from([255, 216]),
      Buffer.alloc(30, 1),
      Buffer.from([255, 217]),
    ]);
    const photoUpload = () =>
      server.inject({
        method: "POST",
        url: `/device/v1/yard/photo-archive/${photoId}`,
        headers: { ...headers, "content-type": "image/jpeg" },
        payload: jpeg,
      });
    assert.equal((await photoUpload()).statusCode, 200);
    assert.equal((await photoUpload()).statusCode, 200);
    const photos = (
      await core.app.inject({ url: "/api/yard/offline-photos" })
    ).json();
    assert.equal(photos.items.length, 1);
    assert.deepEqual(
      (await core.app.inject({ url: photos.items[0].url })).rawPayload,
      jpeg,
    );
    assert.equal(
      (
        await core.app.inject({
          method: "POST",
          url: `/api/yard/offline-photos/${photoId}/resolve`,
          payload: { save: false },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await core.app.inject({ url: photos.items[0].url })).statusCode,
      404,
    );
    assert.equal((await photoUpload()).statusCode, 200);
    assert.equal(
      (await core.app.inject({ url: "/api/yard/offline-photos" })).json().items
        .length,
      0,
    );
    const id = crypto.randomUUID(),
      wav = pcmWav(Buffer.alloc(320));
    const upload = () =>
      server.inject({
        method: "POST",
        url: `/device/v1/yard/recordings/${id}`,
        headers,
        payload: wav,
      });
    assert.equal(
      (
        await server.inject({
          method: "POST",
          url: `/device/v1/yard/recordings/${id}`,
          headers: { "content-type": "audio/wav" },
          payload: wav,
        })
      ).statusCode,
      401,
    );
    const parallel = await Promise.all([upload(), upload()]);
    assert.ok(parallel.every((v) => v.statusCode === 200));
    assert.equal((await upload()).statusCode, 200);
    assert.equal(calls, 0);
    const list = (
      await core.app.inject({ url: "/api/yard/recordings" })
    ).json();
    assert.equal(list.items.length, 1);
    assert.equal(list.items[0].path, undefined);
    assert.equal(list.items[0].speakerId, null);
    assert.deepEqual(
      (await core.app.inject({ url: list.items[0].url })).rawPayload,
      wav,
    );
    assert.equal(
      (
        await core.app.inject({
          method: "PATCH",
          url: "/api/yard/recordings/settings",
          payload: { transcribe: true, recognizeSpeaker: true },
        })
      ).statusCode,
      400,
    );
    await server.close();
    await core.app.close();
    core.repo.sqlite.close();
    core = createApp(join(dir, "db"));
    server = createDeviceServer(
      core,
      { transcribe: async () => "", synthesize: async () => wav },
      { mediaDir: dir },
    );
    assert.deepEqual(
      (await core.app.inject({ url: list.items[0].url })).rawPayload,
      wav,
    );
  } finally {
    await server.close();
    await core.app.close();
    core.repo.sqlite.close();
    await rm(dir, { recursive: true, force: true });
  }
});
