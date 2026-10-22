import { recipeCatalog } from "./recipe-catalog";
import {
  DomainError,
  ShoppingService,
  freshness,
  today,
  type InventoryItem,
} from "@homestash/domain";
import type { SQLiteRepository } from "@homestash/database";
import type { InventoryService } from "@homestash/domain";
import type { Intent } from "@homestash/ai";
import { type CookingSession } from "@homestash/recipes";
type Query = Extract<Intent, { intent: "inventory_query" }>;
type ItemAction = Extract<Intent, { intent: "inventory_action" }>;
type ShoppingIntent = Extract<Intent, { intent: "shopping" }>;
export function inventoryAssistant(
  repo: SQLiteRepository,
  inventory: InventoryService,
  date: () => string = () => today(),
) {
  const shopping = new ShoppingService(repo);
  const named = (name: string) => name.trim().replace(/西红柿/g, "番茄");
  const summary = (items: InventoryItem[]) =>
    items
      .slice(0, 6)
      .map(
        (i) =>
          `${i.name}${i.quantity}${i.unit}，${repo.locations().find((l) => l.id === i.locationId)?.name ?? i.locationId}`,
      )
      .join("；") +
    (items.length > 6 ? `；另有${items.length - 6}批，请查看库存页。` : "。");
  function query(input: Query) {
    const asOf = date();
    const candidates = repo
      .list()
      .filter(
        (i) =>
          i.quantity > 0 &&
          (!input.name || i.name === named(input.name)) &&
          (!input.category || i.category === input.category) &&
          (!input.locationId || i.locationId === input.locationId),
      );
    const expired = candidates.filter((i) => freshness(i, asOf) === "expired");
    const items = candidates
      .filter((i) =>
        input.filter === "expired"
          ? freshness(i, asOf) === "expired"
          : input.filter === "expiring"
            ? ["urgent", "eat_soon"].includes(freshness(i, asOf))
            : true,
      )
      .sort(
        (a, b) =>
          (a.expiresAt || a.bestBeforeAt || "9999").localeCompare(
            b.expiresAt || b.bestBeforeAt || "9999",
          ) || a.name.localeCompare(b.name),
      );
    let message = items.length
      ? `${input.filter === "expired" ? "日期已过，请核查" : input.filter === "expiring" ? "近期需要留意" : "现有库存"}：${summary(items)}`
      : input.name
        ? `没有找到${named(input.name)}的剩余库存。`
        : input.filter === "all"
          ? "库存还是空的，可以告诉我买了什么。"
          : "没有符合条件的库存。";
    if (input.filter === "expiring" && expired.length)
      message += `另有${expired.length}批日期已过，未列入优先食用建议，请在库存中核查。`;
    if (input.filter === "expired" && items.length)
      message += "日期提醒不能替代实际状态检查。";
    return { message, items };
  }
  function act(input: ItemAction) {
    const asOf = date();
    const matches = repo
      .list()
      .filter(
        (i) =>
          i.name === named(input.name) &&
          i.quantity > 0 &&
          (!input.fromLocationId || i.locationId === input.fromLocationId),
      );
    if (matches.length !== 1)
      return {
        message: matches.length
          ? `有${matches.length}批${named(input.name)}，请在库存页选择具体批次，尚未修改。`
          : `没有找到${named(input.name)}的剩余库存，尚未修改。`,
        changed: [] as InventoryItem[],
        candidates: matches,
      };
    const item = matches[0];
    if (
      ["consume", "discard"].includes(input.action) &&
      (input.quantity === undefined ||
        (typeof input.quantity === "number" && !input.unit))
    )
      throw new DomainError(
        "请说清消耗或丢弃的数量和单位，或者明确说全部，库存未修改",
      );
    if (
      ["consume", "discard"].includes(input.action) &&
      input.unit &&
      input.unit !== item.unit
    )
      throw new DomainError(
        `库存单位是${item.unit}，与本次${input.unit}不一致，未修改；请在库存中核对`,
      );
    if (input.action === "move" && !input.locationId)
      throw new DomainError("请告诉我要移到哪里，库存未修改");
    const changed = [
      inventory.act(
        item.id,
        input.action === "open"
          ? { type: "open", date: input.date ?? asOf }
          : input.action === "move"
            ? { type: "move", locationId: input.locationId }
            : { type: input.action, quantity: input.quantity ?? "all" },
      ),
    ];
    return {
      message:
        input.action === "open"
          ? `已记录${item.name}于${input.date ?? asOf}开封。`
          : input.action === "move"
            ? `已将${item.name}移到${repo.locations().find((l) => l.id === input.locationId)?.name}。`
            : input.action === "discard"
              ? `已记录丢弃${item.name}，剩余${changed[0].quantity}${item.unit}。`
              : `已记录消耗${item.name}，剩余${changed[0].quantity}${item.unit}。`,
      changed,
    };
  }
  function shortage(recipeName?: string, people?: number, add = false) {
    const asOf = date();
    const session = repo.read<CookingSession | null>("cooking", null);
    const count =
      people ?? session?.recipe.people ?? repo.read("recipe-people", 2);
    const recipes = recipeCatalog(repo, count, asOf);
    const recipe = recipeName
      ? recipes.find((r) => r.name === named(recipeName) || r.id === recipeName)
      : session?.recipe;
    if (!recipe)
      throw new DomainError(
        "请先选一道菜，或问“做番茄炒蛋缺什么”。不会猜测家庭补货需求。",
      );
    const available = repo
      .list()
      .filter(
        (i) =>
          i.category === "food" &&
          i.quantity > 0 &&
          freshness(i, asOf) !== "expired",
      );
    const missing = recipe.ingredients
      .map((i) => ({
        ...i,
        quantity: Math.max(
          0,
          Math.round(
            (i.quantity -
              available
                .filter((f) => f.name === i.name && f.unit === i.unit)
                .reduce((sum, f) => sum + f.quantity, 0)) *
              1e6,
          ) / 1e6,
        ),
      }))
      .filter((i) => i.quantity > 0);
    const source = `recipe:${recipe.id}:${recipe.people}`;
    const waiting = shopping
      .list()
      .filter(
        (item) =>
          item.source === source &&
          item.checked &&
          !item.inventoryItemId &&
          missing.some(
            (line) => line.name === item.name && line.unit === item.unit,
          ),
      );
    if (add)
      shopping.syncRecipe(
        source,
        missing.filter(
          (line) =>
            !waiting.some(
              (item) => item.name === line.name && item.unit === line.unit,
            ),
        ),
      );
    return {
      message: missing.length
        ? `${recipe.people}人份${recipe.name}还缺：${missing.map((i) => `${i.name}${i.quantity}${i.unit}`).join("、")}。${add ? `已按当前库存复核购物清单。${waiting.length ? `其中${waiting.map((i) => i.name).join("、")}已买到，先到待确认核对入库，未重复加购。` : ""}` : "可在购物清单页确认加入；单位不一致时请先核对库存。"}`
        : `${recipe.name}的主要食材数量已齐，无需补充。`,
      missing,
      recipe,
    };
  }
  function shop(input: ShoppingIntent) {
    if (input.action === "from_recipe")
      return {
        ...shortage(input.recipeName, input.people, input.addToList ?? false),
        shopping: shopping.list(),
      };
    if (input.action === "add") {
      if (!input.name || !input.quantity || !input.unit)
        throw new DomainError(
          "请说清物品、数量和单位，例如“购物清单加一瓶牛奶”",
        );
      const item = shopping.add({
        name: named(input.name),
        quantity: input.quantity,
        unit: input.unit,
      });
      return {
        message: `已加入购物清单：${item.name}${item.quantity}${item.unit}。`,
        shopping: shopping.list(),
      };
    }
    if (input.action === "check" || input.action === "remove") {
      if (!input.name) throw new DomainError("请说出购物清单中的物品名称");
      const matches = shopping
        .list()
        .filter((i) => !i.checked && i.name === named(input.name!));
      if (matches.length !== 1)
        throw new DomainError(
          matches.length
            ? "购物清单有多条同名物品，请在页面选择具体条目"
            : "购物清单中没有找到待购买的这件物品",
        );
      shopping.act(matches[0].id, input.action);
      return {
        message:
          input.action === "check"
            ? `已标记${named(input.name)}买到了。库存未自动增加，请确认实物后入库。`
            : `已从购物清单移除${named(input.name)}。`,
        shopping: shopping.list(),
      };
    }
    const items = shopping.list().filter((i) => !i.checked);
    return {
      message: items.length
        ? `待购买：${items
            .slice(0, 8)
            .map((i) => `${i.name}${i.quantity}${i.unit}`)
            .join("、")}${items.length > 8 ? "等，请查看清单。" : "。"}`
        : "购物清单暂时没有待购买物品。",
      shopping: shopping.list(),
    };
  }
  return { query, act, shop, shortage, shopping };
}
