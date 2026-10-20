import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import {
  passwordHash,
  registerInternalAuth,
} from "../services/kitchen-core/src/auth";
test("内部测试表单登录：错误密码、签名会话、篡改拒绝、退出与尝试限制", async () => {
  const keys = [
    "INTERNAL_LOGIN_ENABLED",
    "INTERNAL_LOGIN_USERNAME",
    "INTERNAL_LOGIN_PASSWORD_HASH",
    "INTERNAL_SESSION_SECRET",
    "NODE_ENV",
  ];
  const previous = keys.map((k) => process.env[k]);
  Object.assign(process.env, {
    INTERNAL_LOGIN_ENABLED: "true",
    INTERNAL_LOGIN_USERNAME: "demo",
    INTERNAL_LOGIN_PASSWORD_HASH: passwordHash("610230"),
    INTERNAL_SESSION_SECRET: "a".repeat(64),
    NODE_ENV: "production",
  });
  const app = Fastify();
  registerInternalAuth(app);
  app.get("/api/state", async () => ({ items: [] }));
  try {
    const anonymous = await app.inject("/api/state");
    assert.equal(anonymous.statusCode, 401);
    assert.equal(anonymous.headers["www-authenticate"], undefined);
    const login = (password: string) =>
      app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { username: "demo", password },
      });
    assert.equal((await login("错误密码")).statusCode, 401);
    const result = await login("610230");
    assert.equal(result.statusCode, 200);
    const setCookie = String(result.headers["set-cookie"]);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /Secure/);
    assert.match(setCookie, /SameSite=Lax/);
    const cookie = setCookie.split(";")[0];
    assert.equal(
      (await app.inject({ url: "/api/state", headers: { cookie } })).statusCode,
      200,
    );
    assert.equal(
      (await app.inject({ url: "/api/auth/session", headers: { cookie } }))
        .statusCode,
      204,
    );
    assert.equal(
      (
        await app.inject({
          url: "/api/state",
          headers: { cookie: cookie.slice(0, -1) + "x" },
        })
      ).statusCode,
      401,
    );
    const logout = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie },
    });
    assert.equal(logout.statusCode, 200);
    assert.match(String(logout.headers["set-cookie"]), /Max-Age=0/);
    for (let i = 0; i < 10; i++)
      assert.equal((await login("错误密码")).statusCode, 401);
    assert.equal((await login("610230")).statusCode, 429);
  } finally {
    await app.close();
    keys.forEach((k, i) => {
      if (previous[i] === undefined) delete process.env[k];
      else process.env[k] = previous[i];
    });
  }
});
