import { networkInterfaces } from "node:os";
import { createServer } from "node:net";
import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { randomBytes, scryptSync } from "node:crypto";
import { parseEnv } from "node:util";
export function isPrivateAddress(value) {
  if (typeof value !== "string" || !/^\d+\.\d+\.\d+\.\d+$/.test(value))
    return false;
  const n = value.split(".").map(Number);
  if (n.some((v, i) => v > 255 || String(v) !== value.split(".")[i]))
    return false;
  return (
    n[0] === 10 ||
    (n[0] === 192 && n[1] === 168) ||
    (n[0] === 172 && n[1] >= 16 && n[1] <= 31)
  );
}
export function lanAddresses(interfaces = networkInterfaces()) {
  return Object.entries(interfaces)
    .flatMap(([name, rows]) =>
      (rows ?? [])
        .filter(
          (r) =>
            r.family === "IPv4" && !r.internal && isPrivateAddress(r.address),
        )
        .map((r) => ({ name, address: r.address })),
    )
    .filter((r) => !/^(utun|tun|tap|docker|veth|bridge|vmnet)/i.test(r.name))
    .sort(
      (a, b) =>
        Number(!/^(en|eth|wlan|Wi-Fi)/i.test(a.name)) -
          Number(!/^(en|eth|wlan|Wi-Fi)/i.test(b.name)) ||
        a.name.localeCompare(b.name),
    );
}
export function selectLanAddress(requested, addresses = lanAddresses()) {
  const chosen = requested
    ? addresses.find((r) => r.address === requested)
    : addresses[0];
  if (!chosen || !isPrivateAddress(chosen.address))
    throw Error(
      "没有可用的家庭局域网IPv4地址，请连接Wi-Fi；多网卡可用 HOMESTASH_LAN_ADDRESS 指定实际接口地址",
    );
  return chosen.address;
}
export function validateLanAuth(env) {
  if (
    env.INTERNAL_LOGIN_ENABLED !== "true" ||
    !env.INTERNAL_LOGIN_USERNAME?.trim() ||
    !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(
      env.INTERNAL_LOGIN_PASSWORD_HASH ?? "",
    ) ||
    (env.INTERNAL_SESSION_SECRET?.length ?? 0) < 32
  )
    throw Error("局域网入口必须配置有效的登录账号、密码哈希和会话密钥");
}
export function ensureLanAuth(directory, env) {
  const keys = [
    "INTERNAL_LOGIN_ENABLED",
    "INTERNAL_LOGIN_USERNAME",
    "INTERNAL_LOGIN_PASSWORD_HASH",
    "INTERNAL_SESSION_SECRET",
  ];
  if (env.INTERNAL_LOGIN_ENABLED === "true") {
    validateLanAuth(env);
    return {
      config: Object.fromEntries(keys.map((k) => [k, env[k]])),
      accessPath: null,
    };
  }
  const file = join(directory, "auth.env"),
    accessPath = join(directory, "access.txt");
  if (existsSync(file)) {
    const values = parseEnv(readFileSync(file, "utf8"));
    validateLanAuth(values);
    return {
      config: Object.fromEntries(keys.map((k) => [k, values[k]])),
      accessPath: existsSync(accessPath) ? accessPath : null,
    };
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const password = randomBytes(18).toString("base64url"),
    salt = randomBytes(16).toString("hex");
  const config = {
    INTERNAL_LOGIN_ENABLED: "true",
    INTERNAL_LOGIN_USERNAME: "home",
    INTERNAL_LOGIN_PASSWORD_HASH: `${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
    INTERNAL_SESSION_SECRET: randomBytes(32).toString("hex"),
  };
  writeFileSync(
    file,
    Object.entries(config)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n",
    { mode: 0o600, flag: "wx" },
  );
  writeFileSync(
    accessPath,
    `HomeStash 家庭局域网访问\n账号：home\n密码：${password}\n\n仅供可信家庭网络使用。此文件不要分享或提交Git。\n`,
    { mode: 0o600, flag: "wx" },
  );
  return { config, accessPath };
}
export function listenerPids(port) {
  try {
    return execFileSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(Number);
  } catch {
    return [];
  }
}
function belongsTo(pid, root) {
  try {
    const output = execFileSync(
      "lsof",
      ["-a", "-p", String(pid), "-d", "cwd", "-Fn"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const cwd = output
      .split("\n")
      .find((l) => l.startsWith("n"))
      ?.slice(1);
    return (
      cwd &&
      (resolve(cwd) === resolve(root) ||
        resolve(cwd).startsWith(resolve(root) + sep))
    );
  } catch {
    return false;
  }
}
export function portAvailable(port, host) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}
export async function preparePort(
  preferred,
  host,
  root,
  { fixed = false } = {},
) {
  if (!Number.isInteger(preferred) || preferred < 1024 || preferred > 65535)
    throw Error("服务端口必须为1024至65535的整数");
  let stopped = false;
  for (const pid of listenerPids(preferred))
    if (pid !== process.pid && belongsTo(pid, root)) {
      try {
        process.kill(pid, "SIGTERM");
        stopped = true;
      } catch {
        /* 无权限时选择其他可用端口。 */
      }
    }
  if (stopped) await new Promise((r) => setTimeout(r, 600));
  for (
    let port = preferred;
    port <= Math.min(preferred + (fixed ? 0 : 99), 65535);
    port++
  )
    if (await portAvailable(port, host)) return port;
  throw Error(
    fixed
      ? `设备固定端口 ${preferred} 已被其他程序占用，请释放该端口后重试`
      : "附近100个端口均不可用，请指定其他起始端口",
  );
}
