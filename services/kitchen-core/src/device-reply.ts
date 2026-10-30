import type { InventoryItem } from "@homestash/domain";

type Reply = {
  intent: { intent: string; filter?: string };
  message: string;
  items?: InventoryItem[];
};
/** 仅将已确认的业务结果改成口语，不调用模型重写数量、单位或位置。 */
export function deviceReply(
  result: Reply,
  locations: { id: string; name: string }[],
): string {
  const plain = result.message.replace(/^(喵～|慢慢来，)/u, "");
  if (result.intent.intent !== "inventory_query" || !result.items?.length) {
    const short = plain.replace("建议日期可以在库存里修改。", "");
    return /^(已添加|已更新|已记录|已完成)/u.test(short)
      ? `好哒，${short}`
      : short;
  }
  const rows = new Map<
    string,
    { name: string; unit: string; quantity: number; location: string }
  >();
  for (const item of result.items) {
    const key = JSON.stringify([item.locationId, item.name, item.unit]);
    const row = rows.get(key);
    if (row) row.quantity = Number((row.quantity + item.quantity).toFixed(6));
    else
      rows.set(key, {
        name: item.name,
        unit: item.unit,
        quantity: item.quantity,
        location:
          locations.find((l) => l.id === item.locationId)?.name ??
          item.locationId,
      });
  }
  const groups = new Map<string, string[]>();
  for (const row of [...rows.values()].slice(0, 6)) {
    const parts = groups.get(row.location) ?? [];
    parts.push(`${row.quantity}${row.unit}${row.name}`);
    groups.set(row.location, parts);
  }
  const list =
    [...groups]
      .map(([location, parts]) => `${location}里有${parts.join("、")}`)
      .join("；") + "。";
  const prefix =
    result.intent.filter === "expired"
      ? "这些日期已经过啦，请先核查："
      : result.intent.filter === "expiring"
        ? "小冰提醒你，这些要先留意哦："
        : "有哒！";
  const more =
    rows.size > 6 ? `还有${rows.size - 6}样，详细清单可以在后台看。` : "";
  const warning =
    result.intent.filter === "expired"
      ? "日期提醒不能替代实际状态检查。"
      : (plain.match(/另有\d+批日期已过[^。]*。/u)?.[0] ?? "");
  return prefix + list + more + warning;
}
