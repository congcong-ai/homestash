#!/usr/bin/env bash
set -euo pipefail
release="${1:?缺少安装目录}"
source "$release/scripts/server-common.sh"
[[ "$EUID" == 0 ]] || exit 1
[[ ! -f "$base/shared/.env" ]] || verify_target
[[ ! -f "$base/shared/installed" ]] || { echo '首次安装已完成'; exit 0; }
mkdir -p "$base/shared"
exec 9>"$base/shared/deploy.lock"
flock -n 9 || { echo '安装或部署正在执行'; exit 1; }
apt-get check
packages=()
for pair in nginx:nginx certbot:certbot lsof:lsof ss:iproute2 python3:python3 make:build-essential g++:build-essential; do command -v "${pair%%:*}" >/dev/null || packages+=("${pair#*:}"); done
if ! dpkg-query -W -f='${Status}' python3-certbot-nginx 2>/dev/null | grep -q 'install ok installed'; then packages+=(python3-certbot-nginx); fi
if ((${#packages[@]})); then
 plan="$(apt-get -s install --no-upgrade "${packages[@]}")"
 if grep -Eq '^Remv|^Inst [^ ]+ \[' <<< "$plan"; then printf '%s\n' "$plan"; echo '依赖安装涉及已有包升级或删除，停止'; exit 1; fi
 apt-get install -y --no-upgrade "${packages[@]}"
fi
node -e 'if(+process.versions.node.split(".")[0]<22)process.exit(1)' || { echo '需要 Node.js 22+'; exit 1; }
id homestash >/dev/null 2>&1 || useradd --system --create-home --home-dir "$runtime_home" --shell /usr/sbin/nologin homestash
install -d -o homestash -g homestash -m 0750 "$base" "$base/releases" "$base/shared" "$base/shared/logs" "$base/shared/storage" "$runtime_home/bin"
if [[ ! -x "$runtime_home/bin/pm2" || ! -x "$runtime_home/bin/pnpm" ]]; then
 npm install --prefix "$runtime_home/tooling" pnpm@9.15.9 pm2@6.0.14
 ln -sfn "$runtime_home/tooling/node_modules/.bin/pnpm" "$runtime_home/bin/pnpm"
 ln -sfn "$runtime_home/tooling/node_modules/.bin/pm2" "$runtime_home/bin/pm2"
 chown -R homestash:homestash "$runtime_home"
fi
if [[ ! -f "$base/shared/.env" ]]; then
 python3 "$release/scripts/server-port-audit.py" --choose
 python3 "$release/scripts/server-port-audit.py" --check "$DEPLOY_WEB_PORT" "$DEPLOY_CORE_PORT"
 python3 - "$base/shared" <<'PY'
from pathlib import Path
import os
p=Path(os.sys.argv[1])
values={'NODE_ENV':'production','APP_ORIGIN':'https://'+os.environ['DEPLOY_DOMAIN'],'WEB_PORT':os.environ['DEPLOY_WEB_PORT'],'CORE_PORT':os.environ['DEPLOY_CORE_PORT'],'CORE_INTERNAL_URL':'http://127.0.0.1:'+os.environ['DEPLOY_CORE_PORT'],'DATABASE_PATH':str(p/'homestash.db'),'STORAGE_DRIVER':'local','LOCAL_STORAGE_ROOT':str(p/'storage'),'AI_PROVIDER':'mock','AI_API_KEY':'','AI_BASE_URL':'http://127.0.0.1:11434/v1','AI_MODEL':'','DEVICE_TOKEN':''}
(p/'.env').write_text('\n'.join(k+'='+v for k,v in values.items())+'\n');(p/'.env').chmod(0o600)
(p/'install.env').write_text('\n'.join(k+'='+os.environ[k] for k in ['DEPLOY_DOMAIN','DEPLOY_WEB_PORT','DEPLOY_CORE_PORT'])+'\n')
PY
 chown homestash:homestash "$base/shared/.env" "$base/shared/install.env"
fi
node "$release/scripts/configure-internal-auth.mjs" "$base/shared"
chown homestash:homestash "$base/shared/.env" "$base/shared/access.txt"
config=/etc/nginx/sites-available/homestash
if [[ -e "$config" ]] && ! grep -q '^# 由 HomeStash 安装器管理' "$config"; then echo '同名 Nginx 配置归属未知，停止'; exit 1; fi
# 凭据由 Core 读取，Nginx 不再直接读取任何密码文件。
python3 - "$release/docs/nginx.conf.template" "$config" <<'PY'
from pathlib import Path
import os,sys
s=Path(sys.argv[1]).read_text()
for k in ['DOMAIN','WEB_PORT','CORE_PORT']: s=s.replace('__'+k+'__',os.environ['DEPLOY_'+k])
Path(sys.argv[2]).write_text(s)
PY
ln -sfn "$config" /etc/nginx/sites-enabled/homestash
nginx -t
systemctl reload nginx
certbot --nginx --non-interactive --agree-tos --redirect -d "$DEPLOY_DOMAIN" -m "$DEPLOY_TLS_EMAIL"
as_app pm2 save --force
PATH="$runtime_home/bin:$PATH" "$runtime_home/bin/pm2" startup systemd -u homestash --hp "$runtime_home"
as_app pm2 kill
systemctl enable --now pm2-homestash
systemctl is-active --quiet pm2-homestash
systemctl is-enabled --quiet pm2-homestash
touch "$base/shared/installed"
echo '首次安装完成。应用配置：/var/www/homestash/shared/.env；管理凭据：/var/www/homestash/shared/access.txt。编辑应用配置后执行 pnpm server:deploy。'
