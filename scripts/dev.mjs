import { spawn } from "node:child_process";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  ensureLanAuth,
  preparePort,
  selectLanAddress,
} from "./lib/local-network.mjs";
const production = process.argv.includes("--production");
const lan = process.argv.includes("--lan");
if (lan && (production || process.env.NODE_ENV === "production"))
  throw Error("局域网试用入口只支持开发模式；正式使用请配置HTTPS部署");
let accessPath = null;
const host = lan
  ? selectLanAddress(process.env.HOMESTASH_LAN_ADDRESS)
  : "127.0.0.1";
if (lan) {
  const auth = ensureLanAuth(
    resolve(process.env.HOMESTASH_LAN_DIR ?? "data/lan"),
    process.env,
  );
  Object.assign(process.env, auth.config);
  accessPath = auth.accessPath;
  process.env.HOMESTASH_LAN_ENABLED = "true";
  process.env.HOMESTASH_LAN_ADDRESS = host;
} else {
  delete process.env.HOMESTASH_LAN_ENABLED;
  delete process.env.HOMESTASH_LAN_ADDRESS;
}
const root = process.cwd();
const webPort = await preparePort(
  Number(process.env.WEB_PORT ?? 3000),
  host,
  root,
);
let port = await preparePort(
  Number(process.env.CORE_PORT ?? 3100),
  "127.0.0.1",
  root,
);
if (port === webPort) port = await preparePort(port + 1, "127.0.0.1", root);
let devicePort = await preparePort(
  Number(process.env.DEVICE_PORT ?? 3101),
  process.env.DEVICE_HOST ?? "127.0.0.1",
  root,
);
while ([webPort, port].includes(devicePort))
  devicePort = await preparePort(
    devicePort + 1,
    process.env.DEVICE_HOST ?? "127.0.0.1",
    root,
  );
process.env.HOMESTASH_INSTANCE_ID = randomUUID();
process.env.WEB_PORT = String(webPort);
process.env.CORE_PORT = String(port);
process.env.DEVICE_PORT = String(devicePort);
process.env.CORE_INTERNAL_URL = `http://127.0.0.1:${port}`;
process.env.APP_ORIGIN = lan
  ? `http://${host}:${webPort}`
  : (process.env.APP_ORIGIN ?? `http://127.0.0.1:${webPort}`);
console.log(
  `HomeStash 网页：${lan ? process.env.APP_ORIGIN : `http://127.0.0.1:${webPort}`}/app`,
);
console.log(`Core：127.0.0.1:${port}；设备接口端口：${devicePort}`);
if (lan) {
  console.log(
    "手机需与电脑处于同一可信局域网；本入口为HTTP开发试用，不做公网端口映射。",
  );
  console.log(
    accessPath
      ? `家庭访问凭据仅保存在本机：${accessPath}`
      : "使用已配置的后台登录账号和密码。",
  );
}
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
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (
      response.ok &&
      (await response.json()).instanceId === process.env.HOMESTASH_INSTANCE_ID
    ) {
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
run([
  "--filter",
  "@homestash/web",
  "exec",
  "next",
  production ? "start" : "dev",
  "--hostname",
  host,
  "--port",
  String(webPort),
]);
