import { z } from "zod";
import {
  DomainError,
  ItemInput,
  type InventoryItem,
  type InventoryService,
} from "./index";
export const ShoppingInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    quantity: z.number().positive().max(1000000),
    unit: z.string().trim().min(1).max(20),
  })
  .strict();
export type ShoppingItem = z.infer<typeof ShoppingInput> & {
  id: string;
  checked: boolean;
  source: string;
  createdAt: string;
  stockedAt?: string;
  inventoryItemId?: string;
  receivedItem?: InventoryItem;
  confirmationSignature?: string;
};
export interface ShoppingRepository {
  read<T>(key: string, fallback: T): T;
  write(key: string, value: unknown): void;
  transaction<T>(work: () => T): T;
}
export class ShoppingService {
  constructor(private repo: ShoppingRepository) {}
  list() {
    return this.repo.read<ShoppingItem[]>("shopping", []);
  }
  add(raw: unknown, source = "manual") {
    const input = ShoppingInput.parse(raw);
    return this.repo.transaction(() => {
      const items = this.list();
      const index = items.findIndex(
        (i) =>
          !i.checked &&
          i.name === input.name &&
          i.unit === input.unit &&
          i.source === source,
      );
      const item =
        index < 0
          ? {
              ...input,
              id: crypto.randomUUID(),
              checked: false,
              source,
              createdAt: new Date().toISOString(),
            }
          : {
              ...items[index],
              quantity:
                source === "manual"
                  ? items[index].quantity + input.quantity
                  : input.quantity,
            };
      if (item.quantity > 1000000) throw new DomainError("购物数量超出上限");
      if (index < 0) items.push(item);
      else items[index] = item;
      this.repo.write("shopping", items);
      return item;
    });
  }
  receive(id: string, raw: unknown, inventory: InventoryService) {
    const input = ItemInput.extend({
      quantity: z.number().finite().positive().max(1000000),
      unit: z.string().trim().min(1).max(20),
    }).parse(raw);
    const signature = JSON.stringify(input);
    return this.repo.transaction(() => {
      const items = this.list();
      const index = items.findIndex((item) => item.id === id);
      if (index < 0) throw new DomainError("购物清单中没有找到这一项");
      const entry = items[index];
      if (entry.inventoryItemId) {
        if (entry.confirmationSignature !== signature)
          throw new DomainError(
            "这一项已经入库，不能修改内容再次提交；新增一批请重新加入清单",
          );
        return {
          shopping: entry,
          item:
            entry.receivedItem ??
            (inventory.repo.get(entry.inventoryItemId) as InventoryItem),
        };
      }
      if (!entry.checked) throw new DomainError("请先标记已买到，再核对入库");
      const item = inventory.create({
        ...input,
        source: "manual",
        metadata: {
          ...input.metadata,
          shopping: {
            id: entry.id,
            source: entry.source,
            plannedQuantity: entry.quantity,
            plannedUnit: entry.unit,
          },
        },
      });
      const result = {
        ...entry,
        stockedAt: new Date().toISOString(),
        inventoryItemId: item.id,
        receivedItem: item,
        confirmationSignature: signature,
      };
      items[index] = result;
      this.repo.write("shopping", items);
      return { shopping: result, item };
    });
  }
  act(id: string, action: "check" | "uncheck" | "remove") {
    return this.repo.transaction(() => {
      const items = this.list(),
        index = items.findIndex((i) => i.id === id);
      if (index < 0) throw new DomainError("购物清单中没有找到这一项");
      if (action === "uncheck" && items[index].inventoryItemId)
        throw new DomainError(
          "已入库的购物项不能改回待购买，请到库存中管理物品",
        );
      if (action === "remove") items.splice(index, 1);
      else items[index] = { ...items[index], checked: action === "check" };
      this.repo.write("shopping", items);
      return items;
    });
  }
}
