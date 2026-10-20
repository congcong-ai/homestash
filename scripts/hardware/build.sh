#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SDK="${HOMESTASH_IDF_PATH:-$HOME/esp/esp-idf-smartbadge}"
if [[ "$(git -C "$SDK" rev-parse HEAD)" != "ab95e70748f2eddac6f87217b0cf62533684a6ba" ]]; then
  echo "SDK 提交与审计版本不一致，请先重新核验。" >&2; exit 1
fi
node "$ROOT/scripts/hardware/configure.mjs"
"${HOMESTASH_IDF_PYTHON_BIN:-$HOME/.espressif/python_env/idf6.2_py3.12_env/bin}/python" "$ROOT/scripts/hardware/prepare-ble.py"
export IDF_SKIP_CHECK_SUBMODULES=1
export PATH="${HOMESTASH_IDF_PYTHON_BIN:-$HOME/.espressif/python_env/idf6.2_py3.12_env/bin}:$PATH"
# export.sh 仅加载共享 SDK，构建目录始终属于 HomeStash。
source "$SDK/export.sh" >/dev/null
cd "$ROOT/firmware/freshmate-korvo"
# 显式重新配置，确保版本环境变量变化不会沿用旧 CMake 缓存。
idf.py reconfigure
idf.py -j 4 build
