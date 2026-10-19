import Fastify from "fastify";
import { createHash, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { DomainError } from "@homestash/domain";
import {
  MAX_WAV_BYTES,
  validateWav,
  type SpeechProvider,
} from "@homestash/ai/speech";
import type { createApp } from "./app";
export function createDeviceServer(
  core: ReturnType<typeof createApp>,
  speech: SpeechProvider,
  options: { token: string; deviceId: string; mediaDir: string },
) {
  if (options.token.length < 32)
    throw new Error("设备 Token 至少需要 32 个字符");
  const app = Fastify({ logger: false, bodyLimit: MAX_WAV_BYTES });
  app.addHook("onRequest", async (req, reply) => {
    const actual = Buffer.from(req.headers.authorization ?? "");
    const expected = Buffer.from(`Bearer ${options.token}`);
    if (
      req.headers.origin ||
      req.headers["x-device-id"] !== options.deviceId ||
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    )
      return reply.code(401).send({ error: "设备认证失败" });
  });
  app.addContentTypeParser(
    "audio/wav",
    { parseAs: "buffer" },
    (_req, body, done) => done(null, body),
  );
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof z.ZodError)
      return reply.code(400).send({ error: "协议字段无效" });
    if (err instanceof DomainError)
      return reply.code(409).send({ error: err.message });
    const code = (err as { statusCode?: number }).statusCode;
    return reply
      .code(code && code >= 400 && code < 500 ? code : 503)
      .send({ error: "设备请求未完成，请保留相同录音 ID 重试" });
  });
  const params = (value: unknown) => z.object({ id: z.uuid() }).parse(value);
  const key = (id: string) => `physical:${options.deviceId}:${id}`;
  const reportSchema = z
    .object({
      screen: z.string().max(1024).optional(),
      network: z.string().max(96).optional(),
      screenRevision: z.number().int().nonnegative().optional(),
      uptimeMs: z.number().int().nonnegative().optional(),
    })
    .strict();
  const seen = (report: z.infer<typeof reportSchema> = {}) =>
    core.repo.write("physical-device", {
      ...core.repo.read<Record<string, unknown>>("physical-device", {}),
      ...report,
      id: options.deviceId,
      lastSeen: new Date().toISOString(),
    });
  app.post("/device/v1/heartbeat", async (req) => {
    seen(reportSchema.parse(req.body ?? {}));
    return { ok: true };
  });
  app.post("/device/v1/captures/:id", async (req, reply) => {
    const { id } = params(req.params);
    const wav = req.body as Buffer;
    try {
      if (!Buffer.isBuffer(wav)) throw new Error();
      validateWav(wav);
    } catch {
      return reply
        .code(400)
        .send({ error: "录音必须为 16 kHz 单声道 16 bit PCM WAV，最长 60 秒" });
    }
    seen();
    const hash = createHash("sha256").update(wav).digest("hex");
    return core.once(key(id), { hash }, async () => {
      const text = await speech.transcribe(wav);
      const commit = await core.prepareVoice(text);
      return () => {
        const applied = commit();
        return { id, text, message: applied.message };
      };
    });
  });
  // 播报独立于库存事务；失败后重试不能再次执行意图。
  const audioJobs = new Map<string, Promise<Buffer>>();
  app.get("/device/v1/captures/:id/audio", async (req, reply) => {
    const { id } = params(req.params);
    const receipt = core.repo.read<{ result: { message: string } } | null>(
      `request:${key(id)}`,
      null,
    );
    if (!receipt) return reply.code(404).send({ error: "找不到录音处理回执" });
    seen();
    const path = join(options.mediaDir, `${id}.wav`);
    const work = async () => {
      try {
        const bytes = await readFile(path);
        validateWav(bytes);
        return bytes;
      } catch {
        /* 缓存缺失或损坏时重新生成。 */
      }
      const wav = await speech.synthesize(receipt.result.message);
      validateWav(wav);
      await mkdir(options.mediaDir, { recursive: true });
      await writeFile(`${path}.tmp`, wav, { mode: 0o600 });
      await rename(`${path}.tmp`, path);
      return wav;
    };
    let job = audioJobs.get(id);
    if (!job) {
      job = work();
      audioJobs.set(id, job);
    }
    try {
      return reply.type("audio/wav").send(await job);
    } finally {
      audioJobs.delete(id);
    }
  });
  return app;
}
