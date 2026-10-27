import {
  freshnessInfo,
  shoppingRemaining,
  type HouseholdCalendar,
  type InventoryItem,
  type Location,
  type ShoppingItem,
} from "@homestash/domain";
import type { Recipe, CookingSession } from "@homestash/recipes";
import type { OfflineSnapshot } from "../public/offline-storage.js";
export function offlineSnapshot(
  state: {
    offlineAccess: { scope: string; expiresAt: number };
    calendar: HouseholdCalendar;
    items: InventoryItem[];
    locations: Location[];
    shopping: ShoppingItem[];
    recipes: Recipe[];
    cooking: CookingSession | null;
  },
  now = Date.now(),
): OfflineSnapshot {
  return {
    version: 1,
    scope: state.offlineAccess.scope,
    savedAt: now,
    expiresAt: state.offlineAccess.expiresAt,
    timeZone: state.calendar.timeZone,
    date: state.calendar.date,
    items: state.items.map((i) => {
      const info = freshnessInfo(i, state.calendar.date);
      return {
        name: i.name,
        category: i.category,
        quantity: i.quantity,
        unit: i.unit,
        location:
          state.locations.find((l) => l.id === i.locationId)?.name ??
          "未知位置",
        status: info.status,
        deadline: info.deadline ?? null,
      };
    }),
    shopping: state.shopping.map((i) => ({
      name: i.name,
      quantity: shoppingRemaining(i),
      unit: i.unit,
      checked: i.checked,
    })),
    recipes: state.recipes.map((r) => ({ name: r.name, steps: r.steps })),
    cooking: state.cooking
      ? {
          name: state.cooking.recipe.name,
          step:
            state.cooking.recipe.steps[state.cooking.step] ?? "请重连核对进度",
        }
      : null,
  };
}
