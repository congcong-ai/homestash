import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../services/kitchen-core/src/app";
import { createDeviceServer } from "../services/kitchen-core/src/device-server";
import {
  rootKey,
  yardPhotoSecret,
  type YardMemory,
} from "../services/kitchen-core/src/yard";

test("设备直接从待确认照片生成回忆，后台删除后设备同步消失", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yard-gallery-"));
  const core = createApp(join(dir, "db"));
  const device = createDeviceServer(
    core,
    {
      transcribe: async () => "",
      synthesize: async () => Buffer.alloc(0),
    },
    {
      mediaDir: dir,
      token: "gallery-test-token-for-local-tests-only",
      deviceId: "gallery-t5",
    },
  );
  try {
    await core.app.ready();
    const memories: YardMemory[] = [];
    for (const [day, title, source] of [
      ["01", "午饭吃了南瓜", "device"],
      ["02", "晚饭一起吃面", "device"],
      ["03", "试拍", "simulated"],
    ] as const) {
      const id = randomUUID();
      const photoPath = join(dir, id + ".png");
      await writeFile(
        photoPath,
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAACAAAAAUCAIAAABj86gYAAAALklEQVR4nGP8vzuNgZaAiaamM4xaQAQYjQOCYDSICILRICIIRoOIIBgNIgZCAAC27QJIm5/JqgAAAABJRU5ErkJggg==",
          "base64",
        ),
      );
      memories.push({
        id,
        title,
        createdAt: `2026-11-${day}T03:00:00.000Z`,
        roleName: "小冰",
        photoPath,
        source,
      });
    }
    core.repo.write(rootKey, { ...core.repo.read(rootKey, {}), memories });
    const path = "/device/v1/yard/gallery";
    const get = (suffix: string, method: "GET" | "POST" = "GET") =>
      device.inject({
        method,
        url: path + suffix,
        headers: {
          "x-device-id": "gallery-t5",
          authorization: "Bearer gallery-test-token-for-local-tests-only",
        },
      });
    assert.equal(
      (await device.inject({ url: path + "?mode=photos" })).statusCode,
      401,
    );
    assert.deepEqual((await get("?mode=stories")).json(), {
      count: 0,
      index: 0,
    });
    assert.equal((await get("?mode=photos")).json().count, 2);
    const turnId = randomUUID();
    core.repo.write(`yard:interaction:${turnId}`, {
      id: turnId,
      text: "今天大家一起做了饭",
      reply: "听起来真好",
      createdAt: "2026-10-30T17:00:00.000Z",
      simulated: false,
    });
    const generated = await core.app.inject({
      url: "/api/yard/memory-book?from=2026-10-31&to=2026-11-01",
    });
    assert.equal(generated.statusCode, 200, generated.body);
    const card = (await get("?mode=stories")).json();
    assert.deepEqual(card, {
      count: 2,
      index: 0,
      date: "2026-11-01",
      id: memories[0].id,
      story: memories[0].title,
    });
    const textCard = (await get("?mode=stories&index=1")).json();
    assert.equal(textCard.id, null);
    assert.equal(textCard.date, "2026-10-31");
    assert.match(textCard.story, /今天大家一起做了饭/);
    const gallery = (await get(`?mode=photos&anchor=${card.id}`)).json();
    assert.equal(gallery.index, 1);
    assert.equal(gallery.id, card.id);
    assert.equal((await get("?mode=photos&index=0")).json().id, memories[1].id);
    const image = await get(`/${card.id}/image`);
    assert.equal(image.statusCode, 200, image.body);
    assert.equal(image.headers["content-type"], "image/jpeg");
    assert.ok(image.rawPayload.length <= 24 * 1024);
    const pendingId = randomUUID();
    const upload = await core.app.inject({
      method: "POST",
      url: "/api/yard/offline-photos/upload",
      headers: { "x-yard-internal": yardPhotoSecret(core.repo) },
      payload: {
        id: pendingId,
        deviceId: "gallery-t5",
        jpegBase64: image.rawPayload.toString("base64"),
      },
    });
    assert.equal(upload.statusCode, 200, upload.body);
    const pending = (await get(`?mode=photos&anchor=${pendingId}`)).json();
    assert.equal(pending.count, 3);
    assert.equal(pending.id, pendingId);
    assert.equal((await get(`/${pendingId}/image`)).statusCode, 200);
    const generate = `/${pendingId}/memory`;
    assert.equal((await device.inject({ method: "POST", url: path + generate })).statusCode, 401);
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await get(generate, "POST");
      assert.equal(result.statusCode, 200, result.body);
    }
    const generatedCard = (await get(`?mode=stories&anchor=${pendingId}`)).json();
    assert.equal(generatedCard.id, pendingId);
    assert.equal(generatedCard.count, 3);
    assert.ok(generatedCard.story);
    assert.equal((await get(`/${pendingId}/image`)).statusCode, 200);
    assert.equal((await core.app.inject({
      method: "DELETE",
      url: `/api/yard/memories/${pendingId}`,
    })).statusCode, 200);
    const deleted = await core.app.inject({
      method: "DELETE",
      url: `/api/yard/memories/${card.id}`,
    });
    assert.equal(deleted.statusCode, 200, deleted.body);
    assert.equal((await get(`/${card.id}/image`)).statusCode, 404);
    assert.equal((await get("?mode=stories")).json().count, 1);
    assert.equal((await get("?mode=photos")).json().count, 1);
    const previewId = randomUUID();
    const previewPath = join(dir, previewId + ".jpg");
    await writeFile(previewPath, image.rawPayload);
    core.repo.write(rootKey, {
      ...core.repo.read(rootKey, {}),
      preview: {
        id: previewId,
        title: "刚拍的晚饭",
        createdAt: "2026-11-02T03:00:00.000Z",
        photoPath: previewPath,
        source: "device",
      },
    });
    const preview = await get(`/${previewId}/memory`, "POST");
    assert.equal(preview.statusCode, 200, preview.body);
    assert.equal((await get(`?mode=stories&anchor=${previewId}`)).json().story, "刚拍的晚饭");
    assert.equal((await get(`/${previewId}/image`)).statusCode, 200);
  } finally {
    await device.close();
    await core.app.close();
    core.repo.close();
    await rm(dir, { recursive: true, force: true });
  }
});
