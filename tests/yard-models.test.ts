import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../services/kitchen-core/src/app";
import { bailianKey } from "../services/kitchen-core/src/yard-models";
test("百炼Key私有保存、不回显且重启恢复", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yard-models-"));
  let core = createApp(join(dir, "db"));
  try {
    const apiKey = "test-only-not-a-real-key";
    const r = await core.app.inject({
      method: "PATCH",
      url: "/api/yard/models",
      payload: {
        enabled: true,
        chatModel: "qwen-plus",
        asrModel: "qwen3-asr-flash",
        ttsModel: "qwen3-tts-flash",
        apiKey,
      },
    });
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.includes(apiKey), false);
    assert.equal(bailianKey(core.repo), apiKey);
    assert.equal(
      (await stat(join(dir, "private/bailian-api-key"))).mode & 0o777,
      0o600,
    );
    await core.app.close();
    core.repo.sqlite.close();
    core = createApp(join(dir, "db"));
    assert.equal(bailianKey(core.repo), apiKey);
    assert.equal(
      (await core.app.inject({ url: "/api/yard/models" })).body.includes(
        apiKey,
      ),
      false,
    );
  } finally {
    await core.app.close();
    core.repo.sqlite.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("统一百炼配置更换Key后下一次ASR立即使用新值且不受旧地址影响", async () => {
  const { speechFromEnv, pcmWav } = await import("@homestash/ai/speech");
  const previous = globalThis.fetch;
  const address = process.env.AI_BASE_URL;
  process.env.AI_BASE_URL = "https://invalid.example/v1";
  let key = "test-key-first";
  const sent: { url: string; auth: string | null }[] = [];
  globalThis.fetch = async (input, init) => {
    sent.push({
      url: String(input),
      auth: new Headers(init?.headers).get("authorization"),
    });
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "今天吃面" } }] }),
      { headers: { "content-type": "application/json" } },
    );
  };
  try {
    const speech = speechFromEnv(
      () => ({ provider: "disabled" }),
      () => ({ enabled: true, key, asrModel: "qwen3-asr-flash" }),
    );
    const wav = pcmWav(Buffer.alloc(320));
    assert.equal(await speech.transcribe(wav), "今天吃面");
    key = "test-key-second";
    await speech.transcribe(wav);
    assert.ok(
      sent.every((v) => v.url.startsWith("https://dashscope.aliyuncs.com/")),
    );
    assert.equal(sent[0].auth, "Bearer test-key-first");
    assert.equal(sent[1].auth, "Bearer test-key-second");
  } finally {
    globalThis.fetch = previous;
    if (address === undefined) delete process.env.AI_BASE_URL;
    else process.env.AI_BASE_URL = address;
  }
});
