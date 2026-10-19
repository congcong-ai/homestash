import "dotenv/config";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { speechFromEnv } from "../../packages/ai/src/speech";
import { OpenAICompatibleProvider } from "../../packages/ai/src/index";
const speech = speechFromEnv();
const dir = await mkdtemp(join(tmpdir(), "homestash-bailian-"));
const wav = await speech.synthesize("买了两个西红柿。");
await writeFile(join(dir, "speech.wav"), wav, { mode: 0o600 });
const text = await speech.transcribe(wav);
const provider = new OpenAICompatibleProvider(
  {
    mode: "openai-compatible",
    baseUrl: process.env.AI_BASE_URL!,
    model: process.env.AI_MODEL!,
  },
  process.env.AI_API_KEY!,
);
const intent = await provider.structuredOutput(text, "default");
const result = {
  说明: "百炼 TTS 生成的样本，不是真机麦克风录音",
  bytes: wav.length,
  text,
  intent,
};
await writeFile(join(dir, "result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ directory: dir, ...result }, null, 2));
