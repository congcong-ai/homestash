# 生产部署

官网为 https://homestash.bebackpacker.com，仅作开源项目介绍，用户需要获取源码并自行部署。线上后台仅供项目内部测试，不是 SaaS 服务。部署参考 FDE，使用 SSH 传输和系统原生服务，不依赖 GitHub 写操作。

## 首次安装

1. 本机准备 Node.js 22+、pnpm 9.15.9、SSH、rsync 和 tar。服务器需为 Ubuntu/Debian，部署用户具备免密 sudo，域名 A 记录指向服务器，80/443 可达。
2. 复制 `.deploy.env.example` 为 `.deploy.env`，填写 SSH 和 TLS 邮箱；本次使用 FDE 国内服务器及其已有兼容组件，不升级共享组件。
3. 审计端口：`ssh deployer@服务器 'sudo -n python3 - --choose' < scripts/server-port-audit.py`。确认建议后填写 `DEPLOY_WEB_PORT` 和 `DEPLOY_CORE_PORT`。本次确认值为 3022、3023。安装器在写配置前再次检查，并打印实时建议；不自动采用未经确认的新端口。
4. 执行 `pnpm server:install --check`，再执行 `pnpm server:install`。安装完成标记存在时直接跳过，不构建或上传。
5. 按需编辑 `/var/www/homestash/shared/.env`。默认 Mock 模式、空库存和禁用硬件接口，不导入本地家庭数据或模型密钥。
6. 执行 `pnpm server:deploy` 完成首次发布。

安装器仅安装缺失的软件包，先模拟 APT 计划；若涉及已有包升级或删除则停止。为本站单独安装 pnpm 与 PM2 至 `/var/lib/homestash/tooling`，不改其它项目的全局版本。

## 日常部署

执行 `pnpm server:deploy`。脚本在临时副本执行 frozen install、lint、类型检查、测试、Next.js 和 Core 编译；以显式白名单组装产物并生成 SHA-256，服务器验证后解压。发布包不含密钥、数据、固件、Git 或 macOS 依赖。

服务器以 `flock` 串行发布；锁文件未变化且上一版健康时复用其 Linux 依赖，否则仅安装 production dependencies。Core 已编译，SQLite 版本化迁移文件随包发送，仓储初始化时执行尚未执行的迁移。禁止改写已执行的历史迁移。

先停止本站进程并清理本站用户占用的端口，再原子切换 `current`，通过 PM2 启动 Web/Core。只杀本站用户的监听进程，遇到其他用户占用则停止。检查本机首页、Core、真实 SQLite 库存查询，以及公网 HTTPS、未登录跳转、API 未登录 401 和表单登录后的访问。失败回滚代码；数据库不自动回滚，迁移必须向后兼容。成功后保留当前版与上一个健康版，共两个目录。

## 访问保护和配置

首页、应用介绍及静态资源公开；官网无在线后台入口。内部人员通过 `/login` 输入用户名和密码，登录后进入 `/app`；未登录访问后台会跳转登录页。Core 校验 API 会话；Nginx 使用内部认证子请求保护后台页面，不使用 HTTP Basic。Web/Core 仅监听本机，不应绕过 Nginx 暴露端口。

会话采用签名、12 小时有效期、HttpOnly、SameSite=Lax 和生产环境 Secure Cookie；错误登录有尝试次数限制。登录页面不预填密码，后台可退出登录。仅单个内部测试账号，无注册或多人数据隔离。自行部署者使用自己的实例；本地开发默认关闭该登录。

- 应用配置：`/var/www/homestash/shared/.env`。
- 内部登录凭据：`/var/www/homestash/shared/access.txt`，仅 root 和本站用户可读。
- 数据库：`/var/www/homestash/shared/homestash.db`。
- 日志：`/var/www/homestash/shared/logs/`。
- PM2 用户：`homestash`，HOME 为 `/var/lib/homestash`。

生产 `.env` 中 `INTERNAL_LOGIN_ENABLED=true`，`INTERNAL_LOGIN_USERNAME` 保存内部用户名，`INTERNAL_LOGIN_PASSWORD_HASH` 保存带盐 scrypt 散列，`INTERNAL_SESSION_SECRET` 用于会话签名。首次安装生成独立随机密码，日常部署保留既有凭据。要修改用户名和密码，在服务器交互读取新密码后，调用配置工具：

```sh
read -r -s -p '新密码：' HOMESTASH_SETUP_PASSWORD
export HOMESTASH_SETUP_PASSWORD
export HOMESTASH_SETUP_USERNAME=demo
sudo --preserve-env=HOMESTASH_SETUP_PASSWORD,HOMESTASH_SETUP_USERNAME node /var/www/homestash/current/scripts/configure-internal-auth.mjs
unset HOMESTASH_SETUP_PASSWORD HOMESTASH_SETUP_USERNAME
```

随后执行日常部署使其生效。工具同时更新散列、轮换签名密钥和同步 `access.txt`，密码不进入命令参数或日志。既有 Basic 密码文件不再参与认证。

部署代理从本机 `.deploy.env` 的 `DEPLOY_USE_PROXY` 等项读取，默认关闭；启用时仅用于安装与依赖进程，应用启动包装会清理代理环境。

## 验收与备份

```sh
curl -I https://homestash.bebackpacker.com/              # 200
curl -I https://homestash.bebackpacker.com/login         # 200，普通登录页面
curl -I https://homestash.bebackpacker.com/app           # 302 → /login
curl -I https://homestash.bebackpacker.com/api/state     # 401
登录后通过浏览器查看库存；脚本部署会验证登录和带会话的真实库存读取。
sudo nginx -t
sudo systemctl is-active pm2-homestash
sudo systemctl is-enabled pm2-homestash
sudo -u homestash env HOME=/var/lib/homestash /var/lib/homestash/bin/pm2 status
sudo -u homestash env HOME=/var/lib/homestash node /var/www/homestash/current/scripts/health-check.mjs
```

备份前停止 Core，再复制完整数据库并恢复进程：

```sh
sudo -u homestash env HOME=/var/lib/homestash /var/lib/homestash/bin/pm2 stop homestash-core
sudo install -d -m 0700 /var/backups/homestash
sudo cp /var/www/homestash/shared/homestash.db /var/backups/homestash/homestash-$(date +%Y%m%dT%H%M%S).db
sudo -u homestash env HOME=/var/lib/homestash /var/lib/homestash/bin/pm2 restart homestash-core
```

不要在 Core 运行中只复制 `.db` 而遗漏 WAL。恢复数据库前先停 Core，保留当前文件备份，替换后重新检查库存。TLS 续期由系统 certbot 定时任务负责，可用 `sudo certbot renew --dry-run` 人工验证。
