#!/usr/bin/env bash
set -euo pipefail
source_dir="${1:?缺少发布目录}"
source "$source_dir/scripts/server-common.sh"
[[ "$EUID" == 0 && -f "$base/shared/installed" ]] || { echo '需要先完成首次安装'; exit 1; }
verify_target
node "$source_dir/scripts/configure-internal-auth.mjs" "$base/shared"
chown homestash:homestash "$base/shared/.env" "$base/shared/access.txt"
exec 9>"$base/shared/deploy.lock"
flock -n 9 || { echo '已有部署运行'; exit 1; }
new="$base/releases/$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 3)"
old=""
if [[ -L "$base/current" ]]; then old="$(readlink -f "$base/current")"; fi
mkdir -p "$new"
cp -a "$source_dir/." "$new/"
ln -s "$base/shared/.env" "$new/.env"
chown -R homestash:homestash "$new"
cd "$new"
if [[ -n "$old" && -f "$old/.healthy" && -d "$old/node_modules" ]] && cmp -s "$old/pnpm-lock.yaml" pnpm-lock.yaml; then
 echo '复用已验证的 Linux 运行依赖'
 cp -al "$old/node_modules" "$new/node_modules"
 for dir in apps/web packages/* services/*; do
  [[ ! -d "$old/$dir/node_modules" ]] || cp -a "$old/$dir/node_modules" "$new/$dir/node_modules"
 done
else
 as_app pnpm install --prod --frozen-lockfile
fi
# SQLite 迁移由 Core 的版本化仓储启动流程执行；保留历史迁移不改写。
if [[ -z "$old" ]]; then
 python3 scripts/server-port-audit.py --check "$DEPLOY_WEB_PORT" "$DEPLOY_CORE_PORT" --project-nginx /etc/nginx/sites-available/homestash
fi
nginx_backup="$(mktemp /tmp/homestash-nginx.XXXXXX)"
cp /etc/nginx/sites-available/homestash "$nginx_backup"
rollback() {
 trap - ERR
 cp "$nginx_backup" /etc/nginx/sites-available/homestash
 nginx -t && systemctl reload nginx
 rm -f "$nginx_backup"
 echo "新版本失败，恢复旧版本：${old:-无}" >&2
 stop_app || true
 if [[ -n "$old" && -f "$old/.healthy" ]]; then
  ln -s "$old" "$base/current.rollback"; mv -Tf "$base/current.rollback" "$base/current"
  as_app pm2 start "$base/current/ecosystem.config.cjs" --update-env
  as_app node "$old/scripts/health-check.mjs"
 else
  rm -f "$base/current"
 fi
 as_app pm2 save --force
 exit 1
}
trap rollback ERR
stop_app
ln -s "$new" "$base/current.next"; mv -Tf "$base/current.next" "$base/current"
as_app pm2 start "$base/current/ecosystem.config.cjs" --update-env
as_app node scripts/health-check.mjs
node scripts/sync-internal-access.mjs
nginx -t
systemctl reload nginx
as_app pm2 save
systemctl is-active --quiet pm2-homestash
systemctl is-enabled --quiet pm2-homestash
# 通过真实 HTTPS 入口验收首页、鉴权边界及带密码的数据库查询，密码不进入日志或命令参数。
node --input-type=module <<'JS'
import {readFileSync} from 'node:fs';
const origin='https://'+process.env.DEPLOY_DOMAIN;
for(const path of ['/','/applications']){const r=await fetch(origin+path,{signal:AbortSignal.timeout(15000)});if(r.status!==200)throw Error('官网访问异常 '+path+' '+r.status);}
let page;
for(let attempt=0;attempt<20;attempt++){
 page=await fetch(origin+'/app',{redirect:'manual',headers:{Connection:'close'},signal:AbortSignal.timeout(5000)});
 if(page.status===302&&new URL(page.headers.get('location')??'',origin).pathname==='/login')break;
 if(attempt===19)throw Error('后台登录跳转异常：'+page.status+' '+page.headers.get('location'));
 await new Promise(resolve=>setTimeout(resolve,1000));
}
const denied=await fetch(origin+'/api/state');if(denied.status!==401||denied.headers.has('www-authenticate'))throw Error('API 保护异常');
const loginPage=await fetch(origin+'/login');if(!loginPage.ok||!(await loginPage.text()).includes('内部测试'))throw Error('登录页异常');
const text=readFileSync('/var/www/homestash/shared/access.txt','utf8');
const credentials={username:text.match(/账号：(.+)/)[1],password:text.match(/密码：(.+)/)[1]};
const login=await fetch(origin+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(credentials)});
if(!login.ok)throw Error('表单登录失败');
const cookie=login.headers.get('set-cookie')?.split(';')[0];if(!cookie)throw Error('缺少会话');
for(const path of ['/app','/api/state']){const r=await fetch(origin+path,{headers:{Cookie:cookie},signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('管理访问异常 '+r.status);if(path.includes('state')&&!Array.isArray((await r.json()).items))throw Error('数据库读取异常');}
console.log('公网 HTTPS、管理鉴权与真实库存数据库查询通过');
JS
touch "$new/.healthy"
trap - ERR
rm -f "$nginx_backup"
for candidate in "$base"/releases/*; do
 [[ -d "$candidate" && "$candidate" != "$new" ]] || continue
 [[ "$candidate" == "$old" && -f "$candidate/.healthy" ]] && continue
 rm -rf -- "$candidate"
done
echo "部署成功：$new"
