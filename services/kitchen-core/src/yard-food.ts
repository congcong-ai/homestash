import type { SQLiteRepository } from "@homestash/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
const key = "product:food-spirit-yard:food:v1";
const windows = z
  .array(
    z
      .object({
        name: z.enum(["早餐", "午餐", "晚餐"]),
        start: z.number().int().min(0).max(1439),
        end: z.number().int().min(1).max(1440),
      })
      .strict()
      .refine((v) => v.end > v.start),
  )
  .length(3)
  .refine((v) => new Set(v.map((w) => w.name)).size === 3);
const schema = z.object({ enabled: z.boolean(), windows }).strict();
type Settings = z.infer<typeof schema>;
type Entry = {
  id: string;
  date: string;
  meal: string;
  text: string;
  createdAt: string;
  speakerId: null;
};
type State = {
  version: 1;
  settings: Settings;
  asked: string[];
  entries: Entry[];
};
export function readFood(repo: SQLiteRepository) {
  return repo.read<State>(key, {
    version: 1,
    settings: {
      enabled: true,
      windows: [
        { name: "早餐", start: 420, end: 570 },
        { name: "午餐", start: 660, end: 810 },
        { name: "晚餐", start: 1020, end: 1200 },
      ],
    },
    asked: [],
    entries: [],
  });
}
export function mealNow(repo: SQLiteRepository, now = new Date()) {
  // Core 时间未校准时不推断饭点；设备离线不依赖未经确认的本地时钟。
  if (
    !Number.isFinite(now.getTime()) ||
    now.getUTCFullYear() < 2025 ||
    now.getUTCFullYear() > 2100
  )
    return null;
  const date = new Date(now.getTime() + 8 * 3600000).toISOString();
  const minute = Number(date.slice(11, 13)) * 60 + Number(date.slice(14, 16));
  const state = readFood(repo);
  if (!state.settings.enabled) return null;
  const window = state.settings.windows.find(
    (v) => minute >= v.start && minute < v.end,
  );
  return window ? { date: date.slice(0, 10), meal: window.name } : null;
}
export function foodInteraction(
  repo: SQLiteRepository,
  id: string,
  text: string,
  now = new Date(),
) {
  const previous = repo.read<{ reply?: string } | null>(
    `${key}:turn:${id}`,
    null,
  );
  if (previous) return previous.reply;
  const slot = mealNow(repo, now);
  if (!slot) return;
  const state = readFood(repo);
  const mark = `${slot.date}:${slot.meal}`;
  // 只记录用户明确说出的原话，不把提问、否定或建议当成已吃事实。
  const statement =
    /(?:早饭|早餐|中饭|午饭|午餐|晚饭|晚餐|今天|中午|晚上|早上).{0,10}(?:吃了|吃的是|吃的|准备吃|打算吃|做了|做的是|煮了|吃[^什么])/.test(
      text,
    ) && !/[？?]|吃什么|没吃|没做|还没/.test(text);
  let reply: string | undefined;
  if (statement) {
    state.asked = [...new Set([...state.asked, mark])].slice(-120);
    state.entries.push({
      id,
      ...slot,
      text: text.slice(0, 1000),
      createdAt: now.toISOString(),
      speakerId: null,
    });
    state.entries = state.entries.slice(-1000);
    reply = "这顿吃饭的小记记下来啦。要不要一起聊聊怎么做？";
  } else if (
    !state.asked.includes(mark) &&
    !/拍照|取消|停止|再见|拜拜|改名/.test(text)
  ) {
    state.asked.push(mark);
    state.asked = state.asked.slice(-120);
    reply = `今天${slot.meal}吃什么呀？`;
  }
  repo.sqlite.transaction(() => {
    repo.write(key, state);
    repo.write(`${key}:turn:${id}`, { reply });
  })();
  return reply;
}
export function registerFood(app: FastifyInstance, repo: SQLiteRepository) {
  app.get("/api/yard/food", async () => ({
    ...readFood(repo),
    timezone: "Asia/Shanghai",
    speakerRecognition: "unavailable",
  }));
  app.patch("/api/yard/food/settings", async (req) => {
    const settings = schema.parse(req.body);
    const state = readFood(repo);
    state.settings = settings;
    repo.write(key, state);
    return settings;
  });
}
