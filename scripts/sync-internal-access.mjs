import { readFileSync, writeFileSync } from "node:fs";
const path = process.argv[2] ?? "/etc/nginx/sites-available/homestash";
let source = readFileSync(path, "utf8");
if (!source.startsWith("# 由 HomeStash 安装器管理"))
  throw Error("Nginx 配置归属未知");
source = source.replace(/^\s*auth_basic(?:_user_file)?[^\n]*\n/gm, "");
for (const location of ["location = /app {", "location ^~ /app/ {"]) {
  const start = source.indexOf(location);
  if (start < 0) throw Error("缺少管理页面路由");
  const end = source.indexOf("}", start);
  if (!source.slice(start, end).includes("auth_request"))
    source =
      source.slice(0, start) +
      source
        .slice(start)
        .replace(
          location,
          location +
            "\n        auth_request /_homestash_session;\n        error_page 401 = @homestash_login;",
        );
}
if (!source.includes("location = /_homestash_session")) {
  const core = source.match(
    /location \^~ \/api\/\s*\{[^}]*proxy_pass http:\/\/127\.0\.0\.1:(\d+)/,
  )?.[1];
  if (!core) throw Error("缺少 Core 代理端口");
  source = source.replace(
    "    location / {",
    `    location = /_homestash_session {\n        internal;\n        proxy_pass http://127.0.0.1:${core}/api/auth/session;\n        proxy_pass_request_body off;\n        proxy_set_header Content-Length "";\n        proxy_set_header Cookie $http_cookie;\n    }\n    location @homestash_login { return 302 /login; }\n    location / {`,
  );
}
writeFileSync(path, source);
