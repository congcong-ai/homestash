import { freshness, type InventoryItem } from "@homestash/domain";
export type Recipe = {
  id: string;
  name: string;
  minutes: number;
  ingredients: { name: string; quantity: number; unit: string }[];
  steps: string[];
  used: string[];
  missing: string[];
  people: number;
};
const templates = [
  {
    id: "tomato-eggs",
    name: "番茄炒蛋",
    minutes: 15,
    ingredients: [
      { name: "番茄", quantity: 2, unit: "个" },
      { name: "鸡蛋", quantity: 3, unit: "个" },
    ],
    steps: [
      "番茄洗净切块，鸡蛋打散。",
      "热锅加少量油，倒入蛋液炒至凝固后盛出。",
      "炒软番茄，加入鸡蛋和少许盐，翻炒均匀后出锅。",
    ],
  },
  {
    id: "tomato-soup",
    name: "番茄蛋花汤",
    minutes: 12,
    ingredients: [
      { name: "番茄", quantity: 1, unit: "个" },
      { name: "鸡蛋", quantity: 2, unit: "个" },
    ],
    steps: [
      "番茄洗净切小块，鸡蛋打散备用。",
      "锅中加少量油炒软番茄，加600毫升水，煮开后再煮3分钟。",
      "缓缓倒入蛋液，煮至蛋花完全凝固，少量盐调味。",
    ],
  },
  {
    id: "strawberry-bowl",
    name: "草莓水果碗",
    minutes: 5,
    ingredients: [{ name: "草莓", quantity: 1, unit: "盒" }],
    steps: [
      "挑出变质果实，余下草莓用流动清水洗净。",
      "去蒂切块，放入干净碗中。",
      "直接享用，切好的水果尽快食用。",
    ],
  },
  {
    id: "spinach-eggs",
    name: "菠菜炒蛋",
    minutes: 12,
    ingredients: [
      { name: "菠菜", quantity: 1, unit: "把" },
      { name: "鸡蛋", quantity: 2, unit: "个" },
    ],
    steps: [
      "菠菜洗净，沸水焯熟后沥干。",
      "鸡蛋打散，热锅少量油炒至凝固。",
      "加入菠菜翻炒，加少许盐调味。",
    ],
  },
];
export function recommend(items: InventoryItem[], people = 2): Recipe[] {
  const food = items.filter(
    (i) =>
      i.category === "food" && i.quantity > 0 && freshness(i) !== "expired",
  );
  return templates
    .map((t) => {
      const ingredients = t.ingredients.map((i) => ({
        ...i,
        quantity: (i.quantity * people) / 2,
      }));
      const used = ingredients
        .filter((i) => food.some((f) => f.name === i.name))
        .map((i) => i.name);
      const missing = ingredients
        .filter(
          (i) =>
            food
              .filter((f) => f.name === i.name && f.unit === i.unit)
              .reduce((sum, f) => sum + f.quantity, 0) < i.quantity,
        )
        .map((i) => `${i.name} ${i.quantity}${i.unit}（核对数量/单位）`);
      return { ...t, ingredients, used, missing, people };
    })
    .sort(
      (a, b) =>
        b.used.length - a.used.length || a.missing.length - b.missing.length,
    )
    .slice(0, 3);
}
export type CookingSession = {
  id: string;
  recipe: Recipe;
  step: number;
  answer: string;
};
export function cookingAnswer(s: CookingSession, question: string) {
  if (/多久/.test(question))
    return `整道菜预计 ${s.recipe.minutes} 分钟，当前步骤：${s.recipe.steps[s.step]}。请以实际熟度为准。`;
  if (/多少/.test(question))
    return `${s.recipe.people} 人份：${s.recipe.ingredients.map((i) => `${i.name}${i.quantity}${i.unit}`).join("、")}；盐和油按口味少量添加。`;
  if (/没有|代替/.test(question))
    return "缺少主要食材时，可以返回食谱页选择材料更齐全的菜；不会自动替换过敏食材或扣减库存。";
  return `当前是第 ${s.step + 1} 步：${s.recipe.steps[s.step]}。模拟助手支持询问用量、时间或缺少材料。`;
}
