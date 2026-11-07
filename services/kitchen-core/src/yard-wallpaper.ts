import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { SQLiteRepository } from "@homestash/database";
import { DomainError } from "@homestash/domain";
import sharp from "sharp";
import { z } from "zod";
import { validateImage } from "./image-intake";

const key = "yard:standby-wallpaper:v1";
type Wallpaper = { id: string; jpeg: string };
export function readWallpaper(repo: SQLiteRepository) {
  const wallpaper = repo.read<Wallpaper | { id: null }>(key, { id: null });
  return wallpaper.id === null ? null : wallpaper;
}

export async function saveWallpaper(repo: SQLiteRepository, bytes: Buffer) {
  const previous = readWallpaper(repo)?.id;
  let jpeg: Buffer | undefined;
  try {
    const image = sharp(bytes, { limitInputPixels: 24_000_000 })
      .autoOrient()
      .resize(480, 320, { fit: "cover" })
      .flatten({ background: "#fff6e9" });
    for (const quality of [78, 60, 42, 25, 12]) {
      const candidate = await image.clone().jpeg({ quality }).toBuffer();
      if (candidate.length <= 24 * 1024) {
        jpeg = candidate;
        break;
      }
    }
  } catch {
    throw new DomainError("无法读取这张图片，请换一张试试");
  }
  if (!jpeg) throw new DomainError("这张图片无法缩小到设备可用的大小");
  if (readWallpaper(repo)?.id !== previous)
    throw new DomainError("壁纸刚刚发生变化，请重新提交");
  const id = randomUUID();
  repo.write(key, { id, jpeg: jpeg.toString("base64") });
  return { id };
}

export function sendWallpaper(
  repo: SQLiteRepository,
  id: string,
  reply: FastifyReply,
) {
  const wallpaper = readWallpaper(repo);
  if (!wallpaper || wallpaper.id !== id) return reply.code(404).send();
  return reply
    .header("cache-control", "private, no-store")
    .type("image/jpeg")
    .send(Buffer.from(wallpaper.jpeg, "base64"));
}

export function registerWallpaper(
  app: FastifyInstance,
  repo: SQLiteRepository,
) {
  app.get("/api/yard/wallpaper", async () => ({
    id: readWallpaper(repo)?.id ?? null,
  }));
  app.get<{ Params: { id: string } }>(
    "/api/yard/wallpaper/:id",
    async (req, reply) => sendWallpaper(repo, req.params.id, reply),
  );
  app.put("/api/yard/wallpaper", { bodyLimit: 4_200_000 }, async (req) => {
    const { image } = z.object({ image: z.string() }).parse(req.body);
    return saveWallpaper(repo, validateImage(image).bytes);
  });
  app.delete("/api/yard/wallpaper", async () => {
    repo.write(key, { id: null });
    return { id: null };
  });
}
