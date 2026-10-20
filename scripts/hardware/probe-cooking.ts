import "dotenv/config";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../services/kitchen-core/src/app";
import { createDeviceServer } from "../../services/kitchen-core/src/device-server";
import { speechFromEnv } from "@homestash/ai/speech";
const directory = await mkdtemp(join(tmpdir(), "homestash-cooking-live-"));
const core = createApp(join(directory, "probe.db"));
const speech = speechFromEnv();
const token = crypto.randomUUID();
const device = createDeviceServer(core, speech, {
  token,
  deviceId: "cooking-probe",
  mediaDir: join(directory, "media"),
});
const records: unknown[] = [];
const headers = {
  authorization: `Bearer ${token}`,
  "x-device-id": "cooking-probe",
  "content-type": "audio/wav",
};
try {
  core.inventory.create({ name: "番茄", quantity: 6, unit: "个" });
  core.inventory.create({ name: "鸡蛋", quantity: 10, unit: "个" });
  const before = core.repo.list();
  async function voice(text: string, expected: RegExp) {
    const reply = await core.app.inject({
      method: "POST",
      url: "/api/voice",
      payload: { requestId: crypto.randomUUID(), text },
    });
    assert.equal(reply.statusCode, 200, reply.body);
    const result = reply.json();
    assert.match(result.message, expected);
    records.push({ text, ...result });
    return result;
  }
  await voice("今晚四个人吃什么", /4人份/);
  // 使用百炼合成样本，不代表物理麦克风录音或扬声器听感。
  const input = await speech.synthesize("开始做番茄炒蛋。");
  await writeFile(join(directory, "input.wav"), input, { mode: 0o600 });
  const id = crypto.randomUUID();
  const captured = await device.inject({
    method: "POST",
    url: `/device/v1/captures/${id}`,
    headers,
    payload: input,
  });
  assert.equal(captured.statusCode, 200, captured.body);
  assert.match(captured.json().message, /番茄炒蛋.*第1步/);
  records.push({ 设备接口: captured.json() });
  let audio = await device.inject({
    method: "GET",
    url: `/device/v1/captures/${id}/audio`,
    headers,
  });
  const audioAttempts = [audio.statusCode];
  for (let attempt = 1; audio.statusCode === 503 && attempt < 3; attempt++) {
    // 沿用同一采集 ID，仅重试播报；不得重新执行库存动作。
    await new Promise((resolve) => setTimeout(resolve, 1000));
    audio = await device.inject({
      method: "GET",
      url: `/device/v1/captures/${id}/audio`,
      headers,
    });
    audioAttempts.push(audio.statusCode);
  }
  records.push({ 播报请求状态: audioAttempts });
  assert.equal(audio.statusCode, 200, audio.body);
  await writeFile(join(directory, "reply.wav"), audio.rawPayload, {
    mode: 0o600,
  });
  await voice("下一步", /第2步/);
  await voice("再说一遍", /第2步/);
  await voice("鸡蛋放多少", /(?:鸡蛋.*6.*个|6.*个.*鸡蛋)/);
  await voice("上一步", /第1步/);
  await voice("做完了", /确认扣减|库存不足|尚未扣减/);
  assert.deepEqual(core.repo.list(), before);
  const ambiguous = await voice("好的", /./);
  assert.equal(ambiguous.intent.intent, "unknown");
  assert.deepEqual(core.repo.list(), before);
  await voice("不扣减", /库存未扣减/);
  assert.deepEqual(core.repo.list(), before);
  const result = {
    日期: new Date().toISOString(),
    说明: "真实百炼 ASR/意图/TTS，使用合成语音和临时数据库；未使用真实设备麦克风，未修改日常库存。",
    records,
    库存未改变: true,
    播报字节: audio.rawPayload.length,
  };
  await writeFile(
    join(directory, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify({ directory, ...result }, null, 2));
} finally {
  await device.close();
  await core.app.close();
}
