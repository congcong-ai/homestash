import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
const exec = promisify(execFile);
export interface SpeechProvider {
  readonly cacheKey?: string;
  transcribe(wav: Buffer): Promise<string>;
  synthesize(text: string): Promise<Buffer>;
}
export const MAX_WAV_BYTES = 1920044;
export function pcmWav(pcm: Buffer): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF");
  h.writeUInt32LE(pcm.length + 36, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24);
  h.writeUInt32LE(32000, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
export function validateWav(wav: Buffer) {
  if (
    wav.length < 46 ||
    wav.length > MAX_WAV_BYTES ||
    (wav.length - 44) % 2 ||
    !wav.subarray(0, 44).equals(pcmWav(wav.subarray(44)).subarray(0, 44))
  )
    throw new Error("仅支持不超过 60 秒的 16 kHz 单声道 16 bit PCM 固定头 WAV");
}
export async function normalizeAudio(audio: Buffer) {
  const dir = await mkdtemp(join(tmpdir(), "homestash-audio-"));
  try {
    const path = join(dir, "source.wav");
    await writeFile(path, audio, { mode: 0o600 });
    const { stdout } = await exec(
      process.env.FFMPEG_PATH ?? "ffmpeg",
      [
        "-v",
        "error",
        "-nostdin",
        "-i",
        path,
        "-f",
        "s16le",
        "-ac",
        "1",
        "-ar",
        "16000",
        "pipe:1",
      ],
      { encoding: "buffer", maxBuffer: 1920000, timeout: 30000 },
    );
    const wav = pcmWav(stdout);
    validateWav(wav);
    return wav;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
async function limited(response: Response, max: number) {
  if (!response.ok || !response.body)
    throw new Error(`语音服务响应失败（HTTP ${response.status}）`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > max) throw new Error("语音服务响应超出限制");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export class BailianSpeechProvider implements SpeechProvider {
  constructor(
    private config: {
      baseUrl: string;
      compatibleUrl: string;
      key: string;
      asrModel: string;
      ttsModel: string;
      voice: string;
    },
  ) {}
  get cacheKey() {
    return JSON.stringify([this.config.ttsModel, this.config.voice]);
  }
  private async request(url: string, body: unknown) {
    if (!this.config.key) throw new Error("尚未配置百炼 API Key");
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90000),
    });
    return JSON.parse(
      (await limited(response, 8_000_000)).toString(),
    ) as unknown;
  }
  async transcribe(wav: Buffer) {
    validateWav(wav);
    const result = await this.request(
      `${this.config.compatibleUrl}/chat/completions`,
      {
        model: this.config.asrModel,
        stream: false,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "input_audio",
                input_audio: {
                  data: `data:audio/wav;base64,${wav.toString("base64")}`,
                },
              },
            ],
          },
        ],
        asr_options: { language: "zh", enable_itn: true },
      },
    );
    return z
      .object({
        choices: z
          .array(
            z.object({
              message: z.object({
                content: z.string().trim().min(1).max(2000),
              }),
            }),
          )
          .min(1),
      })
      .parse(result).choices[0].message.content;
  }
  async synthesize(text: string) {
    const result = await this.request(
      `${this.config.baseUrl}/api/v1/services/aigc/multimodal-generation/generation`,
      {
        model: this.config.ttsModel,
        input: { text, voice: this.config.voice, language_type: "Chinese" },
      },
    );
    const data = z
      .object({ output: z.object({ audio: z.object({ url: z.string() }) }) })
      .parse(result);
    const url = new URL(data.output.audio.url);
    // 只允许百炼生成的 OSS 音频域名，不向下载地址传递 API Key。
    if (
      !url.hostname.endsWith(".aliyuncs.com") ||
      !url.hostname.startsWith("dashscope-result-") ||
      !["http:", "https:"].includes(url.protocol)
    )
      throw new Error("语音下载地址无效");
    url.protocol = "https:";
    const response = await fetch(url, {
      signal: AbortSignal.timeout(30000),
      redirect: "error",
    });
    return normalizeAudio(await limited(response, 8_000_000));
  }
}
export function speechFromEnv(): SpeechProvider {
  if (process.env.SPEECH_PROVIDER !== "bailian")
    return {
      async transcribe() {
        throw new Error("尚未配置真实语音识别");
      },
      async synthesize() {
        throw new Error("尚未配置真实语音合成");
      },
    };
  return new BailianSpeechProvider({
    baseUrl: (
      process.env.BAILIAN_BASE_URL ?? "https://dashscope.aliyuncs.com"
    ).replace(/\/$/, ""),
    compatibleUrl: (
      process.env.AI_BASE_URL ??
      "https://dashscope.aliyuncs.com/compatible-mode/v1"
    ).replace(/\/$/, ""),
    key: process.env.AI_API_KEY ?? "",
    asrModel: process.env.ASR_MODEL ?? "qwen3-asr-flash",
    ttsModel: process.env.TTS_MODEL ?? "qwen3-tts-flash",
    voice: process.env.TTS_VOICE ?? "Momo",
  });
}
