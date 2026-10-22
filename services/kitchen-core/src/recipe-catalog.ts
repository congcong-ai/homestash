import { today } from "@homestash/domain";
import type { SQLiteRepository } from "@homestash/database";
import { recommend, refreshRecipe, type Recipe } from "@homestash/recipes";
export function recipeCatalog(
  repo: SQLiteRepository,
  people = repo.read("recipe-people", 2),
  asOf = today(),
) {
  const generated = repo.read<Recipe[]>("recipe-catalog", []);
  return [
    ...generated.map((r) => refreshRecipe(r, repo.list(), people, asOf)),
    ...recommend(repo.list(), people, asOf),
  ];
}
