import { z } from "zod";
import { categories } from "./categories";
import type { InventoryItem } from "./index";
export const ImageRecognition = z
  .object({
    notes: z.string().max(500),
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
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export type ImageRecognition = z.infer<typeof ImageRecognition>;
export type ImageReview = {
  id: string;
  status: "pending" | "confirmed" | "cancelled";
  createdAt: string;
  imageHash: string;
  notes: string;
  candidates: (ImageRecognition["candidates"][number] & { id: string })[];
  confirmationSignature?: string;
  confirmedItems?: InventoryItem[];
};
