import { z } from "zod";
import { categories } from "./categories";
import type { InventoryItem } from "./index";

// GTIN-8/12/13/14；保留前导零，不把条码作为数字处理。
export const Barcode = z
  .string()
  .trim()
  .refine((value) => {
    if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(value)) return false;
    const digits = [...value].map(Number);
    const check = digits.pop();
    const sum = digits
      .reverse()
      .reduce((n, d, i) => n + d * (i % 2 ? 1 : 3), 0);
    return (10 - (sum % 10)) % 10 === check;
  }, "请输入校验位正确的8、12、13或14位商品条码");
export const barcodeKey = (value: string) =>
  Barcode.parse(value).padStart(14, "0");
export const ProductCandidate = z
  .object({
    barcode: Barcode,
    name: z.string().trim().min(1).max(80),
    category: z.enum(categories),
    brand: z.string().max(120).optional(),
    packageDescription: z.string().max(120).optional(),
    source: z.enum(["local", "open-food-facts"]),
    sourceUrl: z.url().optional(),
  })
  .strict();
export type ProductCandidate = z.infer<typeof ProductCandidate>;
export interface ProductLookupProvider {
  readonly kind: string;
  lookup(barcode: string): Promise<ProductCandidate | null>;
}
export type BarcodeReview = {
  id: string;
  barcode: string;
  createdAt: string;
  status: "pending" | "confirmed" | "cancelled";
  product: ProductCandidate | null;
  note: string;
  confirmationSignature?: string;
  confirmedItem?: InventoryItem;
};
