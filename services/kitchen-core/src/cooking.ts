import { recipeCatalog } from "./recipe-catalog";
import {
  DomainError,
  freshness,
  type InventoryService,
} from "@homestash/domain";
import type { SQLiteRepository } from "@homestash/database";
import {
  cookingAnswer,
  cookingText,
  consumptionPlan,
  type CookingSession,
} from "@homestash/recipes";
export type CookingAction =
  | "start"
  | "next"
  | "previous"
  | "ask"
  | "repeat"
  | "finish"
  | "confirm_consumption"
  | "skip_consumption";
export function cookingService(
  repo: SQLiteRepository,
  inventory: InventoryService,
  screen: (text: string) => void,
) {
  const current = () => repo.read<CookingSession | null>("cooking", null);
  function act(
    action: CookingAction,
    recipeId?: string,
    question = "",
    people = 2,
    expected?: { id: string | null; step?: number; revision?: number },
    preparedAnswer?: string,
  ) {
    let session = current();
    if (expected && (session?.id ?? null) !== expected.id)
      throw new DomainError("做饭任务已变化，请重新说一次指令");
    if (expected?.step !== undefined && session?.step !== expected.step)
      throw new DomainError("步骤已变化，请重新说一次指令");
    if (
      expected?.revision !== undefined &&
      (session?.revision ?? 0) !== expected.revision
    )
      throw new DomainError("做饭进度或确认清单已变化，请重新核对后再操作");
    if (action === "start") {
      const recipe = recipeCatalog(repo, people).find(
        (r) =>
          r.id === recipeId || r.name === recipeId?.replace("西红柿", "番茄"),
      );
      if (!recipe)
        throw new DomainError("请选择当前推荐的食谱，并说出完整菜名");
      session = {
        id: crypto.randomUUID(),
        recipe,
        step: 0,
        answer: "",
        status: "active",
      };
    } else {
      if (!session) throw new DomainError("请先选择食谱并开始做饭");
      session = structuredClone(session);
      if (session.status === "completed") return session;
      if (action === "finish") {
        const plan = consumptionPlan(session.recipe, repo.list());
        session.status = "awaiting_confirmation";
        session.consumption = plan;
        session.answer = plan.missing.length
          ? `做完啦。库存不足或单位不匹配：${plan.missing.join("、")}。尚未扣减；请在库存核对，或说“不扣减”。核对后再说“做完了”可重新检查。`
          : `做完啦。是否按食谱扣减${session.recipe.ingredients.map((i) => `${i.name}${i.quantity}${i.unit}`).join("、")}？说“确认扣减”或“不扣减”。实际用量不同请选“不扣减”后在库存手动记录。`;
      } else if (action === "confirm_consumption") {
        const plan = session.consumption;
        if (
          session.status !== "awaiting_confirmation" ||
          !plan ||
          plan.state !== "pending"
        )
          throw new DomainError("请先说“做完了”，核对待扣减数量");
        if (plan.missing.length)
          throw new DomainError(
            "库存不足或单位不匹配，未扣减；请核对后再说“做完了”",
          );
        for (const line of plan.lines) {
          const item = repo.get(line.itemId);
          if (
            !item ||
            item.version !== line.version ||
            item.category !== "food" ||
            freshness(item) === "expired" ||
            item.quantity < line.quantity
          )
            throw new DomainError(
              "待扣减批次已变化或过期，未扣减；请再说“做完了”重新核对",
            );
        }
        for (const line of plan.lines)
          inventory.act(line.itemId, {
            type: "consume",
            quantity: line.quantity,
          });
        session.consumption = { ...plan, state: "confirmed" };
        session.status = "completed";
        session.answer = `已完成${session.recipe.name}，并按确认数量扣减食材。好好享用吧。`;
      } else if (action === "skip_consumption") {
        if (session.status !== "awaiting_confirmation" || !session.consumption)
          throw new DomainError("请先说“做完了”再选择不扣减");
        session.consumption.state = "skipped";
        session.status = "completed";
        session.answer = `已完成${session.recipe.name}，库存未扣减。好好享用吧。`;
      } else if (action === "ask") {
        session.answer = preparedAnswer ?? cookingAnswer(session, question);
      } else if (session.status === "awaiting_confirmation") {
        // 重复播报确认提示，不能因“下一步”意外取消确认或扣减库存。
        session.answer =
          "做饭已结束，请说“做完了”重新核对用量，或说“不扣减”结束。";
      } else {
        if (action === "next")
          session.step = Math.min(
            session.recipe.steps.length - 1,
            session.step + 1,
          );
        if (action === "previous") session.step = Math.max(0, session.step - 1);
        session.answer = "";
      }
    }
    session.revision = (session.revision ?? 0) + 1;
    repo.write("cooking", session);
    screen(cookingText(session));
    return session;
  }
  return { current, act };
}
