import { intakeFailure, clearIntakeFailure } from "./intake-center";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { SQLiteRepository } from "@homestash/database";
import {
  Barcode,
  barcodeKey,
  ProductCandidate,
  ItemInput,
  DomainError,
  type BarcodeReview,
  type InventoryService,
  type ProductLookupProvider,
} from "@homestash/domain";
import {
  LocalProductLookupProvider,
  OpenFoodFactsProvider,
} from "./product-lookup";

type Once = <T>(
  key: string,
  body: unknown,
  work: () => Promise<() => T>,
) => Promise<T>;
export function registerBarcodeIntake(
  app: FastifyInstance,
  repo: SQLiteRepository,
  inventory: InventoryService,
  once: Once,
  override?: ProductLookupProvider,
) {
  const external =
    override ??
    (process.env.PRODUCT_LOOKUP_PROVIDER === "open-food-facts"
      ? new OpenFoodFactsProvider()
      : null);
  const local = new LocalProductLookupProvider((key) =>
    repo.read(`product:${key}`, null),
  );
  const get = (id: string) => {
    const review = repo.read<BarcodeReview | null>(
      `barcode-intake:${id}`,
      null,
    );
    if (!review) throw new DomainError("找不到这次条码查询，请重新查询");
    return review;
  };
  const idFrom = (params: unknown) =>
    z.object({ id: z.uuid() }).parse(params).id;
  app.get("/api/intake/barcodes/:id", async (req) => get(idFrom(req.params)));
  app.get("/api/intake/barcodes", async () => ({
    externalProvider: external?.kind ?? null,
    reviews: repo.read<string[]>("barcode-intake-index", []).reverse().map(get),
  }));
  app.post("/api/intake/barcodes", async (req) => {
    const body = z
      .object({ requestId: z.uuid(), barcode: Barcode })
      .strict()
      .parse(req.body);
    const result = await once(
      `barcode-lookup:${body.requestId}`,
      { barcode: body.barcode },
      async () => {
        let product: ProductCandidate | null;
        try {
          product =
            (await local.lookup(body.barcode)) ??
            (await external?.lookup(body.barcode)) ??
            null;
          if (
            product &&
            barcodeKey(product.barcode) !== barcodeKey(body.barcode)
          )
            throw new DomainError("查询商品条码不匹配，库存未改变");
          if (product) product = ProductCandidate.parse(product);
        } catch (error) {
          intakeFailure(repo, "barcode", body.requestId, body.barcode);
          throw error;
        }
        const candidate = product;
        return () => {
          clearIntakeFailure(repo, "barcode", body.requestId);
          const review: BarcodeReview = {
            id: crypto.randomUUID(),
            barcode: body.barcode,
            status: "pending",
            createdAt: new Date().toISOString(),
            product: candidate,
            note: candidate
              ? "商品信息仅供核对，数量、位置和日期请按实物填写。"
              : external
                ? "没有查到商品，请对照包装补全名称；也可以改用拍照识别。"
                : "本地尚未记录此商品，外部查询未启用。请对照包装填写，确认后可供下次查询。",
          };
          repo.write(`barcode-intake:${review.id}`, review);
          repo.write("barcode-intake-index", [
            ...repo.read<string[]>("barcode-intake-index", []),
            review.id,
          ]);
          return review;
        };
      },
    );
    return get(result.id);
  });
  app.post("/api/intake/barcodes/:id/confirm", async (req) => {
    const id = idFrom(req.params);
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
    const signature = JSON.stringify(body.item);
    return once(
      `barcode-confirm:${body.requestId}`,
      { id, item: body.item },
      async () => () => {
        const review = get(id);
        if (review.status === "confirmed") {
          if (review.confirmationSignature !== signature)
            throw new DomainError(
              "此条码已确认，不能修改内容再次提交；新增一批请重新查询",
            );
          return review;
        }
        if (review.status !== "pending")
          throw new DomainError("这次条码查询已取消");
        const item = inventory.create({
          ...body.item,
          source: "barcode",
          metadata: {
            ...body.item.metadata,
            barcode: review.barcode,
            barcodeIntake: {
              reviewId: id,
              productSource: review.product?.source ?? "manual",
              sourceUrl: review.product?.sourceUrl ?? null,
            },
          },
        });
        // 只记商品基础资料；不跨批次复用数量、有效期、开封日期或存放位置。
        repo.write(`product:${barcodeKey(review.barcode)}`, {
          barcode: review.barcode,
          name: item.name,
          category: item.category,
          source: "local",
          sourceUrl: review.product?.sourceUrl,
        } satisfies ProductCandidate);
        const result: BarcodeReview = {
          ...review,
          status: "confirmed",
          confirmationSignature: signature,
          confirmedItem: item,
        };
        repo.write(`barcode-intake:${id}`, result);
        return result;
      },
    );
  });
  app.post("/api/intake/barcodes/:id/cancel", async (req) => {
    const id = idFrom(req.params);
    return repo.transaction(() => {
      const review = get(id);
      if (review.status === "confirmed")
        throw new DomainError("已入库的物品请到库存中管理");
      const result: BarcodeReview = { ...review, status: "cancelled" };
      repo.write(`barcode-intake:${id}`, result);
      return result;
    });
  });
}
