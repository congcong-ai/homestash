import { z } from "zod";
import type { ImageReview } from "./image-intake";
// 收货按原单位计数，最多六位小数；不从净含量推导单位换算。
export const OrderQuantity = z
  .number()
  .finite()
  .nonnegative()
  .max(1000000)
  .multipleOf(0.000001);
export const OrderFulfillment = z
  .object({
    revision: z.number().int().positive(),
    lines: z
      .array(
        z
          .object({
            candidateId: z.uuid(),
            expectedQuantity: OrderQuantity.positive().nullable(),
            unit: z.string().trim().min(1).max(20).nullable(),
            receivedQuantity: OrderQuantity,
            closed: z.boolean(),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export type OrderFulfillment = z.infer<typeof OrderFulfillment>;
export const orderAmount = (value: number) => Number(value.toFixed(6));
export function orderLineBlocked(review: ImageReview, candidateId: string) {
  const status = review.candidates.find((c) => c.id === candidateId)?.orderLine
    ?.status;
  return (
    ["cancelled", "refunded"].includes(status ?? "unknown") ||
    ["cancelled", "refunded"].includes(review.order?.status ?? "unknown")
  );
}
export function orderFulfillment(review: ImageReview): OrderFulfillment {
  return structuredClone(
    review.fulfillment ?? {
      revision: 1,
      lines: review.candidates.map((c) => ({
        candidateId: c.id,
        expectedQuantity:
          c.quantity !== null &&
          OrderQuantity.positive().safeParse(c.quantity).success
            ? c.quantity
            : null,
        unit: c.unit,
        receivedQuantity: 0,
        closed: orderLineBlocked(review, c.id),
      })),
    },
  );
}
export const remainingOrderQuantity = (
  line: OrderFulfillment["lines"][number],
) =>
  line.expectedQuantity === null
    ? null
    : orderAmount(line.expectedQuantity - line.receivedQuantity);
export const orderFulfillmentComplete = (progress: OrderFulfillment) =>
  progress.lines.every(
    (line) => line.closed || remainingOrderQuantity(line) === 0,
  );
