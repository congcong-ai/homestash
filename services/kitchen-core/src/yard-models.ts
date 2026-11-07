import type { FastifyInstance } from "fastify";
import type { SQLiteRepository } from "@homestash/database";
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
const key = "product:food-spirit-yard:models:v1";
export function readModels(repo: SQLiteRepository) {
  return repo.read(key, {
    enabled: false,
    chatModel: "qwen-plus",
    asrModel: "qwen3-asr-flash",
    ttsModel: "qwen3-tts-flash",
  });
}
const files = new WeakMap<SQLiteRepository, string>();
export function bailianKey(repo: SQLiteRepository) {
  const file = files.get(repo);
  if (file) {
    try {
      return readFileSync(file, "utf8").trim();
    } catch {}
  }
  return process.env.AI_API_KEY ?? "";
}
export function registerModels(
  app: FastifyInstance,
  repo: SQLiteRepository,
  databasePath: string,
) {
  const file = join(dirname(databasePath), "private", "bailian-api-key");
  files.set(repo, file);
  app.get("/api/yard/models", async (_req, reply) =>
    reply
      .header("Cache-Control", "no-store")
      .send({
        ...readModels(repo),
        keyConfigured: !!bailianKey(repo),
        speakerRecognitionAvailable: false,
      }),
  );
  app.patch("/api/yard/models", async (req) => {
    const body = z
      .object({
        enabled: z.boolean(),
        chatModel: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/),
        asrModel: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/),
        ttsModel: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/),
        apiKey: z
          .string()
          .regex(/^[\x21-\x7e]{16,256}$/)
          .optional(),
      })
      .strict()
      .parse(req.body);
    const { apiKey, ...settings } = body;
    if (apiKey) {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      writeFileSync(`${file}.tmp`, apiKey, { mode: 0o600 });
      renameSync(`${file}.tmp`, file);
    }
    repo.write(key, settings);
    return { ...settings, keyConfigured: !!bailianKey(repo) };
  });
}
