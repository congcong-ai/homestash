import { createHash } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  DomainError,
  ItemInput,
  ImageRecognition,
  type ImageReview,
  type InventoryService,
} from "@homestash/domain";
import type { SQLiteRepository } from "@homestash/database";
import type { AIProvider } from "@homestash/ai";
const maxBytes = 3 * 1024 * 1024;
export function validateImage(dataUrl: string) {
  const match =
    /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      dataUrl,
    );
  if (!match)
    throw new DomainError("请选择 JPEG、PNG 或 WebP 图片，不接受远程图片地址");
  const bytes = Buffer.from(match[2], "base64");
  if (
    bytes.length < 24 ||
    bytes.length > maxBytes ||
    bytes.toString("base64") !== match[2]
  )
    throw new DomainError("图片内容无效或超过3 MB，请换一张图片");
  const png = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg =
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes.at(-2) === 255 &&
    bytes.at(-1) === 217;
  const webp =
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP";
  if (!{ "image/png": png, "image/jpeg": jpeg, "image/webp": webp }[match[1]])
    throw new DomainError("图片内容与格式不一致，库存未改变");
  if (
    png &&
    (bytes.toString("ascii", 12, 16) !== "IHDR" ||
      !bytes.readUInt32BE(16) ||
      !bytes.readUInt32BE(20) ||
      bytes.readUInt32BE(16) > 10000 ||
      bytes.readUInt32BE(20) > 10000 ||
      bytes.readUInt32BE(16) * bytes.readUInt32BE(20) > 40000000)
  )
    throw new DomainError("PNG 图片尺寸无效或过大");
  return {
    bytes,
    mime: match[1],
    hash: createHash("sha256").update(bytes).digest("hex"),
  };
}
type Once = <T>(
  key: string,
  body: unknown,
  work: () => Promise<() => T>,
) => Promise<T>;
export function registerImageIntake(
  app: FastifyInstance,
  repo: SQLiteRepository,
  inventory: InventoryService,
  once: Once,
  provider: () => AIProvider,
) {
  const key = (id: string) => `image-intake:${id}`;
  const get = (id: string) => {
    const review = repo.read<ImageReview | null>(key(id), null);
    if (!review) throw new DomainError("找不到这次图片识别，请重新选择图片");
    return review;
  };
  const idFrom = (params: unknown) =>
    z.object({ id: z.uuid() }).parse(params).id;
  const analyze = async (requestId: string, dataUrl: string) => {
    const image = validateImage(dataUrl);
    const review = await once(
      `image-analysis:${requestId}`,
      { hash: image.hash, mime: image.mime },
      async () => {
        const ai = provider();
        if (!ai.recognizeImage)
          throw new DomainError(
            "当前 Mock 模式没有图片识别能力，请在设置中启用外部 AI 并配置视觉模型",
          );
        const result = ImageRecognition.parse(await ai.recognizeImage(dataUrl));
        return () => {
          const review: ImageReview = {
            id: crypto.randomUUID(),
            status: "pending",
            createdAt: new Date().toISOString(),
            imageHash: image.hash,
            notes: result.notes,
            candidates: result.candidates.map((candidate) => ({
              ...candidate,
              name: candidate.name.replace(/西红柿/g, "番茄"),
              id: crypto.randomUUID(),
            })),
          };
          repo.write(key(review.id), review);
          repo.write("image-intake-index", [
            ...repo.read<string[]>("image-intake-index", []),
            review.id,
          ]);
          return review;
        };
      },
    );
    return get(review.id);
  };
  app.get("/api/intake/images", async () =>
    repo
      .read<string[]>("image-intake-index", [])
      .slice(-20)
      .reverse()
      .map((id) => get(id)),
  );
  app.post(
    "/api/intake/images",
    { bodyLimit: 5 * 1024 * 1024 },
    async (req) => {
      const b = z
        .object({ requestId: z.uuid(), dataUrl: z.string().max(4300000) })
        .strict()
        .parse(req.body);
      return analyze(b.requestId, b.dataUrl);
    },
  );
  app.post("/api/intake/images/:id/confirm", async (req) => {
    const id = idFrom(req.params);
    const b = z
      .object({
        requestId: z.uuid(),
        items: z
          .array(
            z
              .object({
                candidateId: z.uuid(),
                item: ItemInput.refine(
                  (i) => i.quantity > 0,
                  "入库数量必须大于0",
                ),
              })
              .strict(),
          )
          .min(1)
          .max(20),
      })
      .strict()
      .parse(req.body);
    const selection = b.items
      .slice()
      .sort((a, b) => a.candidateId.localeCompare(b.candidateId));
    if (new Set(selection.map((i) => i.candidateId)).size !== selection.length)
      throw new DomainError("同一候选不能重复选择");
    const signature = JSON.stringify(selection);
    return once(
      `image-confirm:${b.requestId}`,
      { id, selection },
      async () => () => {
        const review = get(id);
        if (review.status === "confirmed") {
          if (review.confirmationSignature !== signature)
            throw new DomainError(
              "这次图片已经确认入库，不能使用不同内容再次提交",
            );
          return review;
        }
        if (review.status !== "pending")
          throw new DomainError("这次图片识别已取消，请重新识别");
        for (const line of selection)
          if (!review.candidates.some((c) => c.id === line.candidateId))
            throw new DomainError("选中了不属于这张图片的候选，库存未改变");
        const items = selection.map((line) => {
          const candidate = review.candidates.find(
            (c) => c.id === line.candidateId,
          )!;
          return inventory.create({
            ...line.item,
            source: "camera",
            metadata: {
              ...line.item.metadata,
              imageIntake: {
                reviewId: id,
                candidateId: candidate.id,
                evidence: candidate.evidence,
                confidence: candidate.confidence,
              },
            },
          });
        });
        const confirmed: ImageReview = {
          ...review,
          status: "confirmed",
          confirmationSignature: signature,
          confirmedItems: items,
        };
        repo.write(key(id), confirmed);
        return confirmed;
      },
    );
  });
  app.post("/api/intake/images/:id/cancel", async (req) => {
    const id = idFrom(req.params);
    return repo.transaction(() => {
      const review = get(id);
      if (review.status === "confirmed")
        throw new DomainError("已经入库的图片不能取消，请到库存中管理物品");
      const cancelled: ImageReview = { ...review, status: "cancelled" };
      repo.write(key(id), cancelled);
      return cancelled;
    });
  });
  return { analyze };
}
