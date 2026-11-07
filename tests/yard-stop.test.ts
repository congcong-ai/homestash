import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../services/kitchen-core/src/app";
import { createDeviceServer } from "../services/kitchen-core/src/device-server";
import { pcmWav } from "@homestash/ai/speech";
import { isYardStop } from "../services/kitchen-core/src/yard-commands";
test("退下只匹配独立指令", () => {
  for (const text of ["退下", "退下！", "小冰，退下", "萌小冰请退下吧。"])
    assert.equal(isYardStop(text), true, text);
  for (const text of [
    "退下是什么意思",
    "他说退下",
    "不要退下",
    "讲一个关于退下的故事",
  ])
    assert.equal(isYardStop(text), false, text);
});
test("设备退下返回stop、不请求聊天模型、不启动合成，重复上传幂等", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yard-stop-"));
  const core = createApp(join(dir, "db"));
  let asr = 0,
    tts = 0;
  const server = createDeviceServer(
    core,
    {
      transcribe: async () => {
        asr++;
        return "退下。";
      },
      synthesize: async () => {
        tts++;
        return pcmWav(Buffer.alloc(320));
      },
    },
    { mediaDir: dir },
  );
  try {
    const reg = (
      await core.app.inject({
        method: "POST",
        url: "/api/devices",
        payload: {
          id: "stop-t5",
          name: "停止测试",
          boardId: "tuya-t5-ai-board-v1.02",
        },
      })
    ).json();
    const id = crypto.randomUUID();
    const request = () =>
      server.inject({
        method: "POST",
        url: `/device/v1/captures/${id}`,
        headers: {
          authorization: `Bearer ${reg.token}`,
          "x-device-id": "stop-t5",
          "content-type": "audio/wav",
        },
        payload: pcmWav(Buffer.alloc(320)),
      });
    const first = await request();
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().action, "stop");
    assert.equal(first.json().message, "这次已停止，我们歇一会儿。");
    assert.equal((await request()).json().action, "stop");
    assert.equal(asr, 1);
    assert.equal(tts, 0);
  } finally {
    await server.close();
    await core.app.close();
    core.repo.sqlite.close();
    await rm(dir, { recursive: true, force: true });
  }
});
