/** 在开发机预生成自然配音，固件运行时不连接语音服务。 */
import "dotenv/config";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { BailianSpeechProvider } from "../../packages/ai/src/speech";
const args = process.argv.slice(2);
const voice = args[args.indexOf("--voice") + 1] || "Momo";
if (!["Momo", "Vivian"].includes(voice)) throw Error("请选择 Momo 或 Vivian");
const dir = resolve("data/hardware/voice-build", voice);
await mkdir(dir, { recursive: true });
const scenes = JSON.parse(
  await readFile(
    "firmware/freshmate-korvo/components/demo_mode/scenes.json",
    "utf8",
  ),
) as [string, [string, string][]][];
const model = "qwen3-tts-flash";
const provider = new BailianSpeechProvider({
  baseUrl: process.env.BAILIAN_BASE_URL ?? "https://dashscope.aliyuncs.com",
  compatibleUrl: process.env.AI_BASE_URL ?? "",
  key: process.env.AI_API_KEY ?? "",
  asrModel: "",
  ttsModel: model,
  voice,
});
const entries = [];
for (let i = 0; i < scenes.length; i++)
  for (let j = 0; j < scenes[i][1].length; j++) {
    const text = scenes[i][1][j][1],
      name = `demo${String(i + 1).padStart(2, "0")}_${String(j + 1).padStart(2, "0")}`;
    const textHash = createHash("sha256").update(text).digest("hex");
    let audio: Buffer | undefined;
    try {
      const cached = JSON.parse(
        await readFile(resolve(dir, `${name}.json`), "utf8"),
      );
      if (cached.textHash === textHash && cached.voice === voice)
        audio = await readFile(resolve(dir, `${name}.wav`));
    } catch {}
    audio ??= await provider.synthesize(text);
    await writeFile(resolve(dir, `${name}.wav`), audio);
    const entry = {
      name,
      textHash,
      voice,
      model,
      sha256: createHash("sha256").update(audio).digest("hex"),
    };
    await writeFile(
      resolve(dir, `${name}.json`),
      JSON.stringify(entry, null, 2) + "\n",
    );
    entries.push(entry);
    console.log(`${name} ${voice} ${audio.length} 字节`);
  }
await writeFile(
  resolve(dir, "manifest.json"),
  JSON.stringify(
    {
      说明: "预生成配音，不在运行时访问网络；无系统升调处理",
      model,
      voice,
      entries,
    },
    null,
    2,
  ) + "\n",
);
console.log(`已生成 ${entries.length} 条语音：${dir}`);
