import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../services/kitchen-core/src/app";
import { createDeviceServer } from "../services/kitchen-core/src/device-server";

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAUCAIAAABj86gYAAAALklEQVR4nGP8vzuNgZaAiaamM4xaQAQYjQOCYDSICILRICIIRoOIIBgNIgZCAAC27QJIm5/JqgAAAABJRU5ErkJggg==";

test("后台上传和板端拍照共用壁纸，坏图保留当前壁纸，清除后设备收到默认状态", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yard-wallpaper-"));
  const core = createApp(join(dir, "db"));
  const device = createDeviceServer(
    core,
    {
      transcribe: async () => "",
      synthesize: async () => Buffer.alloc(0),
    },
    { mediaDir: dir },
  );
  try {
    const registration = await core.app.inject({
      method: "POST",
      url: "/api/devices",
      payload: {
        id: "wallpaper-t5",
        name: "壁纸测试",
        boardId: "tuya-t5-ai-board-v1.02",
      },
    });
    assert.equal(registration.statusCode, 200, registration.body);
    const headers = {
      "x-device-id": "wallpaper-t5",
      authorization: `Bearer ${registration.json().token}`,
    };
    const saved = await core.app.inject({
      method: "PUT",
      url: "/api/yard/wallpaper",
      payload: { image: png },
    });
    assert.equal(saved.statusCode, 200, saved.body);
    const id = saved.json().id;
    const settings = () =>
      device.inject({
        method: "GET",
        url: "/device/v1/yard/settings",
        headers,
      });
    assert.equal((await settings()).json().wallpaper, id);
    const url = `/device/v1/yard/wallpaper/${id}`;
    assert.equal((await device.inject({ method: "GET", url })).statusCode, 401);
    const image = await device.inject({ method: "GET", url, headers });
    assert.equal(image.statusCode, 200);
    assert.equal(image.headers["content-type"], "image/jpeg");
    assert.ok(image.rawPayload.length <= 24 * 1024);
    const camera = (payload: Buffer) =>
      device.inject({
        method: "PUT",
        url: "/device/v1/yard/wallpaper",
        headers: { ...headers, "content-type": "image/jpeg" },
        payload,
      });
    assert.equal((await camera(Buffer.from("无效图片"))).statusCode, 400);
    assert.equal((await settings()).json().wallpaper, id);
    const replacement = await camera(image.rawPayload);
    assert.equal(replacement.statusCode, 200, replacement.body);
    assert.notEqual(replacement.json().id, id);
    assert.equal((await settings()).json().wallpaper, replacement.json().id);
    assert.equal(
      (await core.app.inject({ method: "DELETE", url: "/api/yard/wallpaper" }))
        .statusCode,
      200,
    );
    assert.equal((await settings()).json().wallpaper, null);
    assert.equal(
      (await device.inject({ method: "GET", url, headers })).statusCode,
      404,
    );
  } finally {
    await device.close();
    await core.app.close();
    core.repo.close();
    await rm(dir, { recursive: true, force: true });
  }
});
