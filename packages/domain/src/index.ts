import { z } from "zod";
import { calendarDate, addCalendarDays } from "./calendar";
export {
  TimeZone,
  CalendarPreferences,
  calendarDate,
  addCalendarDays,
  type HouseholdCalendar,
} from "./calendar";
import { categories } from "./categories";
export { Barcode, barcodeKey, ProductCandidate } from "./products";
export type { ProductLookupProvider, BarcodeReview } from "./products";
export { categories, categoryNames } from "./categories";
export const date = z.iso.date();
export const openedReminderDays = z
  .union([z.literal("default"), z.number().int().min(0).max(3650)])
  .nullable();
export const ItemInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    category: z.enum(categories).default("food"),
    quantity: z.number().finite().nonnegative().max(1000000).default(1),
    unit: z.string().trim().min(1).max(20).default("个"),
    locationId: z.string().min(1).default("fridge"),
    purchasedAt: date.optional(),
    openedAt: date.nullable().optional(),
    openedReminderDays: openedReminderDays.optional(),
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
        openedReminderDays: openedReminderDays.optional(),
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
  correction?: { eventId: string; reason: string };
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
export const today = (timeZone = "UTC", instant = new Date()) =>
  calendarDate(timeZone, instant);
export function freshnessInfo(item: ItemInput, now = today()) {
  const dates: { date: string; basis: string; estimated: boolean }[] = [];
  if (item.expiresAt)
    dates.push({
      date: item.expiresAt,
      basis: "包装到期日期",
      estimated: false,
    });
  if (item.bestBeforeAt)
    dates.push({
      date: item.bestBeforeAt,
      basis: "建议食用日期",
      estimated: !!item.metadata.estimatedDate,
    });
  const openingDays =
    typeof item.openedReminderDays === "number"
      ? item.openedReminderDays
      : item.openedReminderDays === null
        ? null
        : item.category === "food"
          ? 2
          : null;
  if (openingDays !== null && item.openedAt)
    dates.push({
      date: addCalendarDays(item.openedAt, openingDays),
      basis: `开封后${openingDays}天提醒（${typeof item.openedReminderDays === "number" ? "自定义规则" : "默认规则"}）`,
      estimated: true,
    });
  const first = dates.sort((a, b) => a.date.localeCompare(b.date))[0];
  const days = first
    ? (Date.parse(first.date) - Date.parse(now)) / 86400000
    : null;
  const status: "fresh" | "eat_soon" | "urgent" | "expired" =
    days === null
      ? "fresh"
      : days < 0
        ? "expired"
        : days === 0
          ? "urgent"
          : days <= 3
            ? "eat_soon"
            : "fresh";
  return {
    status,
    deadline: first?.date ?? null,
    basis: first?.basis ?? "未设置日期",
    estimated: first?.estimated ?? false,
    days,
  };
}
export function freshness(item: InventoryItem, now = today()) {
  return freshnessInfo(item, now).status;
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
  correct(id: string, raw: unknown) {
    const input = z
      .object({
        eventId: z.uuid(),
        expectedVersion: z.number().int().positive(),
        reason: z.string().trim().min(1).max(300),
      })
      .strict()
      .parse(raw);
    return this.repo.transaction(() => {
      const item = this.repo.get(id);
      if (!item) throw new DomainError("物品不存在");
      if (item.version !== input.expectedVersion)
        throw new DomainError("这一批库存已变化，请刷新后核对，未执行纠正");
      const events = this.repo.events().filter((e) => e.itemId === id);
      const event = events.find((e) => e.id === input.eventId);
      if (
        !event ||
        event.after.version !== item.version ||
        events.some((e) => e.after.version > event.after.version)
      )
        throw new DomainError("只能纠正这一批最近一次操作；请先核对后续变化");
      if (
        event.type === "ITEM_CORRECTED" ||
        events.some((e) => e.correction?.eventId === event.id)
      )
        throw new DomainError("这次操作已纠正，请通过编辑调整当前库存");
      const restored = event.before
        ? { ...event.before, version: item.version + 1 }
        : { ...item, quantity: 0, version: item.version + 1 };
      this.location(restored.locationId);
      this.repo.save(restored, {
        id: crypto.randomUUID(),
        itemId: id,
        type: "ITEM_CORRECTED",
        at: new Date().toISOString(),
        before: item,
        after: restored,
        correction: { eventId: event.id, reason: input.reason },
      });
      return restored;
    });
  }
  act(id: string, raw: unknown, expectedVersion?: number) {
    return this.repo.transaction(() => {
      const action = Action.parse(raw),
        old = this.repo.get(id);
      if (!old) throw new DomainError("物品不存在");
      if (expectedVersion !== undefined && old.version !== expectedVersion)
        throw new DomainError("这一批库存已变化，请刷新后重新核对");
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

export { ShoppingService, ShoppingInput, type ShoppingItem } from "./shopping";

export {
  ImageRecognition,
  ImageIntakeKind,
  OrderRecognition,
  OrderDetails,
  type ImageReview,
} from "./image-intake";

export type { IntakeEntry, IntakeFailure } from "./intake";

export const LocationAction = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create"),
      name: z.string().trim().min(1).max(32),
    })
    .strict(),
  z
    .object({
      action: z.literal("rename"),
      id: z.string().min(1).max(40),
      name: z.string().trim().min(1).max(32),
      expectedName: z.string().min(1).max(32),
    })
    .strict(),
]);
export class LocationService {
  constructor(
    readonly repo: Pick<Repository, "locations" | "transaction"> & {
      saveLocation(location: Location): void;
    },
  ) {}
  act(raw: unknown): Location {
    const action = LocationAction.parse(raw);
    return this.repo.transaction(() => {
      const all = this.repo.locations();
      const old =
        action.action === "rename"
          ? all.find((l) => l.id === action.id)
          : undefined;
      if (
        action.action === "rename" &&
        (!old || old.name !== action.expectedName)
      )
        throw new DomainError("位置已变化，请刷新后重新核对");
      const canonical = (name: string) =>
        name.normalize("NFKC").toLocaleLowerCase();
      if (
        all.some(
          (l) =>
            l.id !== old?.id && canonical(l.name) === canonical(action.name),
        )
      )
        throw new DomainError("已有同名位置，请使用不同名称");
      if (!old && all.length >= 100) throw new DomainError("存放位置最多100个");
      const location = {
        id: old?.id ?? `loc_${crypto.randomUUID()}`,
        householdId: "local",
        name: action.name,
      };
      this.repo.saveLocation(location);
      return location;
    });
  }
}
