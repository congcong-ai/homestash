#!/usr/bin/env bash
set -euo pipefail
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"
for key in all_proxy ALL_PROXY http_proxy HTTP_PROXY https_proxy HTTPS_PROXY no_proxy NO_PROXY; do unset "$key"; done
case "${DEPLOY_USE_PROXY:-false}" in
 true)
  [[ "${DEPLOY_PROXY_HOST:-}" =~ ^[a-zA-Z0-9.-]+$ ]] || exit 1
  for value in "${DEPLOY_PROXY_PORT:-1080}" "${DEPLOY_HTTP_PROXY_PORT:-1087}"; do [[ "$value" =~ ^[0-9]+$ ]] && (( value > 0 && value < 65536 )) || exit 1; done
  export all_proxy="socks5://${DEPLOY_PROXY_HOST}:${DEPLOY_PROXY_PORT}" ALL_PROXY="socks5://${DEPLOY_PROXY_HOST}:${DEPLOY_PROXY_PORT}"
  export http_proxy="http://${DEPLOY_PROXY_HOST}:${DEPLOY_HTTP_PROXY_PORT}" https_proxy="http://${DEPLOY_PROXY_HOST}:${DEPLOY_HTTP_PROXY_PORT}"
  export HTTP_PROXY="$http_proxy" HTTPS_PROXY="$https_proxy" no_proxy=127.0.0.1,localhost NO_PROXY=127.0.0.1,localhost;;
 false) ;;
 *) echo '代理开关无效'; exit 1;;
esac
base=/var/www/homestash
runtime_home=/var/lib/homestash
as_app() { runuser -u homestash -- env HOME="$runtime_home" PATH="$runtime_home/bin:$PATH" "$@"; }
verify_target() {
 node - "$base/shared/.env" <<'JS'
const fs=require('node:fs'),{parseEnv}=require('node:util');
const c=parseEnv(fs.readFileSync(process.argv[2],'utf8'));
if(c.APP_ORIGIN!=='https://'+process.env.DEPLOY_DOMAIN || c.WEB_PORT!==process.env.DEPLOY_WEB_PORT || c.CORE_PORT!==process.env.DEPLOY_CORE_PORT) throw Error('生产域名或端口与部署配置不匹配');
JS
}
stop_app() {
 as_app pm2 delete homestash-core homestash-web >/dev/null 2>&1 || true
 # 只终止本站专用用户拥有的监听进程，避免误杀共享服务器其它项目。
 for port in "$DEPLOY_WEB_PORT" "$DEPLOY_CORE_PORT"; do
  for pid in $(lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true); do
   [[ "$(stat -c %U "/proc/$pid")" == homestash ]] || { echo "端口 $port 被其他用户占用，停止发布"; return 1; }
   kill -TERM "$pid"
  done
 done
 for attempt in {1..20}; do
  if ! lsof -t -iTCP:"$DEPLOY_WEB_PORT" -iTCP:"$DEPLOY_CORE_PORT" -sTCP:LISTEN >/dev/null 2>&1; then return; fi
  sleep 1
 done
 echo '旧服务未退出，停止发布'; return 1
}
