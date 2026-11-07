import { z } from "zod";
import type { SQLiteRepository } from "@homestash/database";
import type { FastifyInstance } from "fastify";
import themes from "../../../packages/avatar/themes.json";
export const avatarKey = "product:food-spirit-yard:avatar:v1";
export const avatarSchema = z
  .object({
    theme: z
      .number()
      .int()
      .min(0)
      .max(themes.length - 1),
    mode: z.enum(["standard", "fullscreen"]),
  })
  .strict();
export function readAvatar(repo: SQLiteRepository) {
  return repo.read(avatarKey, {
    version: 1,
    revision: 0,
    theme: 0,
    mode: "standard",
  });
}
export function registerAvatar(app: FastifyInstance, repo: SQLiteRepository) {
  app.get("/api/yard/avatar", async () => ({
    config: readAvatar(repo),
    themes,
  }));
  app.patch("/api/yard/avatar", async (req) => {
    const next = avatarSchema.parse(req.body);
    const config = {
      ...next,
      version: 1,
      revision: readAvatar(repo).revision + 1,
    };
    repo.write(avatarKey, config);
    return config;
  });
}
