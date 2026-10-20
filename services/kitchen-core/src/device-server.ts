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
import { firmwareSignature } from "./firmware";
import { devicePages } from "./device-screen";
import { validateImage } from "./image-intake";
import type { createApp } from "./app";
export function createDeviceServer(
  core: ReturnType<typeof createApp>,
  speech: SpeechProvider,
  options: {
    token: string;
    deviceId: string;
    mediaDir: string;
    debugImageDir?: string;
  },
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
  app.addContentTypeParser(
    "image/jpeg",
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
      .send({ error: "设备请求未完成，请保留相同采集 ID 重试" });
  });
  const params = (value: unknown) => z.object({ id: z.uuid() }).parse(value);
  const key = (id: string) => `physical:${options.deviceId}:${id}`;
  const reportSchema = z
    .object({
      screen: z.string().max(1024).optional(),
      network: z.string().max(96).optional(),
      screenRevision: z.number().int().nonnegative().optional(),
      uptimeMs: z.number().int().nonnegative().optional(),
      firmwareVersion: z.string().max(32).optional(),
      firmwarePartition: z.string().max(16).optional(),
      firmwareElf: z
        .string()
        .regex(/^[a-f0-9]{8,64}$/)
        .optional(),
      otaState: z.string().max(160).optional(),
      powerState: z
        .enum(["Idle", "Active", "Light Sleep", "Deep Sleep"])
        .optional(),
      freeHeapBytes: z.number().int().nonnegative().optional(),
      minimumFreeHeapBytes: z.number().int().nonnegative().optional(),
    })
    .strict();
  const seen = (report: z.infer<typeof reportSchema> = {}) =>
    core.repo.write("physical-device", {
      ...core.repo.read<Record<string, unknown>>("physical-device", {}),
      ...report,
      id: options.deviceId,
      lastSeen: new Date().toISOString(),
    });
  app.get("/device/v1/firmware", async (_req, reply) => {
    const release = core.firmware.latest();
    if (!release) return reply.code(404).send({ error: "尚未发布固件" });
    return { ...release, signature: firmwareSignature(release, options.token) };
  });
  app.get("/device/v1/firmware/:id", async (req, reply) => {
    const { id } = z
      .object({ id: z.string().regex(/^[a-f0-9]{64}$/) })
      .parse(req.params);
    const bytes = await core.firmware.binary(id);
    return bytes
      ? reply.type("application/octet-stream").send(bytes)
      : reply.code(404).send({ error: "固件不存在" });
  });
  app.get("/device/v1/screen", async (req) => {
    const { page } = z
      .object({ page: z.enum(devicePages).default("home") })
      .strict()
      .parse(req.query);
    seen();
    return core.deviceScreen(page);
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
  app.post(
    "/device/v1/images/:id",
    { bodyLimit: 3 * 1024 * 1024 },
    async (req, reply) => {
      const { id } = params(req.params);
      if (
        !Buffer.isBuffer(req.body) ||
        req.headers["content-type"]?.split(";")[0] !== "image/jpeg"
      )
        return reply.code(400).send({ error: "相机上传必须为 JPEG 二进制" });
      const dataUrl = `data:image/jpeg;base64,${req.body.toString("base64")}`;
      try {
        validateImage(dataUrl);
      } catch {
        return reply.code(400).send({ error: "JPEG 内容无效，库存未改变" });
      }
      seen();
      // 仅显式启用的本地硬件调试留样；默认不保存原始照片，也不提供公开图片 URL。
      if (options.debugImageDir) {
        await mkdir(options.debugImageDir, { recursive: true, mode: 0o700 });
        await writeFile(join(options.debugImageDir, `${id}.jpg`), req.body, {
          mode: 0o600,
        });
      }
      const review = await core.imageIntake.analyze(
        `physical:${options.deviceId}:${id}`,
        dataUrl,
      );
      return {
        id,
        reviewId: review.id,
        message:
          review.status === "pending"
            ? `照片已识别，共 ${review.candidates.length} 个候选。请到网页拍照入库中确认。`
            : "照片已处理，请到网页查看识别记录。",
      };
    },
  );
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
