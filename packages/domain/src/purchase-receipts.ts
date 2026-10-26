import { z } from "zod";
import type { InventoryItem } from "./index";
import type { ShoppingItem } from "./shopping";
export const purchaseQuantity = z
  .number()
  .finite()
  .positive()
  .max(1000000)
  .multipleOf(0.000001);
export type PurchaseReceipt = {
  quantity: number;
  item: InventoryItem;
  orderReviewId?: string;
  candidateId?: string;
};
const rounded = (value: number) => Number(value.toFixed(6));
export const shoppingRevision = (item: ShoppingItem) => item.revision ?? 1;
export const shoppingReceived = (item: ShoppingItem) =>
  rounded(
    (item.receipts ?? []).reduce(
      (total, receipt) => total + receipt.quantity,
      0,
    ),
  );
export const shoppingRemaining = (item: ShoppingItem) =>
  item.inventoryItemId
    ? 0
    : Math.max(0, rounded(item.quantity - shoppingReceived(item)));
export const purchaseNamesMatch = (a: string, b: string) =>
  a
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/西红柿/g, "番茄") ===
  b
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/西红柿/g, "番茄");
export const purchaseMatches = (
  entry: ShoppingItem,
  name: string,
  unit: string,
) =>
  shoppingRemaining(entry) > 0 &&
  purchaseNamesMatch(entry.name, name) &&
  entry.unit === unit.trim();
