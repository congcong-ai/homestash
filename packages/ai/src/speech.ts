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
  synthesize(
    text: string,
    options?: { signal?: AbortSignal; requestId?: string },
  ): Promise<Buffer>;
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
    return JSON.stringify([
      "bailian",
      this.config.baseUrl,
      this.config.ttsModel,
      this.config.voice,
      "pcm-wav-16k-mono-v1",
    ]);
  }
  private async request(url: string, body: unknown, signal?: AbortSignal) {
    if (!this.config.key) throw new Error("尚未配置百炼 API Key");
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(90000)])
        : AbortSignal.timeout(90000),
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
  async synthesize(
    text: string,
    options: { signal?: AbortSignal; requestId?: string } = {},
  ) {
    const started = performance.now();
    const result = await this.request(
      `${this.config.baseUrl}/api/v1/services/aigc/multimodal-generation/generation`,
      {
        model: this.config.ttsModel,
        input: { text, voice: this.config.voice, language_type: "Chinese" },
      },
      options.signal,
    );
    const data = z
      .object({ output: z.object({ audio: z.object({ url: z.string() }) }) })
      .parse(result);
    const generatedAt = performance.now();
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
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
      redirect: "error",
    });
    const downloaded = await limited(response, 8_000_000);
    const downloadedAt = performance.now();
    const wav = await normalizeAudio(downloaded);
    console.info(
      JSON.stringify({
        event: "speech_stage",
        requestId: options.requestId,
        provider: "bailian",
        stage: "tts",
        model: this.config.ttsModel,
        voice: this.config.voice,
        generationMs: Math.round(generatedAt - started),
        downloadMs: Math.round(downloadedAt - generatedAt),
        normalizeMs: Math.round(performance.now() - downloadedAt),
        totalMs: Math.round(performance.now() - started),
        audioBytes: wav.length,
      }),
    );
    return wav;
  }
}

/**
 * 本地主机适配器的唯一协议：POST {endpoint}/v1/audio/speech，JSON 输入，
 * 返回 16 kHz、单声道、16 bit PCM 的固定头 WAV。它不声称兼容其他 TTS API。
 */
export class LocalHttpTtsProvider implements SpeechProvider {
  constructor(
    private config: {
      endpoint: string;
      model: string;
      voice: string;
      speed?: number;
      apiKey?: string;
      timeoutMs: number;
    },
  ) {}
  get cacheKey() {
    return JSON.stringify([
      "local-http",
      this.config.endpoint,
      this.config.model,
      this.config.voice,
      this.config.speed ?? 1,
      "pcm-wav-16k-mono-v1",
    ]);
  }
  async transcribe(): Promise<string> {
    throw new Error("local-http 仅提供 TTS；ASR 使用独立配置");
  }
  async synthesize(
    text: string,
    options: { signal?: AbortSignal; requestId?: string } = {},
  ) {
    const started = performance.now();
    const endpoint = `${this.config.endpoint.replace(/\/$/, "")}/v1/audio/speech`;
    const signal = options.signal
      ? AbortSignal.any([
          options.signal,
          AbortSignal.timeout(this.config.timeoutMs),
        ])
      : AbortSignal.timeout(this.config.timeoutMs);
    const response = await fetch(endpoint, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        accept: "audio/wav",
        ...(this.config.apiKey
          ? { authorization: `Bearer ${this.config.apiKey}` }
          : {}),
      },
      body: JSON.stringify({
        model: this.config.model,
        voice: this.config.voice,
        speed: this.config.speed ?? 1,
        input: text,
        response_format: "pcm-wav-16k-mono",
      }),
    });
    if (!response.ok || !response.body)
      throw new Error(`本地主机 TTS 响应失败（HTTP ${response.status}）`);
    const headersMs = Math.round(performance.now() - started);
    const bytes = await limited(response, MAX_WAV_BYTES);
    if (
      !/^audio\/(wav|wave|x-wav)(\s*;|$)/i.test(
        response.headers.get("content-type") ?? "",
      )
    )
      throw new Error("本地主机 TTS 必须返回 audio/wav");
    validateWav(bytes);
    console.info(
      JSON.stringify({
        event: "speech_stage",
        requestId: options.requestId,
        provider: "local-http",
        stage: "tts",
        model: this.config.model,
        voice: this.config.voice,
        headersMs,
        completeResponseMs: Math.round(performance.now() - started),
        totalMs: Math.round(performance.now() - started),
        audioBytes: bytes.length,
      }),
    );
    return bytes;
  }
}

class RoutedSpeechProvider implements SpeechProvider {
  constructor(
    private asr: SpeechProvider,
    private resolveTts: () => SpeechProvider,
  ) {}
  get cacheKey() {
    return this.resolveTts().cacheKey;
  }
  transcribe(wav: Buffer) {
    return this.asr.transcribe(wav);
  }
  synthesize(
    text: string,
    options?: { signal?: AbortSignal; requestId?: string },
  ) {
    return this.resolveTts().synthesize(text, options);
  }
}
export type TtsProfile = {
  provider?: string;
  model?: string;
  voice?: string;
  speed?: number;
};
export function speechFromEnv(
  getProfile: () => TtsProfile = () => ({}),
): SpeechProvider {
  const unavailable: SpeechProvider = {
    async transcribe() {
      throw new Error("尚未配置真实语音识别");
    },
    async synthesize() {
      throw new Error("尚未配置真实语音合成");
    },
  };
  const bailianConfig = {
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
  };
  const legacy = process.env.SPEECH_PROVIDER;
  const asrProvider = process.env.ASR_PROVIDER ?? legacy ?? "disabled";
  const ttsProvider =
    process.env.TTS_PROVIDER ?? (legacy === "bailian" ? "bailian" : "disabled");
  const asr =
    asrProvider === "bailian"
      ? new BailianSpeechProvider(bailianConfig)
      : unavailable;
  const resolveTts = () => {
    const profile = getProfile();
    const selected = profile.provider ?? ttsProvider;
    if (selected === "bailian")
      return new BailianSpeechProvider({
        ...bailianConfig,
        ttsModel: profile.model || bailianConfig.ttsModel,
        voice: profile.voice || bailianConfig.voice,
      });
    if (selected === "local-http") {
      const raw = process.env.LOCAL_TTS_URL;
      if (!raw) throw new Error("本地主机 TTS 尚未配置 LOCAL_TTS_URL");
      const endpoint = new URL(raw);
      if (
        !["http:", "https:"].includes(endpoint.protocol) ||
        endpoint.username ||
        endpoint.password ||
        endpoint.search ||
        endpoint.hash
      )
        throw new Error(
          "LOCAL_TTS_URL 必须为不含凭据、查询参数或片段的 HTTP(S) 服务地址",
        );
      return new LocalHttpTtsProvider({
        endpoint: endpoint.toString().replace(/\/$/, ""),
        model: profile.model || process.env.LOCAL_TTS_MODEL || "default",
        voice: profile.voice || process.env.LOCAL_TTS_VOICE || "default",
        speed: profile.speed,
        apiKey: process.env.LOCAL_TTS_API_KEY,
        timeoutMs: Number(process.env.LOCAL_TTS_TIMEOUT_MS ?? 30000),
      });
    }
    return unavailable;
  };
  return new RoutedSpeechProvider(asr, resolveTts);
}
