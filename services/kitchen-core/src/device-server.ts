import { localStopRecognizer } from "./local-stop";
import { isYardStop } from "./yard-commands";
import { recordingWorker } from "./yard-background";
import {
  recordings,
  recordingsKey,
  recordingSettings,
  type Recording,
} from "./yard-recordings";
import { readAvatar } from "./yard-avatar";
import { yardPhotoSecret } from "./yard";
import { readYardRules } from "./yard-rules";
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
  if (process.env.HOMESTASH_DEVICE_DIAGNOSTICS === "1") {
    app.server.on("connection", (socket) =>
      console.log(
        JSON.stringify({
          event: "device_tcp_connected",
          remoteAddress: socket.remoteAddress,
        }),
      ),
    );
    app.addHook("onRequest", async (req) => {
      console.log(
        JSON.stringify({
          event: "device_http_received",
          method: req.method,
          path: req.url.split("?")[0],
        }),
      );
    });
  }
  const localStop = localStopRecognizer();
  app.addHook("onClose", async () => localStop.close());
  const background = recordingWorker(core.repo, speech);
  app.addHook("onClose", async () => background.close());
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
    if (req.url.includes("/captures/") || req.url.includes("/yard/activity"))
      background.active(device.id);
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
  app.post(
    "/device/v1/yard/photo-archive/:id",
    { bodyLimit: 350000 },
    async (req, reply) => {
      if (identity(req).boardId !== "tuya-t5-ai-board-v1.02")
        return reply.code(403).send({ error: "板型不支持" });
      const { id } = params(req.params);
      const bytes = req.body as Buffer;
      if (!Buffer.isBuffer(bytes))
        return reply.code(400).send({ error: "照片格式无效" });
      const response = await core.app.inject({
        method: "POST",
        url: "/api/yard/offline-photos/upload",
        headers: { "x-yard-internal": yardPhotoSecret(core.repo) },
        payload: {
          id,
          deviceId: identity(req).id,
          jpegBase64: bytes.toString("base64"),
        },
      });
      return reply
        .code(response.statusCode)
        .type("application/json")
        .send(response.body);
    },
  );
  app.post(
    "/device/v1/yard/photos/:id/:operation",
    { bodyLimit: 350000 },
    async (req, reply) => {
      if (identity(req).boardId !== "tuya-t5-ai-board-v1.02")
        return reply.code(403).send({ error: "板型不支持" });
      const { id, operation } = z
        .object({
          id: z.uuid(),
          operation: z.enum(["begin", "upload", "failed", "status"]),
        })
        .parse(req.params);
      const response = await core.app.inject({
        method: "POST",
        url: `/api/yard/photo/device/${operation}`,
        headers: { "x-yard-internal": yardPhotoSecret(core.repo) },
        payload: {
          id,
          deviceId: identity(req).id,
          ...(operation === "upload"
            ? { jpegBase64: (req.body as Buffer).toString("base64") }
            : { ready: (req.body as { ready?: boolean })?.ready }),
        },
      });
      return reply
        .code(response.statusCode)
        .type("application/json")
        .send(response.body);
    },
  );
  app.get("/device/v1/yard/local-stop/status", async () => localStop.status());
  app.post("/device/v1/yard/activity", async (req) => {
    background.active(identity(req).id);
    return { active: true };
  });
  app.get("/device/v1/yard/settings", async (req) => {
    background.inactive(identity(req).id);
    seen(req);
    const state = core.repo.read<{
      settings: {
        silent: boolean;
        listening: boolean;
        proactiveVoice: boolean;
      };
    } | null>("product:food-spirit-yard:v1", null);
    return {
      avatar: readAvatar(core.repo),
      ...(state?.settings ?? {
        silent: false,
        listening: false,
        proactiveVoice: false,
      }),
    };
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
            ? "点击拍照即可采集。拍后可在网页预览、重拍、放弃或保存。"
            : page === "cooking"
              ? `家庭回忆\n${
                  state?.memories
                    .map((m) => m.title)
                    .slice(0, 3)
                    .join("\n") || "还没有保存的回忆"
                }`
              : page === "shopping"
                ? "配套网页可修改角色、静默与语音服务。门传感器未验证。"
                : `萌小冰·食灵小院\n${state?.role.name ?? "草莓食灵"}\n${readYardRules(core.repo).rules.find((r) => r.enabled && r.trigger === "wake")?.line ?? state?.role.line ?? "说说今天的厨房故事吧。"}`;
      return { text };
    }
    return core.deviceScreen(page);
  });
  app.post("/device/v1/heartbeat", async (req) => {
    seen(req, DeviceReport.parse(req.body ?? {}));
    return { ok: true };
  });
  const archiveUploads = new Map<
    string,
    {
      deviceId: string;
      hash: string;
      promise: Promise<{ id: string; stored: boolean }>;
    }
  >();
  // 回忆归档独立于实时对话，不重放旧业务，也不默认调用付费ASR。
  app.post("/device/v1/yard/recordings/:id", async (req, reply) => {
    const { id } = params(req.params);
    const bytes = req.body as Buffer;
    try {
      validateWav(bytes);
    } catch {
      return reply.code(400).send({ error: "录音格式无效" });
    }
    const deviceId = identity(req).id;
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const old = recordings(core.repo).find((v) => v.id === id);
    if (old) {
      if (old.deviceId !== deviceId || old.sha256 !== sha256)
        return reply.code(409).send({ error: "录音身份或内容冲突" });
      return { id, stored: true };
    }
    const inFlight = archiveUploads.get(id);
    if (inFlight) {
      if (inFlight.hash !== sha256 || inFlight.deviceId !== deviceId)
        return reply.code(409).send({ error: "录音身份或内容冲突" });
      return inFlight.promise;
    }
    const work = (async () => {
      const directory = join(options.mediaDir, deviceId, "recordings");
      await mkdir(directory, { recursive: true });
      const path = join(directory, `${id}.wav`);
      await writeFile(`${path}.tmp`, bytes, { mode: 0o600 });
      await rename(`${path}.tmp`, path);
      const item: Recording = {
        id,
        deviceId,
        path,
        sha256,
        bytes: bytes.length,
        createdAt: new Date().toISOString(),
        speakerId: null,
        analysis: recordingSettings(core.repo).transcribe
          ? "pending"
          : "disabled",
      };
      // 保存先于分析，分析错误也不能丢失原录音。
      core.repo.write(recordingsKey, [...recordings(core.repo), item]);
      return { id, stored: true };
    })();
    archiveUploads.set(id, { deviceId, hash: sha256, promise: work });
    try {
      return await work;
    } finally {
      archiveUploads.delete(id);
    }
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
      const localStarted = performance.now();
      const local =
        req.headers["x-speech-mode"] === "interruption"
          ? await localStop.recognize(wav)
          : null;
      const text = local === true ? "退下" : await speech.transcribe(wav);
      if (req.headers["x-speech-mode"] === "interruption")
        console.info(
          JSON.stringify({
            event: "local_stop",
            requestId: id,
            matched: local === true,
            available: local !== null,
            ms: Math.round(performance.now() - localStarted),
          }),
        );
      const asrMs = performance.now() - asrStarted;
      const isYardDevice = identity(req).boardId === "tuya-t5-ai-board-v1.02";
      const intentStarted = performance.now();
      const commit = isYardDevice ? null : await core.prepareVoice(text);
      const yardCommit = isYardDevice
        ? await core.prepareYardVoice(id, text)
        : null;
      const prepareMs = performance.now() - intentStarted;
      return () => {
        const commitStarted = performance.now();
        const applied = commit ? commit() : null;
        const yardApplied = yardCommit ? yardCommit() : null;
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
          action:
            isYardDevice && isYardStop(text)
              ? "stop"
              : isYardDevice &&
                  /^(?:请|帮我|给我|我们)?(?:拍照|拍一张|拍张照|合影|留影)(?:吧|。|！|!)?$/.test(
                    text.trim(),
                  )
                ? "photo"
                : null,
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
