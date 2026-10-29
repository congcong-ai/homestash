import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";
const root = resolve(import.meta.dirname, "../..");
const configPath = resolve(root, "data/hardware/device.env");
const generic = process.env.HOMESTASH_GENERIC_FIRMWARE === "1";
const config =
  !generic && existsSync(configPath) ? parse(readFileSync(configPath)) : {};
const values = {};
for (const key of [
  "WIFI_SSID",
  "WIFI_PASSWORD",
  "WIFI_ROADSHOW_SSID",
  "WIFI_ROADSHOW_PASSWORD",
  "WIFI_OFFICE_SSID",
  "WIFI_OFFICE_PASSWORD",
  "WIFI_OFFICE_USERNAME",
  "WIFI_OFFICE_IDENTITY",
  "WIFI_OFFICE_DOMAIN",
  "CORE_URL",
  "DEVICE_ID",
  "DEVICE_TOKEN",
]) {
  const value = config[key] ?? "";
  if (value.includes("\0") || value.length > (key === "CORE_URL" ? 350 : 128))
    throw new Error(`配置长度无效：${key}`);
  values[key] = value;
}
if (values.CORE_URL && !/^https?:\/\/[^\s]+$/.test(values.CORE_URL))
  throw new Error("CORE_URL 必须使用 HTTP/HTTPS");
if (values.DEVICE_ID && !/^[a-z0-9-]{1,64}$/.test(values.DEVICE_ID))
  throw new Error("DEVICE_ID 格式无效");
let header = "#pragma once\n/* 自动生成，包含本机配置，请勿提交。 */\n";
for (const [key, value] of Object.entries(values))
  header += `#define CONFIG_HS_${key} ${JSON.stringify(value)}\n`;
header += `#define CONFIG_HS_NETWORK_MODE 0\n#define CONFIG_HS_BUILD_EPOCH ${Math.floor(Date.now() / 1000)}\n`;
if (config.WIFI_OFFICE_USERNAME) {
  if (!config.WIFI_OFFICE_CA_FILE || !config.WIFI_OFFICE_DOMAIN)
    throw new Error("企业 Wi-Fi 必须配置 CA 和认证域名");
  header +=
    "#define CONFIG_HS_WIFI_OFFICE_ENTERPRISE 1\n#define CONFIG_HS_WIFI_OFFICE_VERIFY_CA 1\n";
}
const ca = config.WIFI_OFFICE_CA_FILE
  ? readFileSync(resolve(root, config.WIFI_OFFICE_CA_FILE), "utf8")
  : "";
header += `static const unsigned char office_ca[] = ${JSON.stringify(ca)};\n`;
const project = resolve(
  process.env.HOMESTASH_FIRMWARE_PROJECT ??
    resolve(root, "firmware/freshmate-korvo"),
);
if (
  !project.startsWith(resolve(root, "firmware") + "/") ||
  !existsSync(resolve(project, "CMakeLists.txt"))
)
  throw Error("固件工程路径无效");
const build = resolve(project, "build");
mkdirSync(build, { recursive: true });
writeFileSync(resolve(build, "local-network-config.h"), header, {
  mode: 0o600,
});
console.log(
  generic
    ? "已生成通用固件配置（不嵌入网络和设备凭据）。"
    : existsSync(configPath)
      ? "已生成独立设备配置（不输出凭据）。"
      : "未配置网络：生成仅供编译验证的固件。",
);
