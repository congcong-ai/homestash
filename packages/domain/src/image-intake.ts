import { z } from "zod";
import { categories } from "./categories";
import type { InventoryItem } from "./index";
export const ImageIntakeKind = z.enum(["photo", "order"]);
export type ImageIntakeKind = z.infer<typeof ImageIntakeKind>;
export const OrderStatus = z.enum([
  "received",
  "pending",
  "cancelled",
  "refunded",
  "unknown",
]);
export const OrderDetails = z
  .object({
    platform: z.string().trim().min(1).max(80).nullable(),
    purchasedAt: z.iso.date().nullable(),
    status: OrderStatus,
  })
  .strict();
export const OrderLine = z
  .object({
    specification: z.string().trim().min(1).max(200).nullable(),
    status: OrderStatus,
  })
  .strict();
export const ImageRecognition = z
  .object({
    notes: z.string().max(500),
    order: OrderDetails.optional(),
    candidates: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(80),
            category: z.enum(categories),
            quantity: z.number().positive().max(1000000).nullable(),
            unit: z.string().trim().min(1).max(20).nullable(),
            evidence: z.string().trim().min(1).max(300),
            confidence: z.enum(["high", "medium", "low"]),
            bestBeforeAt: z.iso.date().nullable(),
            expiresAt: z.iso.date().nullable(),
            orderLine: OrderLine.optional(),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export const OrderRecognition = ImageRecognition.extend({
  order: OrderDetails,
  candidates: z
    .array(
      ImageRecognition.shape.candidates.element.extend({
        orderLine: OrderLine,
      }),
    )
    .max(20),
});
export type ImageRecognition = z.infer<typeof ImageRecognition>;
export type ImageReview = {
  id: string;
  status: "pending" | "confirmed" | "cancelled";
  createdAt: string;
  imageHash: string;
  kind?: ImageIntakeKind;
  order?: z.infer<typeof OrderDetails>;
  fulfillment?: import("./order-fulfillment").OrderFulfillment;
  notes: string;
  candidates: (ImageRecognition["candidates"][number] & { id: string })[];
  confirmationSignature?: string;
  confirmedItems?: InventoryItem[];
};
