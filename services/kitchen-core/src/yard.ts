import { isYardStop } from "./yard-commands";
import { registerRecordings } from "./yard-recordings";
import { registerFood, foodInteraction } from "./yard-food";
import { registerAvatar } from "./yard-avatar";
import { prepareYardChat } from "./yard-chat";
import {
  applyYardRuleEffect,
  registerYardRules,
  matchYardRule,
} from "./yard-rules";
import type { FastifyInstance } from "fastify";
import type { SQLiteRepository } from "@homestash/database";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { validateImage } from "./image-intake";

export type YardPhotoJob = {
  id: string;
  deviceId: string;
  expiresAt: number;
  status: "capturing" | "preview" | "cancelled" | "failed";
};
const photoKey = "yard:photo:job";
const cameraKey = "yard:photo:camera";

type YardMemory = {
  id: string;
  title: string;
  createdAt: string;
  roleName: string;
  photoPath: string;
  source: "device" | "simulated";
};
type YardState = {
  version: 1;
  role: {
    name: string;
    line: string;
    createdAt: string | null;
    keepsakeCount: number;
    previousName?: string;
  };
  settings: {
    proactiveVoice: boolean;
    listening: boolean;
    silent: boolean;
    ttsProvider: string;
  };
  tts: { provider: string; model: string; voice: string; speed: number };
  interactions: {
    id: string;
    text: string;
    reply: string;
    createdAt: string;
    simulated: boolean;
  }[];
  memories: YardMemory[];
  consent: { token: string; expiresAt: number; accepted: boolean } | null;
  preview: {
    id: string;
    title: string;
    createdAt: string;
    photoPath: string;
    source: "device" | "simulated";
  } | null;
};

const empty: YardState = {
  version: 1,
  role: {
    name: "莓莓",
    line: "莓莓在，甜甜的陪伴就在。",
    createdAt: null,
    keepsakeCount: 0,
  },
  settings: {
    proactiveVoice: true,
    listening: true,
    silent: false,
    ttsProvider: process.env.TTS_PROVIDER ?? "bailian",
  },
  tts: {
    provider:
      process.env.TTS_PROVIDER ??
      (process.env.SPEECH_PROVIDER === "bailian" ? "bailian" : "disabled"),
    model: process.env.TTS_MODEL ?? "qwen3-tts-flash",
    voice: process.env.TTS_VOICE ?? "Momo",
    speed: 1,
  },
  interactions: [],
  memories: [],
  consent: null,
  preview: null,
};
export const rootKey = "product:food-spirit-yard:v1";
const defaultTts = structuredClone(empty.tts);
export function yardTtsProfile(repo: SQLiteRepository) {
  return (
    repo.read<YardState>(rootKey, structuredClone(empty)).tts ?? defaultTts
  );
}
export function applyYardInteraction(
  repo: SQLiteRepository,
  requestId: string,
  rawText: string,
  simulated = false,
  chatReply?: string,
) {
  const key = `yard:interaction:${requestId}`;
  const previous = repo.read<{
    id: string;
    text: string;
    reply: string;
    createdAt: string;
    simulated: boolean;
    role: YardState["role"];
  } | null>(key, null);
  if (previous) return previous;
  const state = repo.read<YardState>(rootKey, structuredClone(empty));
  const text = rawText.trim();
  let matchedRule: ReturnType<typeof matchYardRule>;
  let response = "我在听呀。聊聊今天吃了什么，或是认识一下萌萌伙伴吧？";
  const rename = text.match(/(?:叫它|给它起名|改名叫|名字叫|就叫)(.{1,20})$/);
  if (isYardStop(text)) {
    state.consent = null;
    response = "这次已停止，我们歇一会儿。";
  } else if (rename && state.role.createdAt) {
    const oldName = state.role.name;
    state.role.previousName = oldName;
    state.role.name = rename[1].replace(/[。！!？?，,]$/, "").trim();
    response = `好呀，${oldName}以后就叫${state.role.name}。`;
  } else if (/(草莓|莓果)/.test(text) && !state.role.createdAt) {
    state.role.createdAt = new Date().toISOString();
    state.role.keepsakeCount++;
    response = "草莓来啦！我是莓莓，甜甜的陪伴来报到。你也可以给我起个小名哦。";
  } else if (
    /^(撤销改名|恢复上个名字)[。！!？?]?$/.test(text) &&
    state.role.previousName
  ) {
    state.role.name = state.role.previousName;
    delete state.role.previousName;
    response = `已经恢复为${state.role.name}。`;
  } else if (
    /^(好|好的|好呀|可以|我答应|拍吧)[。！!？?]?$/.test(text) &&
    state.consent &&
    state.consent.expiresAt > Date.now()
  ) {
    state.consent.accepted = true;
    response = "收到。请在设备主屏点击拍照，即可直接采集。";
  } else if (/^(不拍|算了|取消|不要|不了)[。！!？?]?$/.test(text)) {
    state.consent = null;
    response = "好，这次不拍了。我们继续聊聊吧。";
  } else if (/(拍照|拍一张|拍张照|合影|留影)/.test(text)) {
    state.consent = {
      token: crypto.randomUUID(),
      expiresAt: Date.now() + 90_000,
      accepted: false,
    };
    response = simulated
      ? "请在设备主屏点击拍照，即可直接采集。"
      : "正在准备拍照，照片会在网页预览，确认后才保存。";
  }
  // 内置许可、取消和命名分支优先；规则不能执行拍照或任意代码。
  if (response === "我在听呀。聊聊今天吃了什么，或是认识一下萌萌伙伴吧？") {
    const rule = matchYardRule(repo, text);
    if (rule) {
      response = rule.line;
      matchedRule = rule;
    } else {
      response =
        chatReply ??
        "小冰现在只会简单接话，还没开启 AI 聊天。可以先试试你在上面教给我的回答。";
    }
  }
  if (
    !isYardStop(text) &&
    !simulated &&
    !matchedRule &&
    !rename &&
    !/(拍照|拍一张|合影|取消|停止)/.test(text)
  ) {
    const foodReply = foodInteraction(repo, requestId, text);
    if (foodReply)
      response = foodReply.startsWith("这顿")
        ? foodReply
        : `${response} ${foodReply}`;
  }
  const item = {
    id: requestId,
    text,
    reply: response,
    createdAt: new Date().toISOString(),
    simulated,
  };
  state.interactions = [...state.interactions.slice(-49), item];
  const result = { ...item, role: state.role };
  repo.sqlite.transaction(() => {
    applyYardRuleEffect(repo, matchedRule);
    repo.write(rootKey, state);
    repo.write(key, result);
  })();
  return result;
}

export function registerYardRoutes(
  app: FastifyInstance,
  repo: SQLiteRepository,
  mediaRoot: string,
) {
  registerYardRules(app, repo);
  registerAvatar(app, repo);
  registerFood(app, repo);
  registerRecordings(app, repo);
  // 局部插件锁住小院写请求，避免文件 I/O 期间保存/取消互相覆盖；旧后台不受影响。
  app.register(async (app) => {
    let tail = Promise.resolve();
    const releases = new WeakMap<object, () => void>();
    app.addHook("preHandler", async (req) => {
      if (req.method === "GET") return;
      const previous = tail;
      tail = new Promise<void>((resolve) => releases.set(req, resolve));
      await previous;
    });
    const release = (req: object) => {
      releases.get(req)?.();
      releases.delete(req);
    };
    app.addHook("onResponse", async (req) => release(req));
    app.addHook("onError", async (req) => release(req));
    const directory = join(mediaRoot, "food-spirit-yard");
    const read = () => {
      const state = repo.read<YardState>(rootKey, structuredClone(empty));
      if (state.role.name === "草莓食灵") state.role.name = empty.role.name;
      if (state.role.line === "莓香一到，小院就热闹起来啦。")
        state.role.line = empty.role.line;
      return state;
    };
    const idParam = z.object({ id: z.uuid() });
    app.addHook("onReady", async () => {
      const state = read();
      // 服务重启不继承拍摄许可；超过一天的临时预览不继续保留。
      state.consent = null;
      const pending = repo.read<YardPhotoJob | null>(photoKey, null);
      if (pending?.status === "capturing") {
        pending.status = "cancelled";
        repo.write(photoKey, pending);
      }
      if (
        state.preview &&
        Date.now() - Date.parse(state.preview.createdAt) > 86_400_000
      )
        state.preview = null;
      repo.write(rootKey, state);
      const referenced = new Set([
        ...state.memories.map((m) => m.photoPath),
        ...(state.preview ? [state.preview.photoPath] : []),
      ]);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      for (const name of await readdir(directory)) {
        if (
          /^[a-f0-9-]{36}\.jpg(?:\.tmp)?$/.test(name) &&
          !referenced.has(join(directory, name))
        )
          await rm(join(directory, name), { force: true });
      }
    });
    const persistJpeg = async (id: string, bytes: Buffer) => {
      if (bytes.length > 3 * 1024 * 1024) throw new Error("照片不能超过 3 MB");
      validateImage(`data:image/jpeg;base64,${bytes.toString("base64")}`);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const path = join(directory, `${id}.jpg`);
      await writeFile(`${path}.tmp`, bytes, { mode: 0o600, flush: true });
      await rename(`${path}.tmp`, path);
      return path;
    };

    type OfflinePhoto = {
      id: string;
      deviceId: string;
      path: string;
      receivedAt: string;
      status: "pending" | "saved" | "discarded";
    };
    const offlineKey = "product:food-spirit-yard:offline-photos:v1";
    const offlinePhotos = () => repo.read<OfflinePhoto[]>(offlineKey, []);
    app.post("/api/yard/offline-photos/upload", async (req, reply) => {
      if (req.headers["x-yard-internal"] !== yardPhotoSecret(repo))
        return reply.code(403).send({ error: "仅设备内部上传" });
      const body = z
        .object({
          id: z.uuid(),
          deviceId: z.string().regex(/^[a-z0-9-]{1,64}$/),
          jpegBase64: z.string().max(470000),
        })
        .strict()
        .parse(req.body);
      const prior = offlinePhotos().find((v) => v.id === body.id);
      if (prior) {
        if (prior.deviceId !== body.deviceId)
          return reply.code(409).send({ error: "照片设备不匹配" });
        return { id: prior.id };
      }
      // 已通过实时预览的同ID，不重新变成待整理照片。
      const state = read();
      if (
        state.preview?.id === body.id ||
        state.memories.some((v) => v.id === body.id)
      )
        return { id: body.id };
      const bytes = Buffer.from(body.jpegBase64, "base64");
      validateImage(`data:image/jpeg;base64,${body.jpegBase64}`);
      const dir = join(mediaRoot, "offline");
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const path = join(dir, `${body.id}.jpg`);
      await writeFile(`${path}.tmp`, bytes, { mode: 0o600, flush: true });
      await rename(`${path}.tmp`, path);
      repo.write(offlineKey, [
        ...offlinePhotos(),
        {
          id: body.id,
          deviceId: body.deviceId,
          path,
          receivedAt: new Date().toISOString(),
          status: "pending",
        },
      ]);
      return { id: body.id };
    });
    app.get("/api/yard/offline-photos", async () => ({
      items: offlinePhotos()
        .filter((v) => v.status === "pending")
        .map((v) => ({
          id: v.id,
          deviceId: v.deviceId,
          receivedAt: v.receivedAt,
          status: v.status,
          url: `/api/yard/offline-photos/${v.id}/image`,
        })),
    }));
    app.get("/api/yard/offline-photos/:id/image", async (req, reply) => {
      const { id } = z.object({ id: z.uuid() }).parse(req.params);
      const photo = offlinePhotos().find(
        (v) => v.id === id && v.status === "pending",
      );
      if (!photo) return reply.code(404).send({ error: "照片不存在" });
      try {
        return reply.type("image/jpeg").send(await readFile(photo.path));
      } catch {
        return reply.code(404).send({ error: "照片文件不可用" });
      }
    });
    app.post("/api/yard/offline-photos/:id/resolve", async (req, reply) => {
      const { id } = z.object({ id: z.uuid() }).parse(req.params);
      const body = z
        .object({
          save: z.boolean(),
          title: z.string().trim().min(1).max(80).default("吃饭的小瞬间"),
        })
        .strict()
        .parse(req.body);
      const photos = offlinePhotos();
      const item = photos.find((v) => v.id === id);
      if (!item) return reply.code(404).send({ error: "照片不存在" });
      if (item.status !== "pending") return { id, status: item.status };
      const state = read();
      if (body.save) {
        await readFile(item.path);
        state.memories.push({
          id,
          title: body.title,
          createdAt: item.receivedAt,
          roleName: state.role.name,
          photoPath: item.path,
          source: "device",
        });
        item.status = "saved";
      } else item.status = "discarded";
      repo.sqlite.transaction(() => {
        repo.write(rootKey, state);
        repo.write(offlineKey, photos);
      })();
      if (!body.save) await rm(item.path, { force: true });
      return { id, status: item.status };
    });

    app.get("/api/yard", async () => {
      const state = read();
      return {
        ...state,
        preview: state.preview
          ? {
              id: state.preview.id,
              title: state.preview.title,
              createdAt: state.preview.createdAt,
              source: state.preview.source,
            }
          : null,
        memories: state.memories.map((memory) => ({
          id: memory.id,
          title: memory.title,
          createdAt: memory.createdAt,
          roleName: memory.roleName,
          source: memory.source,
          photoUrl: `/api/yard/memories/${memory.id}/photo`,
        })),
        photoJob: repo.read<YardPhotoJob | null>(photoKey, null),
        capabilities: {
          cameraReady: (() => {
            const c = repo.read<{ ready: boolean; at: number } | null>(
              cameraKey,
              null,
            );
            return Boolean(c?.ready && Date.now() - c.at < 45000);
          })(),
          cameraReason:
            "主动点击设备拍照即可采集；照片仅在确认保存后进入回忆。",
          voiceIdentity: "unverified",
        },
        tts: {
          ...state.tts,
          asrProvider:
            process.env.ASR_PROVIDER ?? process.env.SPEECH_PROVIDER ?? "未配置",
          localTtsConfigured: Boolean(process.env.LOCAL_TTS_URL),
          localTtsKeyConfigured: Boolean(process.env.LOCAL_TTS_API_KEY),
          cloudKeyConfigured: Boolean(process.env.AI_API_KEY),
        },
      };
    });

    app.patch("/api/yard/role", async (req) => {
      const body = z
        .object({
          name: z.string().trim().min(1).max(24),
          line: z.string().trim().min(1).max(120),
        })
        .strict()
        .parse(req.body);
      const state = read();
      state.role.name = body.name;
      state.role.line = body.line;
      repo.write(rootKey, state);
      return state.role;
    });
    app.patch("/api/yard/settings", async (req) => {
      const body = z
        .object({
          proactiveVoice: z.boolean(),
          listening: z.boolean(),
          silent: z.boolean(),
        })
        .strict()
        .parse(req.body);
      const state = read();
      state.settings = { ...state.settings, ...body };
      repo.write(rootKey, state);
      return state.settings;
    });
    app.patch("/api/yard/tts", async (req, reply) => {
      const body = z
        .object({
          provider: z.enum(["disabled", "bailian", "local-http"]),
          model: z.string().trim().min(1).max(120),
          voice: z.string().trim().min(1).max(80),
          speed: z.number().min(0.5).max(2),
        })
        .strict()
        .parse(req.body);
      if (body.provider === "bailian" && !process.env.AI_API_KEY)
        return reply
          .code(409)
          .send({ error: "百炼语音未配置服务端 API Key。" });
      if (body.provider === "local-http" && !process.env.LOCAL_TTS_URL)
        return reply
          .code(409)
          .send({ error: "本地主机语音未配置服务端 LOCAL_TTS_URL。" });
      const state = read();
      state.tts = body;
      state.settings.ttsProvider = body.provider;
      repo.write(rootKey, state);
      return state.tts;
    });
    app.post("/api/yard/tts/reset", async () => {
      const state = read();
      state.tts = structuredClone(defaultTts);
      state.settings.ttsProvider = state.tts.provider;
      repo.write(rootKey, state);
      return state.tts;
    });
    app.post("/api/yard/interactions", async (req) => {
      const body = z
        .object({
          requestId: z.uuid(),
          text: z.string().trim().min(1).max(1000),
          simulated: z.boolean().default(false),
        })
        .strict()
        .parse(req.body);
      const cached = repo.read(`yard:interaction:${body.requestId}`, null);
      if (cached) return cached;
      const chatReply = await prepareYardChat(repo, body.text);
      return applyYardInteraction(
        repo,
        body.requestId,
        body.text,
        body.simulated,
        chatReply,
      );
    });
    app.post(
      "/api/yard/photo/device/:operation",
      { bodyLimit: 4_200_000 },
      async (req, reply) => {
        if (req.headers["x-yard-internal"] !== yardPhotoSecret(repo))
          return reply.code(401).send({ error: "设备认证失败" });
        const { operation } = z
          .object({
            operation: z.enum(["begin", "upload", "failed", "status"]),
          })
          .parse(req.params);
        const body = z
          .object({
            id: z.uuid(),
            deviceId: z.string().min(1),
            jpegBase64: z.string().max(4_200_000).optional(),
            ready: z.boolean().optional(),
          })
          .strict()
          .parse(req.body);
        let job = repo.read<YardPhotoJob | null>(photoKey, null);
        if (operation === "status") {
          if (body.ready !== true)
            repo.write(cameraKey, { ready: false, at: Date.now() });
          return {
            job:
              job?.deviceId === body.deviceId &&
              job.status === "capturing" &&
              job.expiresAt > Date.now()
                ? job
                : null,
          };
        }
        if (operation === "begin") {
          if (
            repo.read(`yard:photo:issued:${body.id}`, false) &&
            job?.id !== body.id
          )
            return reply.code(410).send({ error: "旧拍摄ID已失效" });
          if (job?.id === body.id && job.deviceId === body.deviceId) {
            if (job.status !== "capturing" || job.expiresAt < Date.now())
              return reply.code(410).send({ error: "拍摄已结束" });
            return { status: job.status, id: job.id };
          }
          if (job?.status === "capturing" && job.expiresAt > Date.now())
            return reply.code(409).send({ error: "已有拍摄正在进行" });
          const state = read();
          if (state.preview)
            return reply.code(409).send({ error: "请先保存或放弃当前预览" });
          job = {
            id: body.id,
            deviceId: body.deviceId,
            status: "capturing",
            expiresAt: Date.now() + 90000,
          };
          repo.write(`yard:photo:issued:${job.id}`, true);
          repo.write(photoKey, job);
          return { id: job.id, status: job.status };
        }
        if (
          !job ||
          job.id !== body.id ||
          job.deviceId !== body.deviceId ||
          job.expiresAt < Date.now() ||
          job.status === "cancelled" ||
          job.status === "failed"
        )
          return reply.code(410).send({ error: "拍摄已取消或过期" });
        if (operation === "failed") {
          const state = read();
          if (state.preview?.id === body.id) {
            const path = state.preview.photoPath;
            state.preview = null;
            repo.write(rootKey, state);
            await rm(path, { force: true });
          }
          job.status = "failed";
          repo.write(photoKey, job);
          repo.write(cameraKey, { ready: false, at: Date.now() });
          return { status: "failed" };
        }
        const state = read();
        if (
          job.status === "preview" ||
          state.memories.some((m) => m.id === body.id)
        )
          return { id: body.id, status: "preview" };
        if (!body.jpegBase64)
          return reply.code(400).send({ error: "缺少本次照片" });
        const path = await persistJpeg(
          body.id,
          Buffer.from(body.jpegBase64, "base64"),
        );
        repo.write(cameraKey, { ready: true, at: Date.now() });
        state.preview = {
          id: body.id,
          title: "小院合影",
          createdAt: new Date().toISOString(),
          photoPath: path,
          source: "device",
        };
        repo.write(rootKey, state);
        job.status = "preview";
        repo.write(photoKey, job);
        return { id: body.id, status: "preview" };
      },
    );
    app.post("/api/yard/photo/invite", async (req) => {
      z.object({ requestId: z.uuid() }).strict().parse(req.body);
      const state = read();
      const token = crypto.randomUUID();
      state.consent = {
        token,
        expiresAt: Date.now() + 90_000,
        accepted: false,
      };
      repo.write(rootKey, state);
      return { token, expiresInSeconds: 90, status: "awaiting_confirmation" };
    });
    app.post("/api/yard/photo/consent", async (req, reply) => {
      const body = z
        .object({ token: z.uuid(), accepted: z.boolean() })
        .strict()
        .parse(req.body);
      const state = read();
      if (
        !state.consent ||
        state.consent.token !== body.token ||
        state.consent.expiresAt < Date.now()
      )
        return reply
          .code(410)
          .send({ error: "这次拍照邀请已失效，请重新发起。" });
      if (!body.accepted) {
        if (state.preview) await rm(state.preview.photoPath, { force: true });
        state.consent = null;
        state.preview = null;
        repo.write(rootKey, state);
        return { status: "cancelled" };
      }
      state.consent.accepted = true;
      repo.write(rootKey, state);
      return {
        status: "accepted",
        accepted: true,
        cameraReady: false,
        message: "已记录本次明确许可；当前相机缺件，尚未采集照片。",
      };
    });
    app.post(
      "/api/yard/photo/preview",
      { bodyLimit: 4_200_000 },
      async (req, reply) => {
        const body = z
          .object({
            token: z.uuid(),
            requestId: z.uuid(),
            title: z.string().trim().min(1).max(80),
            jpegBase64: z.string().max(4_200_000),
            simulated: z.literal(true),
          })
          .strict()
          .parse(req.body);
        let state = read();
        if (
          !state.consent?.accepted ||
          state.consent.token !== body.token ||
          state.consent.expiresAt < Date.now()
        )
          return reply.code(410).send({ error: "没有有效的本次拍照许可。" });
        if (state.memories.some((m) => m.id === body.requestId))
          return reply
            .code(409)
            .send({ error: "该照片已保存，请使用新拍摄 ID。" });
        if (state.preview?.id === body.requestId)
          return { id: body.requestId, status: "preview", source: "simulated" };
        const bytes = Buffer.from(body.jpegBase64, "base64");
        const path = await persistJpeg(body.requestId, bytes);
        const current = read();
        if (
          !current.consent?.accepted ||
          current.consent.token !== body.token
        ) {
          await rm(path, { force: true });
          return reply.code(410).send({ error: "拍照已取消。" });
        }
        state = current;
        if (state.preview) await rm(state.preview.photoPath, { force: true });
        state.preview = {
          id: body.requestId,
          title: body.title,
          createdAt: new Date().toISOString(),
          photoPath: path,
          source: "simulated",
        };
        state.consent = null;
        repo.write(rootKey, state);
        return {
          id: body.requestId,
          status: "preview",
          source: "simulated",
          image: `/api/yard/previews/${body.requestId}/photo`,
        };
      },
    );
    app.get("/api/yard/previews/:id/photo", async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const preview = read().preview;
      if (!preview || preview.id !== id)
        return reply.code(404).send({ error: "预览已不存在。" });
      return reply.type("image/jpeg").send(await readFile(preview.photoPath));
    });
    app.post("/api/yard/photo/cancel", async () => {
      const state = read();
      const job = repo.read<YardPhotoJob | null>(photoKey, null);
      if (job) {
        job.status = "cancelled";
        repo.write(photoKey, job);
      }
      const path = state.preview?.photoPath;
      state.preview = null;
      state.consent = null;
      repo.write(rootKey, state);
      if (path) await rm(path, { force: true });
      return { status: "cancelled" };
    });
    app.post("/api/yard/photo/retake", async (_req, reply) => {
      const state = read();
      const previous = repo.read<YardPhotoJob | null>(photoKey, null);
      if (!previous)
        return reply.code(409).send({ error: "请在设备上点击拍照" });
      const path = state.preview?.photoPath;
      state.preview = null;
      state.consent = null;
      repo.write(rootKey, state);
      if (path) await rm(path, { force: true });
      const job: YardPhotoJob = {
        id: crypto.randomUUID(),
        deviceId: previous.deviceId,
        status: "capturing",
        expiresAt: Date.now() + 90000,
      };
      repo.write(photoKey, job);
      return { id: job.id, status: job.status };
    });
    app.post("/api/yard/photo/save", async (req, reply) => {
      const body = z
        .object({
          requestId: z.uuid(),
          title: z.string().trim().min(1).max(80),
        })
        .strict()
        .parse(req.body);
      const state = read();
      const prior = state.memories.find((m) => m.id === body.requestId);
      if (prior)
        return {
          id: prior.id,
          title: prior.title,
          source: prior.source,
          photoUrl: `/api/yard/memories/${prior.id}/photo`,
        };
      if (!state.preview || state.preview.id !== body.requestId)
        return reply.code(409).send({ error: "没有待确认的照片预览。" });
      const source = state.preview.source;
      const path = state.preview.photoPath;
      const memory: YardMemory = {
        id: body.requestId,
        title: body.title,
        createdAt: state.preview.createdAt,
        roleName: state.role.name,
        photoPath: path,
        source,
      };
      if (state.memories.length >= 100)
        return reply
          .code(409)
          .send({ error: "回忆已达 100 张，请先删除不需要的回忆。" });
      await readFile(path);
      state.memories = [memory, ...state.memories];
      state.preview = null;
      state.consent = null;
      state.role.keepsakeCount++;
      repo.write(rootKey, state);
      return {
        id: memory.id,
        title: memory.title,
        createdAt: memory.createdAt,
        roleName: memory.roleName,
        source: memory.source,
        photoUrl: `/api/yard/memories/${memory.id}/photo`,
      };
    });
    app.get("/api/yard/memories/:id/photo", async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const memory = read().memories.find((m) => m.id === id);
      if (!memory) return reply.code(404).send({ error: "回忆不存在。" });
      return reply.type("image/jpeg").send(await readFile(memory.photoPath));
    });
    app.delete("/api/yard/memories/:id", async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const state = read();
      const memory = state.memories.find((m) => m.id === id);
      if (!memory) return reply.code(404).send({ error: "回忆不存在。" });
      state.memories = state.memories.filter((m) => m.id !== id);
      repo.write(rootKey, state);
      await rm(memory.photoPath, { force: true });
      return { deleted: true };
    });
  });
}

const photoSecrets = new WeakMap<SQLiteRepository, string>();
export function yardPhotoSecret(repo: SQLiteRepository) {
  let secret = photoSecrets.get(repo);
  if (!secret) {
    secret = crypto.randomUUID();
    photoSecrets.set(repo, secret);
  }
  return secret;
}
