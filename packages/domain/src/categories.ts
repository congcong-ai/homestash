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
