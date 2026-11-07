import test from "node:test";
import assert from "node:assert/strict";
import { collectTtsSse, spokenText } from "../packages/ai/src/speech-sse";
const event = (output: unknown) =>
  `data: ${JSON.stringify({ output })}\r\n\r\n`;
test("TTS SSE跨网络碎片解码、只收PCM且要求完整结束", async () => {
  const bytes = Buffer.from([1, 2, 3, 4]);
  const body =
    event({ audio: { data: bytes.toString("base64") } }) +
    event({ finish_reason: "stop", audio: { data: "" } });
  const data = new TextEncoder().encode(body);
  let n = 0;
  const response = new Response(
    new ReadableStream({
      start(c) {
        for (let i = 0; i < data.length; i += 7)
          c.enqueue(data.slice(i, i + 7));
        c.close();
      },
    }),
  );
  assert.deepEqual(await collectTtsSse(response, () => n++), bytes);
  assert.equal(n, 1);
  await assert.rejects(
    collectTtsSse(new Response(event({ audio: { data: "AQI=" } }))),
    /未完整/,
  );
  await assert.rejects(
    collectTtsSse(new Response('data: {"code":"error"}\n')),
    /返回错误/,
  );
});
test("播报去除舞台动作和emoji，保留食谱关键括号信息", () => {
  assert.equal(
    spokenText("（托腮眨眨眼）🍅 **番茄**炒2分钟（约半熟）。"),
    "番茄炒2分钟（约半熟）。",
  );
});
