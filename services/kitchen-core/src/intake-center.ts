import { z } from "zod";
import { orderFulfillment, remainingOrderQuantity } from "@homestash/domain";
import type { FastifyInstance } from "fastify";
import type { SQLiteRepository } from "@homestash/database";
import type {
  IntakeEntry,
  IntakeFailure,
  ImageReview,
  BarcodeReview,
  ShoppingItem,
} from "@homestash/domain";

// 失败记录仅保存重试所需标识，不保存原图、服务响应或密钥。
export function intakeFailure(
  repo: SQLiteRepository,
  kind: IntakeFailure["kind"],
  id: string,
  barcode?: string,
  imageKind?: "photo" | "order",
) {
  repo.transaction(() => {
    const old = repo.read<IntakeFailure[]>("intake-failures", []);
    repo.write("intake-failures", [
      ...old.filter((r) => r.id !== id || r.kind !== kind),
      {
        id,
        kind,
        status: "failed",
        createdAt: new Date().toISOString(),
        ...(barcode ? { barcode } : {}),
        ...(imageKind ? { imageKind } : {}),
      },
    ]);
  });
}
export function clearIntakeFailure(
  repo: SQLiteRepository,
  kind: IntakeFailure["kind"],
  id: string,
) {
  repo.write(
    "intake-failures",
    repo
      .read<IntakeFailure[]>("intake-failures", [])
      .filter((r) => r.kind !== kind || r.id !== id),
  );
}
export function registerIntakeCenter(
  app: FastifyInstance,
  repo: SQLiteRepository,
) {
  app.get("/api/intake/reviews", async () => {
    const images = repo
      .read<string[]>("image-intake-index", [])
      .map((id) => repo.read<ImageReview | null>(`image-intake:${id}`, null))
      .filter((r) => r !== null);
    const barcodes = repo
      .read<string[]>("barcode-intake-index", [])
      .map((id) =>
        repo.read<BarcodeReview | null>(`barcode-intake:${id}`, null),
      )
      .filter((r) => r !== null);
    const shopping = repo
      .read<ShoppingItem[]>("shopping", [])
      .filter((r) => r.checked);
    const entries: IntakeEntry[] = [
      ...images.map((r) => ({
        id: r.id,
        kind: "image" as const,
        ...(r.kind === "order" ? { imageKind: "order" as const } : {}),
        status: r.status,
        createdAt: r.createdAt,
        title:
          (r.status === "confirmed"
            ? r.confirmedItems?.map((c) => c.name).join("、")
            : r.candidates.map((c) => c.name).join("、")) || "图片未识别出物品",
        note:
          r.status === "confirmed"
            ? r.confirmedItems
                ?.map((i) => `${i.name} ${i.quantity}${i.unit}`)
                .join("、") || "已确认入库"
            : r.status === "cancelled"
              ? "已取消，库存未改变"
              : r.fulfillment
                ? `已入库 ${r.confirmedItems?.length ?? 0} 批，剩余 ${orderFulfillment(r).lines.filter((l) => !l.closed && remainingOrderQuantity(l) !== 0).length} 项待收货`
                : r.notes || `${r.candidates.length} 个候选，核对后入库`,
      })),
      ...barcodes.map((r) => ({
        id: r.id,
        kind: "barcode" as const,
        status: r.status,
        createdAt: r.createdAt,
        title: r.confirmedItem?.name ?? r.product?.name ?? r.barcode,
        note:
          r.status === "confirmed"
            ? `${r.confirmedItem?.quantity ?? ""}${r.confirmedItem?.unit ?? ""} · 已入库`
            : r.status === "cancelled"
              ? "已取消，库存未改变"
              : r.note,
        barcode: r.barcode,
      })),
      ...shopping.map((r) => ({
        id: r.id,
        kind: "shopping" as const,
        status: r.inventoryItemId
          ? ("confirmed" as const)
          : ("pending" as const),
        createdAt: r.stockedAt ?? r.createdAt,
        title: r.receivedItem?.name ?? r.name,
        note: r.inventoryItemId
          ? `${r.receivedItem ? `${r.receivedItem.quantity}${r.receivedItem.unit} · ` : ""}已入库`
          : `${r.quantity}${r.unit} · 已买到，待核对实际数量和日期`,
      })),
      ...repo.read<IntakeFailure[]>("intake-failures", []).map((r) => ({
        ...r,
        title:
          r.kind === "image"
            ? r.imageKind === "order"
              ? "订单截图识别未完成"
              : "图片识别未完成"
            : `条码查询未完成 · ${r.barcode}`,
        note:
          r.kind === "image"
            ? "请重新选择原图后重试；原图未保存，库存未改变。"
            : "检查商品服务后重试，库存未改变。",
      })),
    ];
    return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });
  app.post("/api/intake/failures/:kind/:id/dismiss", async (req) => {
    const { kind, id } = z
      .object({ kind: z.enum(["image", "barcode"]), id: z.uuid() })
      .parse(req.params);
    repo.transaction(() => clearIntakeFailure(repo, kind, id));
    return { ok: true };
  });
}
