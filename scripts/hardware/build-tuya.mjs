import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const target = JSON.parse(
  readFileSync(resolve(root, "firmware/targets.json"), "utf8"),
).targets["tuya-t5-ai"];
const project = resolve(root, target.project);
const sdk = process.env.HOMESTASH_TUYAOPEN_PATH;
if (!sdk || !existsSync(resolve(sdk, "tos.py")))
  throw Error(
    "请将 HOMESTASH_TUYAOPEN_PATH 指向已安装的 TuyaOpen v1.5.0；安装说明见 T5 README。",
  );
function verify(path, commit, label) {
  const actual = execFileSync("git", ["-C", path, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  if (actual !== commit)
    throw Error(`${label} 提交与锁定版本不符，请按文档准备 SDK。`);
}
verify(sdk, target.sdkCommit, "TuyaOpen");
verify(resolve(sdk, "platform/T5AI"), target.platformCommit, "T5 平台");
const configPath = resolve(project, "config.local.json");
const generic = process.env.HOMESTASH_GENERIC_FIRMWARE === "1";
const config =
  !generic && existsSync(configPath)
    ? JSON.parse(readFileSync(configPath, "utf8"))
    : {};
const rules = {
  coreUrl: [350, "CORE_URL"],
  deviceId: [64, "DEVICE_ID"],
  deviceToken: [128, "DEVICE_TOKEN"],
  wifiSsid: [32, "WIFI_SSID"],
  wifiPassword: [64, "WIFI_PASSWORD"],
  caCertificate: [16384, "CORE_CA"],
};
let header =
  "#pragma once\n/* 本地生成的私有配置，请勿提交或分享编译镜像。 */\n";
for (const [key, [max, macro]] of Object.entries(rules)) {
  const value = config[key] ?? "";
  if (
    typeof value !== "string" ||
    value.includes("\0") ||
    Buffer.byteLength(value) > max
  )
    throw Error(`配置格式或长度无效：${key}`);
  header += `#define HS_${macro} ${JSON.stringify(value)}\n`;
}
if (config.coreUrl) {
  const url = new URL(config.coreUrl);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error("Core URL 格式无效。");
  if (url.protocol === "https:" && !config.caCertificate)
    throw Error("HTTPS Core 必须配置 caCertificate，不能跳过证书验证。");
}
if (config.deviceId && !/^[a-z0-9-]{1,64}$/.test(config.deviceId))
  throw Error("deviceId 格式无效。");
if (
  config.deviceToken &&
  (config.deviceToken.length < 32 || !/^[\x21-\x7e]+$/.test(config.deviceToken))
)
  throw Error("deviceToken 格式无效。");
mkdirSync(resolve(project, "build"), { recursive: true });
writeFileSync(resolve(project, "build/hs_build_config.h"), header, {
  mode: 0o600,
});
if (process.argv.includes("--prepare-only")) {
  console.log("T5 SDK 版本与本地配置检查通过，已生成私有构建配置。");
} else {
  const python =
    process.env.HOMESTASH_TUYAOPEN_PYTHON ?? resolve(sdk, ".venv/bin/python");
  if (!existsSync(python))
    throw Error(
      "未找到 TuyaOpen Python，请先按官方说明安装 SDK 环境或设置 HOMESTASH_TUYAOPEN_PYTHON。",
    );
  const fingerprint = createHash("sha256")
    .update(readFileSync(resolve(project, "app_default.config")))
    .update(target.sdkCommit)
    .update(target.platformCommit)
    .digest("hex");
  const stamp = resolve(project, ".build/homestash-config.sha256");
  if (!existsSync(stamp) || readFileSync(stamp, "utf8") !== fingerprint) {
    for (const relative of [
      "cache/using.config",
      "cache/using.cmake",
      "include/tuya_kconfig.h",
    ])
      rmSync(resolve(project, ".build", relative), { force: true });
    mkdirSync(dirname(stamp), { recursive: true });
    writeFileSync(stamp, fingerprint);
  }
  const env = {
    ...process.env,
    HOMESTASH_TUYAOPEN_PATH: sdk,
    OPEN_SDK_ROOT: sdk,
    CMAKE_TOOLCHAIN_FILE: resolve(
      root,
      "firmware/platforms/tuyaopen/toolchain.cmake",
    ),
    OPEN_SDK_PYTHON: python,
    OPEN_COUNTRY_CODE: process.env.OPEN_COUNTRY_CODE ?? "China",
    PATH: `${dirname(python)}:${process.env.PATH}`,
  };
  function buildProject(directory) {
    const result = spawnSync(python, [resolve(sdk, "tos.py"), "build"], {
      cwd: directory,
      stdio: "inherit",
      env,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  const nativeCommands = resolve(
    sdk,
    "platform/T5AI/t5_os/build/bk7258/tuya_app/bk7258_ap/compile_commands.json",
  );
  if (!existsSync(nativeCommands)) {
    console.log(
      "首次准备 T5 原生配置，先编译独立 SDK 引导工程。此步骤不会烧录设备。",
    );
    buildProject(resolve(root, "firmware/diagnostics/tuya-t5-bsp"));
  }
  const commands = JSON.parse(readFileSync(nativeCommands, "utf8"));
  const fatfs = commands.find((entry) =>
    entry.file.endsWith("/fatfs_adapter.c"),
  );
  if (!fatfs) throw Error("原厂编译数据库缺少 FatFs 编译配置。");
  const args =
    fatfs.arguments ??
    JSON.parse(
      execFileSync(
        python,
        [
          "-c",
          "import json,shlex,sys; print(json.dumps(shlex.split(sys.argv[1])))",
          fatfs.command,
        ],
        { encoding: "utf8" },
      ),
    );
  const includeDirs = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-I") includeDirs.push(args[++i]);
    else if (args[i].startsWith("-I")) includeDirs.push(args[i].slice(2));
  }
  if (
    !includeDirs.length ||
    includeDirs.some((dir) => !dir || dir.includes("]=]"))
  )
    throw Error("T5 原生头文件配置无效。");
  writeFileSync(
    resolve(project, "build/native-includes.cmake"),
    `set(HS_T5_NATIVE_INCLUDES\n${includeDirs.map((dir) => `  [=[${dir}]=]`).join("\n")}\n)\n`,
  );
  buildProject(project);
  const binDir = resolve(project, ".build/bin");
  const generated = readFileSync(
    resolve(project, ".build/include/tuya_kconfig.h"),
    "utf8",
  );
  const name = generated.match(/^#define PROJECT_NAME "([^"\n]+)"/m)?.[1];
  const version = generated.match(/^#define PROJECT_VERSION "([^"\n]+)"/m)?.[1];
  if (!name || !version || !/^[a-zA-Z0-9._-]+$/.test(name + version))
    throw Error("T5 产物名称或版本配置无效。");
  const image = readFileSync(resolve(binDir, `${name}_UA_${version}.bin`));
  const expected = Buffer.from(`HS_TARGET_V1:${target.boardId}\0`),
    marker = Buffer.from("HS_TARGET_V1:");
  if (
    !image.includes(expected) ||
    image.indexOf(marker) !== image.lastIndexOf(marker)
  )
    throw Error("T5 应用镜像缺少唯一板型标记。");
  console.log(
    "T5 编译完成。产物位于板卡工程 .build/bin；烧录使用 TuyaOpen 工具，不能使用 ESP32 flash/restore 脚本。",
  );
}
