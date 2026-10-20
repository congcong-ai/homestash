import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
const c = parseEnv(readFileSync("/var/www/homestash/shared/.env", "utf8"));
const expected = process.argv[2];
const access = readFileSync("/var/www/homestash/shared/access.txt", "utf8");
const credentials = {
  username: access.match(/账号：(.+)/)[1],
  password: access.match(/密码：(.+)/)[1],
};
let cookie = "";
for (let i = 0; i < 60; i++) {
  try {
    if (c.INTERNAL_LOGIN_ENABLED === "true" && !cookie) {
      const login = await fetch(
        `http://127.0.0.1:${c.CORE_PORT}/api/auth/login`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(credentials),
          signal: AbortSignal.timeout(3000),
        },
      );
      if (!login.ok) throw Error("内部登录验收失败");
      cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
    }
    for (const path of ["/api/health", "/api/state"]) {
      const r = await fetch(`http://127.0.0.1:${c.CORE_PORT}${path}`, {
        signal: AbortSignal.timeout(3000),
        headers: { Cookie: cookie },
      });
      if (!r.ok) throw Error(`Core ${r.status}`);
      const data = await r.json();
      if (path.endsWith("state") && !Array.isArray(data.items))
        throw Error("库存数据库响应异常");
    }
    const r = await fetch(`http://127.0.0.1:${c.WEB_PORT}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok || !(await r.text()).includes("HomeStash"))
      throw Error("首页异常");
    console.log(
      `本机 Web、Core 与 SQLite 查询通过${expected ? "：" + expected : ""}`,
    );
    process.exit(0);
  } catch (e) {
    if (i === 59) throw e;
    await new Promise((r) => setTimeout(r, 1000));
  }
}
