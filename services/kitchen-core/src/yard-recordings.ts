import type { SQLiteRepository } from "@homestash/database";
import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { z } from "zod";
const settingsKey = "product:food-spirit-yard:recordings:settings:v1";
export const recordingsKey = "product:food-spirit-yard:recordings:v1";
export type Recording = {
  id: string;
  deviceId: string;
  path: string;
  sha256: string;
  bytes: number;
  createdAt: string;
  text?: string;
  speakerId: null;
  retryAfter?: number;
  analysis: "pending" | "disabled" | "complete" | "failed";
};
export function recordingSettings(repo: SQLiteRepository) {
  return repo.read(settingsKey, { transcribe: false, recognizeSpeaker: false });
}
export function recordings(repo: SQLiteRepository) {
  return repo.read<Recording[]>(recordingsKey, []);
}
export function registerRecordings(
  app: FastifyInstance,
  repo: SQLiteRepository,
) {
  app.get("/api/yard/recordings", async () => ({
    settings: recordingSettings(repo),
    speakerRecognitionAvailable: false,
    items: recordings(repo).map((item) => ({
      id: item.id,
      deviceId: item.deviceId,
      sha256: item.sha256,
      bytes: item.bytes,
      createdAt: item.createdAt,
      text: item.text,
      speakerId: item.speakerId,
      analysis: item.analysis,
      url: `/api/yard/recordings/${item.id}/audio`,
    })),
  }));
  app.patch("/api/yard/recordings/settings", async (req) => {
    const next = z
      .object({ transcribe: z.boolean(), recognizeSpeaker: z.literal(false) })
      .strict()
      .parse(req.body);
    if (next.transcribe)
      repo.write(
        recordingsKey,
        recordings(repo).map((v) =>
          v.analysis === "disabled" ? { ...v, analysis: "pending" } : v,
        ),
      );
    repo.write(settingsKey, next);
    return next;
  });
  app.get("/api/yard/recordings/:id/audio", async (req, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const item = recordings(repo).find((v) => v.id === id);
    if (!item) return reply.code(404).send({ error: "找不到录音" });
    try {
      return reply.type("audio/wav").send(await readFile(item.path));
    } catch {
      return reply.code(404).send({ error: "录音文件不可用" });
    }
  });
}
