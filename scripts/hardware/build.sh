#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IFS=$'\t' read -r HS_TARGET_PROJECT HS_TARGET_BOARD HS_TARGET_IDF_COMMIT HS_TARGET_PREPARE_BLE <<< "$(node "$ROOT/scripts/hardware/resolve-target.mjs" "$@")"
[[ -n "$HS_TARGET_PROJECT" && -n "$HS_TARGET_IDF_COMMIT" ]] || exit 1
export HOMESTASH_FIRMWARE_PROJECT="$HS_TARGET_PROJECT"
SDK="${HOMESTASH_IDF_PATH:-$HOME/esp/esp-idf-smartbadge}"
if [[ "$(git -C "$SDK" rev-parse HEAD)" != "$HS_TARGET_IDF_COMMIT" ]]; then
  echo "SDK 提交与审计版本不一致，请先重新核验。" >&2; exit 1
fi
node "$ROOT/scripts/hardware/configure.mjs"
if [[ "$HS_TARGET_PREPARE_BLE" == "1" ]]; then
  "${HOMESTASH_IDF_PYTHON_BIN:-$HOME/.espressif/python_env/idf6.2_py3.12_env/bin}/python" "$ROOT/scripts/hardware/prepare-ble.py"
fi
export IDF_SKIP_CHECK_SUBMODULES=1
export PATH="${HOMESTASH_IDF_PYTHON_BIN:-$HOME/.espressif/python_env/idf6.2_py3.12_env/bin}:$PATH"
# export.sh 仅加载共享 SDK，构建目录始终属于 HomeStash。
source "$SDK/export.sh" >/dev/null
cd "$HS_TARGET_PROJECT"
# 显式重新配置，确保版本环境变量变化不会沿用旧 CMake 缓存。
idf.py reconfigure
idf.py -j 4 build

# 每个镜像必须声明与构建目标一致的板型；不把同芯片视为同一块板。
node --input-type=module - "$HS_TARGET_PROJECT/build/homestash_freshmate.bin" "$HS_TARGET_BOARD" <<'JS'
import { readFileSync } from "node:fs";
const image=readFileSync(process.argv[2]), marker=Buffer.from("HS_TARGET_V1:"), expected=Buffer.from(`HS_TARGET_V1:${process.argv[3]}\0`);
if(image.indexOf(expected)<0 || image.indexOf(marker)!==image.lastIndexOf(marker)) throw Error("固件板型标记与所选目标不符");
console.log("固件板型标记检查通过。");
JS
