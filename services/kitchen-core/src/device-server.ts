import { deviceReply } from "./device-reply";
import Fastify, { type FastifyRequest } from "fastify";
import { DeviceReport, KORVO_BOARD_ID } from "@homestash/protocol";
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  writeFile,
  readdir,
  stat,
  rm,
} from "node:fs/promises";
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
    token?: string;
    deviceId?: string;
    mediaDir: string;
    debugImageDir?: string;
  },
) {
  if (options.token && options.deviceId)
    core.devices.legacy(options.deviceId, options.token);
  const app = Fastify({ logger: false, bodyLimit: MAX_WAV_BYTES });
  const sessions = new WeakMap<
    FastifyRequest,
    { id: string; token: string; boardId: string }
  >();
  const identity = (req: FastifyRequest) => sessions.get(req)!;
  app.addHook("onRequest", async (req, reply) => {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const device =
      !req.headers.origin &&
      core.devices.authenticate(req.headers["x-device-id"], token);
    if (!device) return reply.code(401).send({ error: "设备认证失败" });
    sessions.set(req, { id: device.id, boardId: device.boardId, token });
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
  const key = (req: FastifyRequest, id: string) =>
    `physical:${identity(req).id}:${id}`;
  const seen = (req: FastifyRequest, report: DeviceReport = {}) =>
    core.devices.seen(identity(req).id, report);
  app.get("/device/v1/firmware", async (req, reply) => {
    const release = core.firmware.latest(identity(req).boardId);
    if (
      !release ||
      identity(req).boardId !== (release.boardId ?? KORVO_BOARD_ID)
    )
      return reply.code(404).send({ error: "尚未发布匹配此板型的固件" });
    return {
      ...release,
      boardId: release.boardId ?? KORVO_BOARD_ID,
      signature: firmwareSignature(release, identity(req).token),
    };
  });
  app.get("/device/v1/firmware/:id", async (req, reply) => {
    const { id } = z
      .object({ id: z.string().regex(/^[a-f0-9]{64}$/) })
      .parse(req.params);
    if (!core.firmware.compatible(id, identity(req).boardId))
      return reply.code(404).send({ error: "固件与此板型不匹配" });
    const bytes = await core.firmware.binary(id);
    return bytes
      ? reply.type("application/octet-stream").send(bytes)
      : reply.code(404).send({ error: "固件不存在" });
  });
  app.get("/device/v1/yard/settings", async (req) => {
    seen(req);
    const state = core.repo.read<{
      settings: {
        silent: boolean;
        listening: boolean;
        proactiveVoice: boolean;
      };
    } | null>("product:food-spirit-yard:v1", null);
    return (
      state?.settings ?? {
        silent: false,
        listening: false,
        proactiveVoice: false,
      }
    );
  });
  app.get("/device/v1/screen", async (req) => {
    const { page } = z
      .object({ page: z.enum(devicePages).default("home") })
      .strict()
      .parse(req.query);
    seen(req);
    if (identity(req).boardId === "tuya-t5-ai-board-v1.02") {
      const state = core.repo.read<{
        role: { name: string; line: string };
        memories: { title: string }[];
      } | null>("product:food-spirit-yard:v1", null);
      const text =
        page === "freshness"
          ? "按键开始接话，再按结束。当前身份未知。"
          : page === "recipes"
            ? "相机缺件，尚不能拍照。明确许可后才会采集。"
            : page === "cooking"
              ? `家庭回忆\n${
                  state?.memories
                    .map((m) => m.title)
                    .slice(0, 3)
                    .join("\n") || "还没有保存的回忆"
                }`
              : page === "shopping"
                ? "配套网页可修改角色、静默与语音服务。门传感器未验证。"
                : `萌小冰·食灵小院\n${state?.role.name ?? "草莓食灵"}\n${state?.role.line ?? "说说今天的厨房故事吧。"}`;
      return { text };
    }
    return core.deviceScreen(page);
  });
  app.post("/device/v1/heartbeat", async (req) => {
    seen(req, DeviceReport.parse(req.body ?? {}));
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
    seen(req);
    const hash = createHash("sha256").update(wav).digest("hex");
    return core.once(key(req, id), { hash }, async () => {
      const started = performance.now();
      const asrStarted = performance.now();
      const text = await speech.transcribe(wav);
      const asrMs = performance.now() - asrStarted;
      const isYardDevice = identity(req).boardId === "tuya-t5-ai-board-v1.02";
      const intentStarted = performance.now();
      const commit = isYardDevice ? null : await core.prepareVoice(text);
      const prepareMs = performance.now() - intentStarted;
      return () => {
        const commitStarted = performance.now();
        const applied = commit ? commit() : null;
        const yardApplied = isYardDevice ? core.yardVoice(id, text) : null;
        const commitMs = performance.now() - commitStarted;
        console.info(
          JSON.stringify({
            event: "speech_stage",
            requestId: id,
            deviceId: identity(req).id,
            stage: "capture_pipeline",
            providerMode:
              process.env.ASR_PROVIDER ??
              process.env.SPEECH_PROVIDER ??
              "unverified",
            audioBytes: wav.length,
            asrMs: Math.round(asrMs),
            intentAndPrepareMs: Math.round(prepareMs),
            applyMs: Math.round(commitMs),
            totalMs: Math.round(performance.now() - started),
          }),
        );
        return {
          id,
          text,
          message: yardApplied
            ? yardApplied.reply
            : deviceReply(applied!, core.repo.locations()),
        };
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
      seen(req);
      // 仅显式启用的本地硬件调试留样；默认不保存原始照片，也不提供公开图片 URL。
      if (options.debugImageDir) {
        await mkdir(options.debugImageDir, { recursive: true, mode: 0o700 });
        await writeFile(
          join(options.debugImageDir, `${identity(req).id}-${id}.jpg`),
          req.body,
          {
            mode: 0o600,
          },
        );
      }
      const review = await core.imageIntake.analyze(key(req, id), dataUrl);
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
      `request:${key(req, id)}`,
      null,
    );
    if (!receipt) return reply.code(404).send({ error: "找不到录音处理回执" });
    seen(req);
    const directory = join(options.mediaDir, identity(req).id);
    const audioProfile = createHash("sha256")
      .update(
        JSON.stringify([
          identity(req).id,
          speech.cacheKey ?? "default",
          receipt.result.message,
        ]),
      )
      .digest("hex");
    const path = join(directory, `tts-${audioProfile}.wav`);
    const cacheStarted = performance.now();
    const work = async () => {
      try {
        const bytes = await readFile(path);
        validateWav(bytes);
        console.info(
          JSON.stringify({
            event: "speech_stage",
            requestId: id,
            deviceId: identity(req).id,
            stage: "tts_cache",
            hit: true,
            cacheReadMs: Math.round(performance.now() - cacheStarted),
            audioBytes: bytes.length,
          }),
        );
        return bytes;
      } catch {
        /* 缓存缺失或损坏时重新生成。 */
      }
      const controller = new AbortController();
      const abort = () => controller.abort();
      req.raw.once("aborted", abort);
      reply.raw.once("close", () => {
        if (!reply.raw.writableEnded) abort();
      });
      const synthStarted = performance.now();
      let wav: Buffer;
      try {
        wav = await speech.synthesize(receipt.result.message, {
          signal: controller.signal,
          requestId: id,
        });
      } finally {
        req.raw.off("aborted", abort);
      }
      validateWav(wav);
      await mkdir(directory, { recursive: true });
      await writeFile(`${path}.tmp`, wav, { mode: 0o600 });
      await rename(`${path}.tmp`, path);
      console.info(
        JSON.stringify({
          event: "speech_stage",
          requestId: id,
          deviceId: identity(req).id,
          stage: "tts_cache",
          hit: false,
          cacheWriteMs: Math.round(performance.now() - synthStarted),
          audioBytes: wav.length,
        }),
      );
      try {
        const entries = await Promise.all(
          (await readdir(directory))
            .filter((name) => name.startsWith("tts-") && name.endsWith(".wav"))
            .map(async (name) => ({
              name,
              path: join(directory, name),
              mtime: (await stat(join(directory, name))).mtimeMs,
              size: (await stat(join(directory, name))).size,
            })),
        );
        entries.sort((a, b) => b.mtime - a.mtime);
        let total = 0;
        for (const item of entries) {
          total += item.size;
          if (total > 20 * 1024 * 1024 || entries.indexOf(item) >= 50)
            await rm(item.path, { force: true });
        }
      } catch {
        /* 缓存回收失败不影响本次播报 */
      }
      return wav;
    };
    const jobId = `tts:${audioProfile}`;
    let job = audioJobs.get(jobId);
    if (!job) {
      job = work();
      audioJobs.set(jobId, job);
    }
    try {
      const bytes = await job;
      console.info(
        JSON.stringify({
          event: "speech_stage",
          requestId: id,
          deviceId: identity(req).id,
          stage: "core_audio_response",
          waitMs: Math.round(performance.now() - cacheStarted),
          audioBytes: bytes.length,
        }),
      );
      return reply.type("audio/wav").send(bytes);
    } finally {
      audioJobs.delete(jobId);
    }
  });
  return app;
}
