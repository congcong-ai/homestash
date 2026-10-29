import { spawn } from "node:child_process";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { preparePort, selectLanAddress } from "./lib/local-network.mjs";
const production = process.argv.includes("--production");
const lan = process.argv.includes("--lan");
if (lan && (production || process.env.NODE_ENV === "production"))
  throw Error("局域网试用入口只支持开发模式；正式使用请配置HTTPS部署");
const host = lan
  ? selectLanAddress(process.env.HOMESTASH_LAN_ADDRESS)
  : "127.0.0.1";
if (lan) {
  process.env.INTERNAL_LOGIN_ENABLED = "false";
  process.env.HOMESTASH_LAN_ENABLED = "true";
  process.env.HOMESTASH_LAN_ADDRESS = host;
} else {
  delete process.env.HOMESTASH_LAN_ENABLED;
  delete process.env.HOMESTASH_LAN_ADDRESS;
}
if (lan) process.env.DEVICE_HOST = "0.0.0.0";
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
  { fixed: lan },
);
if (lan && [webPort, port].includes(devicePort))
  throw Error("网页或Core端口与固定设备端口冲突，请调整WEB_PORT或CORE_PORT");
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
  `正在启动后台：${lan ? process.env.APP_ORIGIN : `http://127.0.0.1:${webPort}`}/app`,
);
console.log(`Core：127.0.0.1:${port}；设备接口端口：${devicePort}`);
if (lan) {
  if (process.platform === "darwin") {
    try {
      const name = execFileSync("scutil", ["--get", "LocalHostName"], {
        encoding: "utf8",
      }).trim();
      console.log(
        `开发板固定后台地址：http://${name}.local:${devicePort}（网络需允许mDNS与设备互访）`,
      );
    } catch {
      console.log("未读取到Mac局域网名称，请在开发板设置中使用当前IP地址。");
    }
  }
  console.log(
    "手机需与电脑处于同一可信局域网；本入口为HTTP开发试用，不做公网端口映射。",
  );
  console.log("家庭内部直接访问，无需账号和密码。");
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

const browserOrigin = lan
  ? process.env.APP_ORIGIN
  : `http://127.0.0.1:${webPort}`;
let webReady = false;
for (let i = 0; i < 60; i++) {
  try {
    const response = await fetch(`${browserOrigin}/app`, {
      signal: AbortSignal.timeout(1500),
      redirect: "manual",
    });
    await response.body?.cancel();
    if (response.status === 200) {
      webReady = true;
      break;
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (!webReady) {
  stop();
  throw new Error("后台网页未能就绪，请检查上方启动日志");
}
console.log(`
HomeStash 后台已就绪
后台管理入口：${browserOrigin}/app
请打开上方带 /app 的链接；Next.js 的 Local / Network 根地址进入官网首页。
`);
