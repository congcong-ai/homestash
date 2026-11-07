import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../services/kitchen-core/src/app";
import { createDeviceServer } from "../services/kitchen-core/src/device-server";
import { pcmWav } from "@homestash/ai/speech";
import { type YardPhotoJob } from "../services/kitchen-core/src/yard";
test("照片协议边界：异机不能接管、过期与失败拒绝上传、坏图不产生预览", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yard-photo-boundary-"));
  const core = createApp(join(dir, "test.db"));
  const server = createDeviceServer(
    core,
    {
      transcribe: async () => "",
      synthesize: async () => pcmWav(Buffer.alloc(320)),
    },
    { mediaDir: dir },
  );
  try {
    const headers: { "x-device-id": string; authorization: string }[] = [];
    for (const id of ["camera-a", "camera-b"]) {
      const registered = await core.app.inject({
        method: "POST",
        url: "/api/devices",
        payload: { id, name: "测试相机", boardId: "tuya-t5-ai-board-v1.02" },
      });
      assert.equal(registered.statusCode, 200);
      headers.push({
        "x-device-id": id,
        authorization: "Bearer " + registered.json().token,
      });
    }
    const jpeg = Buffer.from([255, 216, ...Array(30).fill(1), 255, 217]);
    const request = (id: string, operation: string, device = 0, body = jpeg) =>
      server.inject({
        method: "POST",
        url: `/device/v1/yard/photos/${id}/${operation}`,
        headers: {
          ...headers[device],
          "content-type":
            operation === "upload" ? "image/jpeg" : "application/json",
        },
        payload: operation === "upload" ? body : {},
      });
    let id = randomUUID();
    assert.equal((await request(id, "begin")).statusCode, 200);
    assert.equal((await request(id, "upload", 1)).statusCode, 410);
    assert.equal((await core.app.inject("/api/yard")).json().preview, null);
    assert.ok(
      (await request(id, "upload", 0, Buffer.from("bad jpeg"))).statusCode >=
        400,
    );
    assert.equal((await core.app.inject("/api/yard")).json().preview, null);
    const job = core.repo.read<YardPhotoJob>("yard:photo:job", null!);
    core.repo.write("yard:photo:job", { ...job, expiresAt: Date.now() - 1 });
    assert.equal((await request(id, "upload")).statusCode, 410);
    id = randomUUID();
    assert.equal((await request(id, "begin")).statusCode, 200);
    assert.equal((await request(id, "failed")).statusCode, 200);
    assert.equal((await request(id, "upload")).statusCode, 410);
    assert.equal((await request(id, "begin")).statusCode, 410);
    const state = (await core.app.inject("/api/yard")).json();
    assert.equal(state.preview, null);
    assert.equal(state.memories.length, 0);
  } finally {
    await server.close();
    await core.app.close();
    core.repo.sqlite.close();
    await rm(dir, { recursive: true, force: true });
  }
});
