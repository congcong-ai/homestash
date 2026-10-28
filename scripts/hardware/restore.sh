#!/usr/bin/env bash
# 使用项目已安装的 ESP-IDF Python，整片恢复保存的 HomeStash 固件。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PYTHON="${HOMESTASH_IDF_PYTHON_BIN:-$HOME/.espressif/python_env/idf6.2_py3.12_env/bin}/python"
if [[ ! -x "$PYTHON" ]]; then
  echo "未找到 ESP-IDF Python：$PYTHON；请设置 HOMESTASH_IDF_PYTHON_BIN 为 Python 所在目录。" >&2
  exit 1
fi
exec "$PYTHON" "$ROOT/scripts/hardware/restore.py" "$@"
