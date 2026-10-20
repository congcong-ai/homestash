import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
for (const k of Object.keys(process.env))
  if (/^(all|http|https|no)_proxy$/i.test(k)) delete process.env[k];
Object.assign(
  process.env,
  parseEnv(readFileSync("/var/www/homestash/shared/.env", "utf8")),
);
const role = process.argv[2];
if (!["core", "web"].includes(role)) throw Error("无效服务角色");
const child = spawn(
  process.execPath,
  role === "core"
    ? ["dist/core.mjs"]
    : [
        "node_modules/next/dist/bin/next",
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        process.env.WEB_PORT,
      ],
  {
    cwd: role === "core" ? process.cwd() : resolve("apps/web"),
    env: process.env,
    stdio: "inherit",
  },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", () => process.exit(1));
