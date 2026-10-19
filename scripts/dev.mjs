import { spawn, execFileSync } from "node:child_process";
import "dotenv/config";
const production = process.argv.includes("--production");
const port = Number(process.env.CORE_PORT ?? 3100);
if (port !== 3100)
  throw new Error("Phase 0 统一使用 Core 3100 端口，请保持配置与 Web 代理一致");
for (const p of [3000, port, ...(process.env.DEVICE_TOKEN ? [3101] : [])]) {
  let ids = "";
  try {
    ids = execFileSync("lsof", ["-ti", `tcp:${p}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
    });
  } catch {}
  for (const id of ids.trim().split(/\s+/).filter(Boolean)) {
    try {
      process.kill(Number(id), "SIGTERM");
    } catch {}
  }
}
await new Promise((r) => setTimeout(r, 500));
const children = [];
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
  }
}
for (const sig of ["SIGINT", "SIGTERM"])
  process.on(sig, () => {
    stop();
    process.exit(0);
  });
function run(args) {
  const child = spawn("pnpm", args, { stdio: "inherit", detached: true });
  children.push(child);
  child.on("exit", (code) => {
    if (!stopping) {
      stop();
      process.exit(code ?? 1);
    }
  });
}
run([
  "exec",
  "tsx",
  ...(production ? [] : ["watch"]),
  "services/kitchen-core/src/main.ts",
]);
let ready = false;
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) {
      ready = true;
      break;
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}
if (!ready) {
  stop();
  throw new Error("Core 未能就绪");
}
run(["--filter", "@homestash/web", production ? "start" : "dev"]);
