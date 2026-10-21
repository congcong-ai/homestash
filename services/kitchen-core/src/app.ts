import Fastify from "fastify";
import { registerBackups } from "./backups";
import { registerIntakeCenter } from "./intake-center";
import { registerDevices } from "./devices";
import { dirname, resolve } from "node:path";
import { registerFirmware } from "./firmware";
import { registerInternalAuth } from "./auth";
import { z } from "zod";
import { SQLiteRepository } from "@homestash/database";
import {
  InventoryService,
  ItemInput,
  DomainError,
  freshness,
  ShoppingInput,
  type ShoppingItem,
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
  RecipeDraft,
} from "@homestash/ai";
import {
  DeviceEvent,
  defaultDevice,
  type DeviceState,
  type DeviceCommand,
} from "@homestash/protocol";
import {
  recommend,
  cookingText,
  refreshRecipe,
  type Recipe,
} from "@homestash/recipes";
import { cookingService } from "./cooking";
import { recipeCatalog } from "./recipe-catalog";
import { deviceScreen, type DevicePage } from "./device-screen";
import { registerImageIntake } from "./image-intake";
import { inventoryAssistant } from "./inventory-assistant";
import { registerBarcodeIntake } from "./barcode-intake";
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
type VoiceResult = {
  intent: Intent;
  message: string;
  changed: InventoryItem[];
  recipes?: ReturnType<typeof recommend>;
  items?: InventoryItem[];
  shopping?: ShoppingItem[];
  candidates?: InventoryItem[];
};
type Settings = z.infer<typeof settingsSchema>;
export function createApp(path: string, override?: AIProvider) {
  const app = Fastify({
    logger: false,
    bodyLimit: 65536,
    trustProxy: ["127.0.0.1", "::1"],
  });
  registerInternalAuth(app);
  const repo = new SQLiteRepository(path);
  const devices = registerDevices(app, repo);
  const inventory = new InventoryService(repo);
  const assistant = inventoryAssistant(repo, inventory);
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
  const { current: cooking, act: cook } = cookingService(
    repo,
    inventory,
    updateScreen,
  );
  function updateScreen(text: string) {
    repo.write("device", { ...device(), screen: text });
  }
  function ai(): AIProvider {
    const config: ProviderConfig = settings().provider;
    return (
      override ??
      (config.mode === "mock"
        ? new MockAIProvider()
        : new OpenAICompatibleProvider(
            { ...config, visionModel: process.env.AI_VISION_MODEL },
            process.env.AI_API_KEY ?? "",
          ))
    );
  }
  const currentRecipes = () => {
    const generated = repo.read<Recipe[]>("recipe-catalog", []);
    return generated.length
      ? generated.map((r) => refreshRecipe(r, repo.list()))
      : recommend(repo.list());
  };
  async function generateRecipes(
    provider: AIProvider,
    people: number,
    requirements: string,
  ) {
    if (!provider.generateRecipes) return recommend(repo.list(), people);
    const food = repo
      .list()
      .filter(
        (i) =>
          i.category === "food" && i.quantity > 0 && freshness(i) !== "expired",
      );
    const drafts = await provider.generateRecipes(
      {
        people,
        requirements,
        inventory: food
          .slice(0, 200)
          .map(({ name, quantity, unit }) => ({ name, quantity, unit })),
      },
      settings().persona,
    );
    if (!drafts.length || drafts.length > 3)
      throw new DomainError("AI 食谱数量无效，请重新推荐");
    return drafts.map((raw) => {
      const draft = RecipeDraft.parse(raw);
      const ingredients: Recipe["ingredients"] = [];
      for (const entry of draft.ingredients) {
        const existing = ingredients.find(
          (i) => i.name === entry.name && i.unit === entry.unit,
        );
        if (existing) existing.quantity += entry.quantity;
        else ingredients.push({ ...entry });
      }
      return refreshRecipe(
        {
          ...draft,
          ingredients,
          id: `ai-${crypto.randomUUID()}`,
          origin: "ai",
          people,
          used: [],
          missing: [],
        },
        repo.list(),
      );
    });
  }
  async function answerQuestion(provider: AIProvider, question: string) {
    const session = cooking();
    if (!session || !provider.answerCooking) return undefined;
    return provider.answerCooking(
      {
        recipe: {
          name: session.recipe.name,
          minutes: session.recipe.minutes,
          ingredients: session.recipe.ingredients,
          steps: session.recipe.steps,
          people: session.recipe.people,
        },
        step: session.step,
        question,
      },
      settings().persona,
    );
  }
  function apply(
    intent: Intent,
    expectedCooking?: { id: string | null; step?: number; revision?: number },
    preparedRecipes?: Recipe[],
    preparedAnswer?: string,
  ): VoiceResult {
    if (preparedRecipes)
      repo.write(
        "recipe-catalog",
        preparedRecipes.filter((r) => r.origin === "ai"),
      );
    let message = "";
    let changed: InventoryItem[] = [];
    switch (intent.intent) {
      case "inventory_query": {
        const result = assistant.query(intent);
        const message = respond(result.message, settings().persona);
        updateScreen(message);
        return { intent, ...result, message, changed };
      }
      case "inventory_action": {
        const result = assistant.act(intent);
        const message = respond(result.message, settings().persona);
        updateScreen(message);
        return { intent, ...result, message };
      }
      case "shopping": {
        const result = assistant.shop(intent);
        const message = respond(result.message, settings().persona);
        updateScreen(message);
        return { intent, ...result, message, changed };
      }
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
        const recipes =
          preparedRecipes ?? recommend(repo.list(), intent.people);
        repo.write("recipe-people", intent.people);
        message = `${intent.people}人份建议：${recipes.map((r) => r.name).join("、")}。请核对缺少的食材。`;
        message = respond(message, settings().persona);
        updateScreen(message);
        return { intent, message, recipes, changed };
      }
      case "cooking": {
        const session = cook(
          intent.action,
          intent.recipeName ?? intent.question,
          intent.question,
          intent.people ?? repo.read("recipe-people", 2),
          expectedCooking,
          preparedAnswer,
        );
        message = cookingText(session);
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
  async function voice(text: string): Promise<() => ReturnType<typeof apply>> {
    const s = settings();
    const config: ProviderConfig = s.provider;
    const provider = ai();
    if (config.mode === "openai-compatible" && !config.model)
      throw new DomainError("请先配置模型名称");
    const session = cooking();
    const people = repo.read("recipe-people", 2);
    const intent = Intent.parse(
      await provider.structuredOutput(text, s.persona, {
        recipeNames: recipeCatalog(repo, people).map((r) => r.name),
        people,
        cooking: session
          ? {
              recipeName: session.recipe.name,
              step: session.step + 1,
              status: session.status ?? "active",
            }
          : null,
      }),
    );
    if (
      intent.intent === "cooking" &&
      intent.action === "confirm_consumption" &&
      !/^(?:请)?(?:确认扣减|确认消耗|确认扣库存)[。！!？?\s]*$/.test(
        text.trim(),
      )
    )
      return () => {
        const message =
          "库存未扣减。核对数量后，请明确说“确认扣减”，或说“不扣减”";
        updateScreen(message);
        return {
          intent: { intent: "unknown" as const, message },
          message,
          changed: [],
        };
      };
    let preparedRecipes: Recipe[] | undefined;
    let preparedAnswer: string | undefined;
    if (intent.intent === "recommend_recipe")
      preparedRecipes = await generateRecipes(
        provider,
        intent.people,
        intent.requirements ?? text,
      );
    if (
      intent.intent === "cooking" &&
      intent.action === "start" &&
      !recipeCatalog(repo, intent.people ?? people).some(
        (r) =>
          r.name === (intent.recipeName ?? intent.question) ||
          r.id === (intent.recipeName ?? intent.question),
      ) &&
      provider.generateRecipes
    )
      preparedRecipes = await generateRecipes(
        provider,
        intent.people ?? people,
        `请推荐用户指定的菜：${intent.recipeName ?? intent.question}`,
      );
    if (intent.intent === "cooking" && intent.action === "ask")
      preparedAnswer = await answerQuestion(provider, intent.question ?? text);
    return () => {
      try {
        return repo.transaction(() =>
          apply(
            intent,
            intent.intent === "cooking"
              ? {
                  id: session?.id ?? null,
                  step: session?.step,
                  revision: session?.revision ?? 0,
                }
              : undefined,
            preparedRecipes,
            preparedAnswer,
          ),
        );
      } catch (error) {
        // 无效烹饪指令也生成可播报回执，避免设备永远重试同一段录音。
        if (
          !(error instanceof DomainError) ||
          !["cooking", "inventory_action", "shopping"].includes(intent.intent)
        )
          throw error;
        updateScreen(error.message);
        return { intent, message: error.message, changed: [] };
      }
    };
  }
  // 同一进程串行提交异步意图，重放结果落 SQLite；网络重试不能重复增加库存。
  let tail: Promise<unknown> = Promise.resolve();
  let dataGeneration = 0;
  function once<T>(
    key: string,
    body: unknown,
    work: () => Promise<() => T> | (() => T),
  ): Promise<T> {
    const admittedGeneration = dataGeneration;
    const execute = async () => {
      if (admittedGeneration !== dataGeneration)
        throw new DomainError("家庭数据刚刚恢复，请重新核对后操作");
      if (
        repo
          .read<string[]>("backup-blocked-requests", [])
          .includes(`request:${key}`)
      )
        throw new DomainError(
          "此请求属于恢复前已处理的数据，请重新核对后发起新操作",
        );
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
      if (admittedGeneration !== dataGeneration)
        throw new DomainError("家庭数据刚刚恢复，请重新核对后操作");
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
    if ((err as { statusCode?: number }).statusCode === 413)
      return reply.code(413).send({ error: "请求内容过大，请选择更小的文件" });
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
      ![
        "http://127.0.0.1:3000",
        "http://localhost:3000",
        process.env.APP_ORIGIN,
      ].includes(origin)
    )
      return reply.code(403).send({ error: "仅允许已配置的网页来源访问" });
  });
  app.addHook("preHandler", async (req, reply) => {
    const epoch = req.headers["x-homestash-data-epoch"];
    if (
      req.method === "POST" &&
      !req.url.startsWith("/api/backups/") &&
      epoch &&
      epoch !== repo.read("backup-data-epoch", "initial")
    )
      return reply
        .code(409)
        .send({ error: "家庭数据已恢复，请刷新页面并重新核对后操作" });
  });
  app.get("/api/health", async () => ({
    ok: true,
    name: "HomeStash",
    phase: 1,
    ...(process.env.HOMESTASH_INSTANCE_ID
      ? { instanceId: process.env.HOMESTASH_INSTANCE_ID }
      : {}),
  }));
  app.get("/api/state", async () => ({
    dataEpoch: repo.read("backup-data-epoch", "initial"),
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
    recipes: currentRecipes(),
    shopping: assistant.shopping.list(),
    cooking: cooking(),
    device: device(),
    physicalDevice: repo.read("physical-device", null),
    physicalDevices: devices.list(),
    settings: { ...settings(), keyConfigured: !!process.env.AI_API_KEY },
    household: { id: "local", name: "我的家" },
  }));
  app.post("/api/items", async (req) => inventory.create(req.body));
  app.get("/api/items/:id/events", async (req) => {
    const id = z.object({ id: z.uuid() }).parse(req.params).id;
    if (!repo.get(id)) throw new DomainError("物品不存在");
    return repo
      .events()
      .filter((e) => e.itemId === id)
      .sort((a, b) => b.after.version - a.after.version);
  });
  app.post("/api/items/:id/corrections", async (req) => {
    const id = z.object({ id: z.uuid() }).parse(req.params).id;
    const body = z
      .object({
        requestId: z.uuid(),
        eventId: z.uuid(),
        expectedVersion: z.number().int().positive(),
        reason: z.string().trim().min(1).max(300),
      })
      .strict()
      .parse(req.body);
    const { requestId, ...input } = body;
    return once(
      `correction:${requestId}`,
      { id, ...input },
      async () => () => inventory.correct(id, input),
    );
  });
  app.post("/api/items/:id/actions", async (req) => {
    const id = z.object({ id: z.uuid() }).parse(req.params).id;
    const { requestId, expectedVersion, ...action } = z
      .object({
        requestId: z.uuid().optional(),
        expectedVersion: z.number().int().positive().optional(),
      })
      .passthrough()
      .parse(req.body);
    const work = () => inventory.act(id, action, expectedVersion);
    return requestId
      ? once(
          `item-action:${requestId}`,
          { id, expectedVersion, action },
          async () => work,
        )
      : work();
  });
  app.post("/api/voice", async (req) => {
    const b = z
      .object({ requestId: z.uuid(), text: z.string().trim().min(1).max(2000) })
      .parse(req.body);
    return once(b.requestId, b, () => voice(b.text));
  });
  app.get("/api/shopping", async () => assistant.shopping.list());
  app.post("/api/shopping/:id/receive", async (req) => {
    const id = z.object({ id: z.uuid() }).parse(req.params).id;
    const body = z
      .object({
        requestId: z.uuid(),
        item: ItemInput.extend({
          quantity: z.number().finite().positive().max(1000000),
          unit: z.string().trim().min(1).max(20),
        }),
      })
      .strict()
      .parse(req.body);
    return once(
      `shopping-receive:${body.requestId}`,
      { id, item: body.item },
      async () => () => assistant.shopping.receive(id, body.item, inventory),
    );
  });
  app.post("/api/shopping", async (req) => {
    const b = z
      .discriminatedUnion("action", [
        z.object({
          action: z.literal("add"),
          item: ShoppingInput,
          requestId: z.uuid(),
        }),
        z.object({
          action: z.enum(["check", "uncheck", "remove"]),
          id: z.uuid(),
          requestId: z.uuid(),
        }),
        z.object({
          action: z.literal("from_recipe"),
          recipeId: z.string().min(1),
          people: z.number().int().min(1).max(20),
          requestId: z.uuid(),
        }),
      ])
      .parse(req.body);
    return once(`shopping:${b.requestId}`, b, async () => () => {
      if (b.action === "add") assistant.shopping.add(b.item);
      else if (b.action === "from_recipe")
        assistant.shortage(b.recipeId, b.people, true);
      else assistant.shopping.act(b.id, b.action);
      return assistant.shopping.list();
    });
  });
  app.post("/api/recipes", async (req) => {
    const b = z
      .object({
        people: z.number().int().min(1).max(20),
        requirements: z.string().max(500).default(""),
        requestId: z.uuid().optional(),
      })
      .parse(req.body);
    return once(
      `recipes:${b.requestId ?? crypto.randomUUID()}`,
      b,
      async () => {
        const recipes = await generateRecipes(ai(), b.people, b.requirements);
        return () => {
          repo.write(
            "recipe-catalog",
            recipes.filter((r) => r.origin === "ai"),
          );
          repo.write("recipe-people", b.people);
          return recipes;
        };
      },
    );
  });
  app.post("/api/cooking", async (req) => {
    const b = z
      .object({
        action: z.enum([
          "start",
          "next",
          "previous",
          "ask",
          "repeat",
          "finish",
          "confirm_consumption",
          "skip_consumption",
        ]),
        sessionId: z.uuid().optional(),
        revision: z.number().int().nonnegative().optional(),
        requestId: z.uuid().optional(),
        recipeId: z.string().optional(),
        question: z.string().max(1000).default(""),
        people: z.number().int().min(1).max(20).default(2),
      })
      .parse(req.body);
    if (
      ["confirm_consumption", "skip_consumption"].includes(b.action) &&
      (!b.sessionId || b.revision === undefined)
    )
      throw new DomainError("请携带当前做饭任务 ID 和版本进行确认");
    const work = async () => {
      const preparedAnswer =
        b.action === "ask" ? await answerQuestion(ai(), b.question) : undefined;
      return () =>
        cook(
          b.action,
          b.recipeId,
          b.question,
          b.people,
          b.sessionId ? { id: b.sessionId, revision: b.revision } : undefined,
          preparedAnswer,
        );
    };
    return once(`cooking:${b.requestId ?? crypto.randomUUID()}`, b, work);
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
  const firmware = registerFirmware(
    app,
    repo,
    resolve(dirname(path), "firmware"),
  );
  const imageIntake = registerImageIntake(app, repo, inventory, once, ai);
  registerBarcodeIntake(app, repo, inventory, once);
  registerIntakeCenter(app, repo);
  registerBackups(app, repo, path, once, () => {
    dataGeneration++;
  });
  app.addHook("onClose", async () => repo.close());
  return {
    app,
    repo,
    inventory,
    prepareVoice: voice,
    once,
    imageIntake,
    devices,
    firmware,
    deviceScreen: (page: DevicePage) =>
      deviceScreen(repo, currentRecipes(), page),
  };
}
