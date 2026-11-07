import { localStopRecognizer } from "./local-stop";
import { isYardPhoto, isYardStop } from "./yard-commands";
import { recordingWorker } from "./yard-background";
import {
  recordings,
  recordingsKey,
  recordingSettings,
  type Recording,
} from "./yard-recordings";
import { readWallpaper, saveWallpaper, sendWallpaper } from "./yard-wallpaper";
import { readAvatar } from "./yard-avatar";
import { readOfflinePhotos, rootKey, yardPhotoSecret, type YardState } from "./yard";
import sharp from "sharp";
import { memoryDay } from "./yard-memory-book";
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
  const galleryState = () => core.repo.read<Pick<YardState, "memories" | "preview" | "textStories">>(
    rootKey, { memories: [], preview: null },
  );
  const galleryPhotos = (state: ReturnType<typeof galleryState>) => {
    const photos = new Map(readOfflinePhotos(core.repo)
      .filter((photo) => photo.status === "pending")
      .map((photo) => [photo.id, { id: photo.id, createdAt: photo.receivedAt, photoPath: photo.path }]));
    for (const photo of [...state.memories, ...(state.preview ? [state.preview] : [])]) {
      if (photo.source !== "simulated") photos.set(photo.id, photo);
    }
    return [...photos.values()];
  };

  app.get("/device/v1/yard/gallery", async (req, reply) => {
    const { mode, index, anchor } = z.object({
      mode: z.enum(["stories", "photos"]),
      index: z.coerce.number().int().min(0).default(0),
      anchor: z.uuid().optional(),
    }).parse(req.query);
    const state = galleryState();
    const cards = mode === "photos"
      ? galleryPhotos(state).map((photo) => ({
          id: photo.id, date: memoryDay(photo.createdAt), order: photo.createdAt, story: "",
        }))
      : [
          ...state.memories.filter((photo) => photo.story).map((photo) => ({
            id: photo.id, date: memoryDay(photo.createdAt), order: photo.createdAt, story: photo.story!,
          })),
          ...Object.entries(state.textStories ?? {}).map(([date, story]) => ({
            id: null, date, order: "", story,
          })),
        ];
    cards.sort((a, b) => b.date.localeCompare(a.date) || b.order.localeCompare(a.order) ||
      (a.id ?? "").localeCompare(b.id ?? ""));
    const anchored = anchor ? cards.findIndex((card) => card.id === anchor) : -1;
    const position = Math.min(anchored >= 0 ? anchored : index, cards.length - 1);
    const card = cards[position];
    return reply.header("cache-control", "private, no-store").send({
      count: cards.length,
      index: Math.max(0, position),
      ...(card && { id: card.id, date: card.date, story: card.story }),
    });
  });

  app.post("/device/v1/yard/gallery/:id/memory", async (req, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const state = galleryState();
    const photo = galleryPhotos(state).find((item) => item.id === id);
    if (!photo) return reply.code(404).send({ error: "照片不存在或尚未同步" });

    let memory = state.memories.find((item) => item.id === id);
    if (!memory) {
      const preview = state.preview?.id === id ? state.preview : null;
      const saved = await core.app.inject({
        method: "POST",
        url: preview ? "/api/yard/photo/save" : `/api/yard/offline-photos/${id}/resolve`,
        payload: preview ? { requestId: id, title: preview.title } : { save: true },
      });
      if (saved.statusCode !== 200) return reply.code(saved.statusCode).send(saved.json());
      memory = galleryState().memories.find((item) => item.id === id);
    }
    if (!memory) return reply.code(404).send({ error: "照片已移除" });
    if (!memory.story) {
      const day = memoryDay(memory.createdAt);
      const generated = await core.app.inject({
        url: `/api/yard/memory-book?from=${day}&to=${day}&photoId=${id}`,
      });
      if (generated.statusCode !== 200)
        return reply.code(generated.statusCode).send(generated.json());
      if (!galleryState().memories.some((item) => item.id === id && item.story))
        return reply.code(404).send({ error: "照片已移除" });
    }
    return { id };
  });

  app.get("/device/v1/yard/gallery/:id/image", async (req, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const state = galleryState();
    const photo = galleryPhotos(state).find((item) => item.id === id) ??
      state.memories.find((item) => item.id === id && item.story);
    if (!photo) return reply.code(404).send();
    const image = sharp(photo.photoPath, { limitInputPixels: 24_000_000 })
      .autoOrient().resize(240, 160, { fit: "contain", background: "#fff6e9" })
      .flatten({ background: "#fff6e9" });
    for (const quality of [72, 48, 24, 12]) {
      const jpeg = await image.clone().jpeg({ quality }).toBuffer();
      if (jpeg.length <= 24 * 1024)
        return reply.header("cache-control", "private, no-store").type("image/jpeg").send(jpeg);
    }
    return reply.code(422).send();
  });

  app.get<{ Params: { id: string } }>(
    "/device/v1/yard/wallpaper/:id",
    async (req, reply) => sendWallpaper(core.repo, req.params.id, reply),
  );
  app.put(
    "/device/v1/yard/wallpaper",
    { bodyLimit: 256 * 1024 },
    async (req, reply) => {
      if (
        !Buffer.isBuffer(req.body) ||
        req.headers["content-type"] !== "image/jpeg"
      )
        return reply.code(415).send({ detail: "请选择 JPEG 照片" });
      try {
        return await saveWallpaper(core.repo, req.body);
      } catch (error) {
        if (error instanceof DomainError)
          return reply.code(400).send({ detail: error.message });
        throw error;
      }
    },
  );
  const seasonalGreeting = () => {
    const day = core.yardCalendar();
    if (!day.greeting) return null;
    const key = createHash("sha256")
      .update(JSON.stringify([day.date, day.greeting, core.yardTtsProfile()]))
      .digest("hex")
      .slice(0, 24);
    return { key, text: day.greeting, validMs: day.validForMs() };
  };
  let seasonalAudio: { key: string; wav: Promise<Buffer> } | undefined;
  app.get<{ Params: { key: string } }>(
    "/device/v1/yard/greeting/:key",
    async (req, reply) => {
      const greeting = seasonalGreeting();
      if (!greeting || greeting.key !== req.params.key)
        return reply.code(404).send();
      if (seasonalAudio?.key !== greeting.key) {
        const wav = speech
          .synthesize(greeting.text, { signal: AbortSignal.timeout(8000) })
          .then((bytes) => {
            validateWav(bytes);
            if (bytes.length > 320044) throw new Error("节日招呼音频过长");
            return bytes;
          })
          .catch((error: unknown) => {
            if (seasonalAudio?.key === greeting.key) seasonalAudio = undefined;
            throw error;
          });
        seasonalAudio = { key: greeting.key, wav };
      }
      return reply.type("audio/wav").send(await seasonalAudio.wav);
    },
  );
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
      greeting: seasonalGreeting(),
      avatar: readAvatar(core.repo),
      wallpaper: readWallpaper(core.repo)?.id ?? null,
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
              : isYardDevice && isYardPhoto(text)
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
