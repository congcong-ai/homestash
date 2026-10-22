import { intakeFailure, clearIntakeFailure } from "./intake-center";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  DomainError,
  ItemInput,
  ImageRecognition,
  ImageIntakeKind,
  OrderRecognition,
  OrderQuantity,
  OrderFulfillment,
  orderFulfillment,
  orderAmount,
  orderLineBlocked,
  remainingOrderQuantity,
  orderFulfillmentComplete,
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
  const analyze = async (
    requestId: string,
    dataUrl: string,
    kind: ImageIntakeKind = "photo",
  ) => {
    const image = validateImage(dataUrl);
    const review = await once(
      `image-analysis:${requestId}`,
      {
        hash: image.hash,
        mime: image.mime,
        ...(kind === "order" ? { kind } : {}),
      },
      async () => {
        // 同一订单截图换请求ID仍复用候选；不同截图不猜测属于同一订单。
        if (kind === "order") {
          const existing = repo
            .read<string[]>("image-intake-index", [])
            .map(get)
            .find(
              (r) =>
                r.kind === "order" &&
                r.imageHash === image.hash &&
                r.status !== "cancelled",
            );
          if (existing)
            return () => {
              clearIntakeFailure(repo, "image", requestId);
              return existing;
            };
        }
        const ai = provider();
        if (!ai.recognizeImage)
          throw new DomainError(
            "当前 Mock 模式没有图片识别能力，请在设置中启用外部 AI 并配置视觉模型",
          );
        let result: ImageRecognition;
        try {
          result = (
            kind === "order" ? OrderRecognition : ImageRecognition
          ).parse(await ai.recognizeImage(dataUrl, kind));
        } catch (error) {
          intakeFailure(repo, "image", requestId, undefined, kind);
          throw error;
        }
        return () => {
          clearIntakeFailure(repo, "image", requestId);
          const review: ImageReview = {
            id: crypto.randomUUID(),
            status: "pending",
            createdAt: new Date().toISOString(),
            imageHash: image.hash,
            ...(kind === "order" ? { kind, order: result.order! } : {}),
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
  app.get("/api/intake/images/:id", async (req) => get(idFrom(req.params)));
  app.get("/api/intake/images", async () =>
    repo
      .read<string[]>("image-intake-index", [])
      .reverse()
      .map((id) => get(id)),
  );
  app.post(
    "/api/intake/images",
    { bodyLimit: 5 * 1024 * 1024 },
    async (req) => {
      const b = z
        .object({
          requestId: z.uuid(),
          dataUrl: z.string().max(4300000),
          kind: ImageIntakeKind.default("photo"),
        })
        .strict()
        .parse(req.body);
      return analyze(b.requestId, b.dataUrl, b.kind);
    },
  );
  app.post("/api/intake/images/:id/confirm", async (req) => {
    const id = idFrom(req.params);
    const b = z
      .object({
        requestId: z.uuid(),
        received: z.boolean().optional(),
        expectedRevision: z.number().int().positive().optional(),
        items: z
          .array(
            z
              .object({
                candidateId: z.uuid(),
                totalQuantity: OrderQuantity.positive().optional(),
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
      {
        id,
        selection,
        ...(b.received !== undefined ? { received: b.received } : {}),
        ...(b.expectedRevision !== undefined
          ? { expectedRevision: b.expectedRevision }
          : {}),
      },
      async () => () => {
        const review = get(id);
        const partial =
          review.kind === "order" && b.expectedRevision !== undefined;
        if (review.fulfillment && !partial)
          throw new DomainError("此订单已启用分批收货，请刷新后核对收货进度");
        const progress = partial ? orderFulfillment(review) : undefined;
        if (progress && progress.revision !== b.expectedRevision)
          throw new DomainError("订单收货进度已变化，请刷新并重新核对剩余数量");
        if (review.status === "confirmed") {
          if (review.confirmationSignature !== signature)
            throw new DomainError(
              "这次图片已经确认入库，不能使用不同内容再次提交",
            );
          return review;
        }
        if (review.status !== "pending")
          throw new DomainError("这次图片识别已取消，请重新识别");
        if (review.kind === "order" && b.received !== true)
          throw new DomainError("请确认已实际收到所选商品，再核对数量入库");
        if (
          review.kind === "order" &&
          selection.some((line) => orderLineBlocked(review, line.candidateId))
        )
          throw new DomainError("已取消或退款的订单商品不能入库，请取消勾选");
        for (const line of selection)
          if (!review.candidates.some((c) => c.id === line.candidateId))
            throw new DomainError("选中了不属于这张图片的候选，库存未改变");
        if (progress) {
          for (const line of selection) {
            const entry = progress.lines.find(
              (l) => l.candidateId === line.candidateId,
            )!;
            if (entry.closed || remainingOrderQuantity(entry) === 0)
              throw new DomainError("所选商品已经收齐或结束收货，请刷新");
            OrderQuantity.positive().parse(line.item.quantity);
            const total = line.totalQuantity ?? entry.expectedQuantity;
            if (total === null)
              throw new DomainError("请先核对订单总量，再确认本次实收");
            if (entry.receivedQuantity > 0 && entry.unit !== line.item.unit)
              throw new DomainError(
                "已收货商品不能更换计数单位，请保持原单位核对",
              );
            if (
              total < entry.receivedQuantity ||
              orderAmount(entry.receivedQuantity + line.item.quantity) > total
            )
              throw new DomainError(
                "本次实收超过订单剩余数量，请核对订单总量和已收数量",
              );
            entry.expectedQuantity = total;
            entry.unit = line.item.unit;
            entry.receivedQuantity = orderAmount(
              entry.receivedQuantity + line.item.quantity,
            );
          }
          progress.revision++;
          OrderFulfillment.parse(progress);
        }
        const items = selection.map((line) => {
          const candidate = review.candidates.find(
            (c) => c.id === line.candidateId,
          )!;
          return inventory.create({
            ...line.item,
            source: review.kind === "order" ? "order" : "camera",
            metadata: {
              ...line.item.metadata,
              imageIntake: {
                reviewId: id,
                candidateId: candidate.id,
                evidence: candidate.evidence,
                confidence: candidate.confidence,
                ...(review.kind === "order"
                  ? {
                      kind: "order",
                      order: review.order,
                      orderLine: candidate.orderLine,
                      receivedConfirmed: true,
                      ...(progress
                        ? { receiptRevision: progress.revision }
                        : {}),
                    }
                  : {}),
              },
            },
          });
        });
        const confirmed: ImageReview = {
          ...review,
          status:
            progress && !orderFulfillmentComplete(progress)
              ? "pending"
              : "confirmed",
          confirmationSignature: signature,
          confirmedItems: [...(review.confirmedItems ?? []), ...items],
          ...(progress ? { fulfillment: progress } : {}),
        };
        repo.write(key(id), confirmed);
        return confirmed;
      },
    );
  });
  app.post("/api/intake/images/:id/finish-order", async (req) => {
    const id = idFrom(req.params);
    const body = z
      .object({
        requestId: z.uuid(),
        expectedRevision: z.number().int().positive(),
        confirmation: z.literal("结束剩余收货"),
      })
      .strict()
      .parse(req.body);
    return once(
      `order-finish:${body.requestId}`,
      { id, expectedRevision: body.expectedRevision },
      async () => () => {
        const review = get(id);
        if (review.kind !== "order" || review.status !== "pending")
          throw new DomainError("这次订单已经结束，请刷新");
        const progress = orderFulfillment(review);
        if (progress.revision !== body.expectedRevision)
          throw new DomainError("订单收货进度已变化，请刷新并重新核对");
        progress.revision++;
        for (const line of progress.lines) line.closed = true;
        const finished: ImageReview = {
          ...review,
          fulfillment: progress,
          status: review.confirmedItems?.length ? "confirmed" : "cancelled",
        };
        repo.write(key(id), finished);
        return finished;
      },
    );
  });
  app.post("/api/intake/images/:id/cancel", async (req) => {
    const id = idFrom(req.params);
    return repo.transaction(() => {
      const review = get(id);
      if (review.fulfillment)
        throw new DomainError(
          "分批收货订单请使用结束剩余收货，已入库批次会保留",
        );
      if (review.status === "confirmed")
        throw new DomainError("已经入库的图片不能取消，请到库存中管理物品");
      const cancelled: ImageReview = { ...review, status: "cancelled" };
      repo.write(key(id), cancelled);
      return cancelled;
    });
  });
  return { analyze };
}
