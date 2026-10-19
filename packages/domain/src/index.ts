import { z } from "zod";
export const categories = [
  "food",
  "medicine",
  "supplement",
  "pet_food",
  "household",
  "cosmetic",
  "other",
] as const;
export const categoryNames: Record<(typeof categories)[number], string> = {
  food: "食品",
  medicine: "药品",
  supplement: "保健品",
  pet_food: "宠物食品",
  household: "日用品",
  cosmetic: "护肤品",
  other: "其他",
};
export const date = z.iso.date();
export const ItemInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    category: z.enum(categories).default("food"),
    quantity: z.number().finite().nonnegative().max(1000000).default(1),
    unit: z.string().trim().min(1).max(20).default("个"),
    locationId: z.string().min(1).default("fridge"),
    purchasedAt: date.optional(),
    openedAt: date.nullable().optional(),
    bestBeforeAt: date.nullable().optional(),
    expiresAt: date.nullable().optional(),
    source: z
      .enum(["voice", "camera", "barcode", "receipt", "order", "manual", "api"])
      .default("manual"),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export type ItemInput = z.infer<typeof ItemInput>;
export type InventoryItem = ItemInput & {
  id: string;
  householdId: string;
  createdAt: string;
  version: number;
};
export const Action = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("update"),
    patch: z
      .object({
        name: z.string().trim().min(1).max(80).optional(),
        category: z.enum(categories).optional(),
        quantity: z.number().finite().nonnegative().max(1000000).optional(),
        unit: z.string().trim().min(1).max(20).optional(),
        locationId: z.string().min(1).optional(),
        purchasedAt: date.optional(),
        openedAt: date.nullable().optional(),
        bestBeforeAt: date.nullable().optional(),
        expiresAt: date.nullable().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
  }),
  z.object({
    type: z.enum(["consume", "discard"]),
    quantity: z.union([z.literal("all"), z.number().positive()]),
  }),
  z.object({ type: z.literal("move"), locationId: z.string().min(1) }),
  z.object({ type: z.literal("open"), date: date }),
  z.object({ type: z.literal("expire"), date: date }),
  z.object({ type: z.literal("restock"), quantity: z.number().positive() }),
]);
export type InventoryAction = z.infer<typeof Action>;
export type InventoryEvent = {
  id: string;
  itemId: string;
  type: string;
  at: string;
  before: InventoryItem | null;
  after: InventoryItem;
};
export type Household = { id: string; name: string };
export type HouseholdMember = {
  id: string;
  householdId: string;
  name: string;
  preferences: string[];
};
export type Location = { id: string; householdId: string; name: string };
export interface Repository {
  list(): InventoryItem[];
  get(id: string): InventoryItem | undefined;
  save(item: InventoryItem, event: InventoryEvent): void;
  events(): InventoryEvent[];
  locations(): Location[];
  transaction<T>(fn: () => T): T;
}
export const today = () => new Date().toISOString().slice(0, 10);
export function freshness(
  item: InventoryItem,
  now = today(),
): "fresh" | "eat_soon" | "urgent" | "expired" {
  const dates = [item.expiresAt, item.bestBeforeAt];
  if (item.category === "food" && item.openedAt)
    dates.push(
      new Date(Date.parse(item.openedAt) + 2 * 86400000)
        .toISOString()
        .slice(0, 10),
    );
  const deadline = dates.filter((v): v is string => !!v).sort()[0];
  if (!deadline) return "fresh";
  const days = (Date.parse(deadline) - Date.parse(now)) / 86400000;
  return days < 0
    ? "expired"
    : days === 0
      ? "urgent"
      : days <= 3
        ? "eat_soon"
        : "fresh";
}
export class DomainError extends Error {}
export class InventoryService {
  constructor(readonly repo: Repository) {}
  private record(
    item: InventoryItem,
    type: string,
    before: InventoryItem | null,
  ) {
    this.repo.save(item, {
      id: crypto.randomUUID(),
      itemId: item.id,
      type,
      at: new Date().toISOString(),
      before,
      after: item,
    });
    return item;
  }
  create(raw: unknown) {
    const input = ItemInput.parse(raw);
    this.location(input.locationId);
    return this.record(
      {
        ...input,
        id: crypto.randomUUID(),
        householdId: "local",
        createdAt: new Date().toISOString(),
        version: 1,
      },
      "ITEM_CREATED",
      null,
    );
  }
  private location(id: string) {
    if (!this.repo.locations().some((l) => l.id === id))
      throw new DomainError("储存位置不存在");
  }
  act(id: string, raw: unknown) {
    return this.repo.transaction(() => {
      const action = Action.parse(raw),
        old = this.repo.get(id);
      if (!old) throw new DomainError("物品不存在");
      let item = { ...old, version: old.version + 1 };
      let type = "ITEM_UPDATED";
      switch (action.type) {
        case "update":
          item = { ...item, ...action.patch };
          this.location(item.locationId);
          break;
        case "consume":
        case "discard": {
          const n = action.quantity === "all" ? old.quantity : action.quantity;
          if (n > old.quantity) throw new DomainError("数量超过现有库存");
          item.quantity = old.quantity - n;
          type = action.type === "consume" ? "ITEM_CONSUMED" : "ITEM_DISCARDED";
          break;
        }
        case "move":
          this.location(action.locationId);
          item.locationId = action.locationId;
          type = "ITEM_MOVED";
          break;
        case "open":
          item.openedAt = action.date;
          type = "ITEM_OPENED";
          break;
        case "expire":
          item.expiresAt = action.date;
          type = "ITEM_EXPIRED";
          break;
        case "restock":
          item.quantity += action.quantity;
          type = "ITEM_RESTOCKED";
          break;
      }
      if (item.quantity > 1000000) throw new DomainError("数量超出上限");
      return this.record(item, type, old);
    });
  }
}
