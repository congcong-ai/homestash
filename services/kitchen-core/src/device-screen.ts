import { createHash } from "node:crypto";
import { freshness, today } from "@homestash/domain";
import type { SQLiteRepository } from "@homestash/database";
import {
  cookingText,
  type CookingSession,
  type Recipe,
} from "@homestash/recipes";
export const devicePages = [
  "home",
  "inventory",
  "freshness",
  "recipes",
  "cooking",
  "shopping",
] as const;
export type DevicePage = (typeof devicePages)[number];
const short = (s: string, n = 18) =>
  Array.from(s.replace(/[\r\n\t]/g, " "))
    .slice(0, n)
    .join("");
export function deviceScreen(
  repo: SQLiteRepository,
  recipes: Recipe[],
  page: DevicePage,
  asOf = today(),
) {
  const items = repo.list().filter((i) => i.quantity > 0);
  const locations = repo.locations();
  const label = (i: (typeof items)[number]) =>
    `${short(i.name, 12)} ${i.quantity}${short(i.unit, 4)}`;
  const soon = items.filter(
    (i) =>
      i.category === "food" &&
      ["urgent", "eat_soon"].includes(freshness(i, asOf)),
  );
  const expired = items.filter(
    (i) => i.category === "food" && freshness(i, asOf) === "expired",
  );
  let lines: string[];
  switch (page) {
    case "home":
      lines = [
        "今天先吃",
        ...soon.slice(0, 2).map(label),
        ...(soon.length ? [] : ["暂无临期食物"]),
        "今晚推荐",
        ...recipes
          .slice(0, 2)
          .map((r) => `${short(r.name)} · ${r.minutes}分钟`),
      ];
      break;
    case "inventory":
      lines = [
        `家中库存 · ${items.length} 批`,
        ...items
          .slice(0, 5)
          .map(
            (i) =>
              `${label(i)} · ${short(locations.find((l) => l.id === i.locationId)?.name ?? i.locationId, 6)}`,
          ),
      ];
      break;
    case "freshness":
      lines = [
        `临期 ${soon.length} 批 · 已过期 ${expired.length} 批`,
        ...expired.slice(0, 2).map((i) => `已过期：${label(i)}`),
        ...soon.slice(0, 3).map((i) => `先吃：${label(i)}`),
      ];
      break;
    case "recipes":
      lines = [
        "今晚吃什么",
        ...recipes
          .slice(0, 2)
          .flatMap((r) => [
            `${short(r.name)} · ${r.people}人份 / ${r.minutes}分钟`,
            r.missing.length
              ? `待补：${short(r.missing.join("、"), 24)}`
              : "主要食材已备齐",
          ]),
        "按 SET 说开始做哪道菜",
      ];
      break;
    case "cooking": {
      const session = repo.read<CookingSession | null>("cooking", null);
      lines = session
        ? [
            session.status === "completed"
              ? "做饭已结束"
              : session.status === "awaiting_confirmation"
                ? "做完了，请在网页确认消耗"
                : "做饭进度",
            cookingText(session),
          ]
        : ["还没有做饭任务", "在网页选菜，或按 SET 说开始做菜"];
      break;
    }
    case "shopping": {
      const list = repo
        .read<
          { name: string; quantity: number; unit: string; checked: boolean }[]
        >("shopping", [])
        .filter((i) => !i.checked);
      lines = [
        `待采购 · ${list.length} 项`,
        ...list
          .slice(0, 5)
          .map((i) => `${short(i.name, 16)} ${i.quantity}${short(i.unit, 4)}`),
      ];
      break;
    }
  }
  if (lines.length === 1) lines.push("暂无记录，可在网页或通过语音添加");
  const text = Array.from(lines.join("\n")).slice(0, 240).join("");
  return {
    page,
    text,
    revision: createHash("sha256").update(text).digest("hex"),
  };
}
