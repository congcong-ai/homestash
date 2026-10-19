import Fastify from "fastify";
import { z } from "zod";
import { SQLiteRepository } from "@homestash/database";
import {
  InventoryService,
  DomainError,
  freshness,
  type InventoryItem,
} from "@homestash/domain";
import {
  Intent,
  MockAIProvider,
  OpenAICompatibleProvider,
  Persona,
  respond,
  type AIProvider,
  type ProviderConfig,
} from "@homestash/ai";
import {
  DeviceEvent,
  defaultDevice,
  type DeviceState,
  type DeviceCommand,
} from "@homestash/protocol";
import {
  recommend,
  cookingAnswer,
  type CookingSession,
} from "@homestash/recipes";
const settingsSchema = z.object({
  persona: Persona,
  provider: z.object({
    mode: z.enum(["mock", "openai-compatible"]),
    baseUrl: z
      .url()
      .refine(
        (v) => ["http:", "https:"].includes(new URL(v).protocol),
        "仅支持 HTTP/HTTPS",
      ),
    model: z.string().max(100),
  }),
});
type Settings = z.infer<typeof settingsSchema>;
export function createApp(path: string, override?: AIProvider) {
  const app = Fastify({ logger: false, bodyLimit: 65536 });
  const repo = new SQLiteRepository(path);
  const inventory = new InventoryService(repo);
  const defaults: Settings = {
    persona: "default",
    provider: {
      mode:
        process.env.AI_PROVIDER === "openai-compatible"
          ? "openai-compatible"
          : "mock",
      baseUrl: process.env.AI_BASE_URL ?? "http://127.0.0.1:11434/v1",
      model: process.env.AI_MODEL ?? "",
    },
  };
  const settings = () => repo.read("settings", defaults);
  const device = () => {
    const d = repo.read<DeviceState>("device", defaultDevice);
    return {
      ...d,
      online:
        d.online && !!d.lastSeen && Date.now() - Date.parse(d.lastSeen) < 45000,
    };
  };
  const cooking = () => repo.read<CookingSession | null>("cooking", null);
  function cook(
    action: "start" | "next" | "previous" | "ask",
    recipeId?: string,
    question = "",
    people = 2,
  ) {
    let session = cooking();
    if (action === "start") {
      const recipe = recommend(repo.list(), people).find(
        (r) => r.id === recipeId || r.name === recipeId,
      );
      if (!recipe) throw new DomainError("请选择当前推荐的食谱");
      session = { id: crypto.randomUUID(), recipe, step: 0, answer: "" };
    } else {
      if (!session) throw new DomainError("请先选择食谱并开始做饭");
      session = { ...session };
      if (action === "next")
        session.step = Math.min(
          session.recipe.steps.length - 1,
          session.step + 1,
        );
      if (action === "previous") session.step = Math.max(0, session.step - 1);
      session.answer = action === "ask" ? cookingAnswer(session, question) : "";
    }
    repo.write("cooking", session);
    updateScreen(
      `${session.recipe.name} · 第${session.step + 1}步\n${session.recipe.steps[session.step]}`,
    );
    return session;
  }
  function updateScreen(text: string) {
    repo.write("device", { ...device(), screen: text });
  }
  function apply(intent: Intent) {
    let message = "";
    let changed: InventoryItem[] = [];
    switch (intent.intent) {
      case "add_items":
        changed = intent.items.map((i) =>
          inventory.create({ ...i, source: "voice" }),
        );
        message = `已添加${changed.map((i) => `${i.quantity}${i.unit}${i.name}`).join("、")}。建议日期可以在库存里修改。`;
        break;
      case "consume_item": {
        const matches = repo
          .list()
          .filter(
            (i) =>
              i.name === intent.name.replace("西红柿", "番茄") &&
              i.quantity > 0,
          );
        if (matches.length !== 1)
          throw new DomainError(
            matches.length
              ? "有多个同名批次，请在库存中选择要消耗的那一批"
              : "没有找到这件物品",
          );
        changed = [
          inventory.act(matches[0].id, {
            type: "consume",
            quantity: intent.quantity,
          }),
        ];
        message = `已更新${matches[0].name}库存。`;
        break;
      }
      case "recommend_recipe": {
        const recipes = recommend(repo.list(), intent.people);
        message = `${intent.people}人份建议：${recipes.map((r) => r.name).join("、")}。请核对缺少的食材。`;
        message = respond(message, settings().persona);
        updateScreen(message);
        return { intent, message, recipes, changed };
      }
      case "cooking": {
        const session = cook(intent.action, intent.question, intent.question);
        message = session.answer || session.recipe.steps[session.step];
        break;
      }
      case "unknown":
        message = intent.message;
        break;
    }
    message = respond(message, settings().persona);
    updateScreen(message);
    return { intent, message, changed };
  }
  async function voice(text: string) {
    const s = settings();
    const config: ProviderConfig = s.provider;
    const provider =
      override ??
      (config.mode === "mock"
        ? new MockAIProvider()
        : new OpenAICompatibleProvider(config, process.env.AI_API_KEY ?? ""));
    if (config.mode === "openai-compatible" && !config.model)
      throw new DomainError("请先配置模型名称");
    const intent = Intent.parse(
      await provider.structuredOutput(text, s.persona),
    );
    return () => apply(intent);
  }
  // 同一进程串行提交异步意图，重放结果落 SQLite；网络重试不能重复增加库存。
  let tail: Promise<unknown> = Promise.resolve();
  function once<T>(
    key: string,
    body: unknown,
    work: () => Promise<() => T> | (() => T),
  ): Promise<T> {
    const execute = async () => {
      const signature = JSON.stringify(body);
      const cached = repo.read<{ signature: string; result: T } | null>(
        `request:${key}`,
        null,
      );
      if (cached) {
        if (cached.signature !== signature)
          throw new DomainError("相同请求 ID 不能用于不同内容");
        return cached.result;
      }
      const commit = await work();
      return repo.transaction(() => {
        const result = commit();
        repo.write(`request:${key}`, { signature, result });
        return result;
      });
    };
    const result = tail.then(execute);
    tail = result.catch(() => {});
    return result;
  }
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof z.ZodError)
      return reply.code(400).send({
        error: "输入格式不正确，请检查字段",
        details: err.issues.map((i) => ({
          path: i.path,
          message: i.message,
        })),
      });
    if ((err as { statusCode?: number }).statusCode === 400)
      return reply.code(400).send({ error: "请求不是有效的 JSON" });
    if (err instanceof DomainError)
      return reply.code(409).send({ error: err.message });
    return reply
      .code(502)
      .send({ error: "操作未完成，请检查 Core 或 AI 服务配置后重试" });
  });
  app.addHook("onRequest", async (req, reply) => {
    const origin = req.headers.origin;
    if (
      origin &&
      !["http://127.0.0.1:3000", "http://localhost:3000"].includes(origin)
    )
      return reply.code(403).send({ error: "仅允许本机界面访问" });
  });
  app.get("/api/health", async () => ({
    ok: true,
    name: "HomeStash",
    phase: 1,
  }));
  app.get("/api/state", async () => ({
    items: repo.list(),
    locations: repo.locations(),
    events: repo.events().slice(-50).reverse(),
    todayFirst: repo
      .list()
      .filter((i) => i.category === "food" && i.quantity > 0)
      .map((i) => ({ ...i, freshness: freshness(i) }))
      .filter((i) => i.freshness !== "fresh")
      .sort(
        (a, b) =>
          ["expired", "urgent", "eat_soon"].indexOf(a.freshness) -
          ["expired", "urgent", "eat_soon"].indexOf(b.freshness),
      ),
    recipes: recommend(repo.list()),
    cooking: cooking(),
    device: device(),
    physicalDevice: repo.read("physical-device", null),
    settings: { ...settings(), keyConfigured: !!process.env.AI_API_KEY },
    household: { id: "local", name: "我的家" },
  }));
  app.post("/api/items", async (req) => inventory.create(req.body));
  app.post("/api/items/:id/actions", async (req) =>
    inventory.act(z.object({ id: z.uuid() }).parse(req.params).id, req.body),
  );
  app.post("/api/voice", async (req) => {
    const b = z
      .object({ requestId: z.uuid(), text: z.string().trim().min(1).max(2000) })
      .parse(req.body);
    return once(b.requestId, b, () => voice(b.text));
  });
  app.post("/api/recipes", async (req) => {
    const b = z
      .object({ people: z.number().int().min(1).max(20) })
      .parse(req.body);
    return recommend(repo.list(), b.people);
  });
  app.post("/api/cooking", async (req) => {
    const b = z
      .object({
        action: z.enum(["start", "next", "previous", "ask"]),
        recipeId: z.string().optional(),
        question: z.string().max(1000).default(""),
        people: z.number().int().min(1).max(20).default(2),
      })
      .parse(req.body);
    return repo.transaction(() =>
      cook(b.action, b.recipeId, b.question, b.people),
    );
  });
  app.post("/api/settings", async (req) => {
    const s = settingsSchema.parse(req.body);
    if (s.provider.mode === "openai-compatible" && !s.provider.model)
      throw new DomainError("请输入模型名称");
    repo.write("settings", s);
    return { ...s, keyConfigured: !!process.env.AI_API_KEY };
  });
  app.post("/api/device/events", async (req) => {
    const e = DeviceEvent.parse(req.body);
    return once(e.eventId, e, async () => {
      const p = e.payload;
      const initial = device();
      if (p.type !== "HEARTBEAT" && (!initial.online || !initial.wifi))
        throw new DomainError("模拟设备已离线，请先上线");
      if (
        initial.mode === "deep_sleep" &&
        p.type !== "POWER_CHANGED" &&
        p.type !== "HEARTBEAT"
      )
        throw new DomainError("请先唤醒设备");
      const applyVoice =
        p.type === "VOICE_CAPTURED" ? await voice(p.text) : null;
      return () => {
        let d = device();
        let message = "";
        if (p.type === "HEARTBEAT")
          d = {
            ...d,
            battery: p.battery,
            wifi: p.wifi,
            online: p.online && p.wifi,
            lastSeen: new Date().toISOString(),
          };
        else {
          if (!d.online || !d.wifi)
            throw new DomainError("模拟设备已离线，请先连接 Wi-Fi 并上线");
          if (d.mode === "deep_sleep" && p.type !== "POWER_CHANGED")
            throw new DomainError("请先唤醒设备");
          if (p.type === "VOICE_CAPTURED") {
            const result = applyVoice!();
            d = { ...device(), recording: false };
            message = result.message;
          }
          if (p.type === "CAMERA_CAPTURED") {
            d.cameraCount++;
            message = "已收到模拟 Camera 事件，尚未进行图像识别，库存未改变。";
            d.screen = message;
          }
          if (p.type === "POWER_CHANGED") {
            d.mode = p.mode;
            d.recording = false;
          }
          if (p.type === "BUTTON_PRESSED") {
            if (p.button === "SET") {
              d.recording = !d.recording;
              d.screen = d.recording
                ? "正在模拟录音，请输入语音文字"
                : "录音已停止，等待文字提交";
            } else {
              const s = cook(p.button === "NEXT" ? "next" : "previous");
              d = device();
              message = s.recipe.steps[s.step];
            }
          }
        }
        repo.write("device", d);
        const commands: DeviceCommand[] = [
          {
            version: 1,
            commandId: crypto.randomUUID(),
            type: "DISPLAY_RENDER",
            text: d.screen,
          },
        ];
        if (p.type === "BUTTON_PRESSED" && p.button === "SET")
          commands.push({
            version: 1,
            commandId: crypto.randomUUID(),
            type: d.recording ? "START_RECORDING" : "STOP_RECORDING",
          });
        return { device: d, message, commands };
      };
    });
  });
  app.addHook("onClose", async () => repo.close());
  return { app, repo, inventory, prepareVoice: voice, once };
}
