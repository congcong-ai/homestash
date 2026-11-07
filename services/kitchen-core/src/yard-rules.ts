import { z } from "zod";
import type { SQLiteRepository } from "@homestash/database";
import type { FastifyInstance } from "fastify";
const rule = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,40}$/),
    enabled: z.boolean(),
    trigger: z.enum(["wake", "keyword"]),
    keyword: z.string().trim().max(30),
    line: z.string().trim().min(1).max(80),
    mood: z.enum(["happy", "curious", "rest"]),
    keepsake: z.enum(["none", "first-story"]),
  })
  .strict()
  .refine(
    (r) => r.trigger !== "keyword" || r.keyword.length > 0,
    "关键词不能为空",
  );
const input = z
  .object({
    version: z.number().int().positive(),
    rules: z.array(rule).min(1).max(12),
  })
  .strict();
const key = "product:food-spirit-yard:rules:v1";
const defaults = {
  version: 1,
  rules: [
    {
      id: "welcome",
      enabled: true,
      trigger: "wake" as const,
      keyword: "",
      line: "你回来啦！小冰在呢，今天有什么开心事呀？",
      mood: "happy" as const,
      keepsake: "none" as const,
    },
    {
      id: "story",
      enabled: true,
      trigger: "keyword" as const,
      keyword: "小院故事",
      line: "今天的故事，由我们一起写。",
      mood: "curious" as const,
      keepsake: "first-story" as const,
    },
  ],
};
export function readYardRules(repo: SQLiteRepository) {
  return repo.read(key, structuredClone(defaults));
}
export function matchYardRule(repo: SQLiteRepository, text: string) {
  return readYardRules(repo).rules.find(
    (r) => r.enabled && r.trigger === "keyword" && text.includes(r.keyword),
  );
}
export function registerYardRules(
  app: FastifyInstance,
  repo: SQLiteRepository,
) {
  app.get("/api/yard/story-state", async () =>
    repo.read("product:food-spirit-yard:story-state:v1", {
      mood: "rest",
      keepsakes: [],
    }),
  );
  app.get("/api/yard/rules", async () => readYardRules(repo));
  app.put("/api/yard/rules", async (req, reply) => {
    const body = input.parse(req.body);
    if (new Set(body.rules.map((r) => r.id)).size !== body.rules.length)
      return reply.code(400).send({ error: "规则编号不能重复" });
    const current = readYardRules(repo);
    if (body.version !== current.version)
      return reply.code(409).send({ error: "规则已更新，请刷新后重试" });
    const next = { ...body, version: current.version + 1 };
    repo.write(key, next);
    return next;
  });
}

export function applyYardRuleEffect(
  repo: SQLiteRepository,
  rule: ReturnType<typeof matchYardRule>,
) {
  if (!rule) return;
  const effectKey = "product:food-spirit-yard:story-state:v1";
  const state = repo.read<{ mood: string; keepsakes: string[] }>(effectKey, {
    mood: "rest",
    keepsakes: [],
  });
  state.mood = rule.mood;
  if (rule.keepsake !== "none" && !state.keepsakes.includes(rule.keepsake))
    state.keepsakes.push(rule.keepsake);
  repo.write(effectKey, state);
}
