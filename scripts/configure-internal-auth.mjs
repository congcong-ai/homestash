import { readFileSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { parseEnv } from "node:util";
import { randomBytes, scryptSync } from "node:crypto";
const base = process.argv[2] ?? "/var/www/homestash/shared";
const path = `${base}/.env`;
let source = readFileSync(path, "utf8");
const config = parseEnv(source);
const replace = !!process.env.HOMESTASH_SETUP_PASSWORD;
let password;
const changes = {};
if (config.INTERNAL_LOGIN_ENABLED !== "true")
  changes.INTERNAL_LOGIN_ENABLED = "true";
if (!config.INTERNAL_LOGIN_USERNAME || replace)
  changes.INTERNAL_LOGIN_USERNAME =
    process.env.HOMESTASH_SETUP_USERNAME ?? "demo";
if (!config.INTERNAL_LOGIN_PASSWORD_HASH || replace) {
  password =
    process.env.HOMESTASH_SETUP_PASSWORD ??
    randomBytes(18).toString("base64url");
  const salt = randomBytes(16).toString("hex");
  changes.INTERNAL_LOGIN_PASSWORD_HASH = `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
if (!config.INTERNAL_SESSION_SECRET || replace)
  changes.INTERNAL_SESSION_SECRET = randomBytes(32).toString("hex");
for (const [key, value] of Object.entries(changes)) {
  source = source.replace(new RegExp(`^${key}=.*\\r?\\n?`, "gm"), "");
  source = source.trimEnd() + `\n${key}=${value}\n`;
}
if (Object.keys(changes).length) {
  writeFileSync(path, source);
  chmodSync(path, 0o600);
}
if (password) {
  writeFileSync(
    `${base}/access.txt`,
    `内部测试登录：https://${new URL(config.APP_ORIGIN).host}/login\n账号：${changes.INTERNAL_LOGIN_USERNAME ?? config.INTERNAL_LOGIN_USERNAME}\n密码：${password}\n`,
    { mode: 0o600 },
  );
  chmodSync(`${base}/access.txt`, 0o600);
} else if (!existsSync(`${base}/access.txt`))
  console.log("凭据已配置；请使用已有登录密码。");
console.log("内部测试登录配置就绪");
