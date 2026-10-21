import { readFileSync, existsSync } from "node:fs";
import { resolve, sep } from "node:path";
const root = resolve(import.meta.dirname, "../..");
const manifest = JSON.parse(
  readFileSync(resolve(root, "firmware/targets.json"), "utf8"),
);
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--list") {
  for (const [id, target] of Object.entries(manifest.targets))
    console.log(`${id} · ${target.boardId} · ${target.project}`);
} else {
  if (args.length !== 0 && !(args.length === 2 && args[0] === "--board"))
    throw Error("用法：--board 板型构建名，或 --list");
  const id = args[1] ?? manifest.default,
    target = manifest.targets[id];
  if (!target)
    throw Error("未知构建目标，请先登记firmware/targets.json；不会退回Korvo");
  const project = resolve(root, target.project);
  if (
    !project.startsWith(resolve(root, "firmware") + sep) ||
    !existsSync(resolve(project, "CMakeLists.txt")) ||
    !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(target.boardId) ||
    !/^[a-f0-9]{40}$/.test(target.idfCommit) ||
    /[\t\r\n]/.test(project)
  )
    throw Error("构建目标配置无效");
  console.log(
    [
      project,
      target.boardId,
      target.idfCommit,
      target.prepareS31BleDependencies ? "1" : "0",
    ].join("\t"),
  );
}
