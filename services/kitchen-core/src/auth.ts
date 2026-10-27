import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import type { FastifyInstance } from "fastify";
const cookieName = "homestash_session";
const lifetime = 12 * 60 * 60;
export function passwordHash(
  password: string,
  salt = randomBytes(16).toString("hex"),
) {
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function registerInternalAuth(app: FastifyInstance) {
  if (process.env.INTERNAL_LOGIN_ENABLED !== "true") {
    app.get("/api/auth/session", async (_req, reply) =>
      reply.header("Cache-Control", "no-store").send({ enabled: false }),
    );
    app.post("/api/auth/logout", async (_req, reply) =>
      reply
        .header("Cache-Control", "no-store")
        .header(
          "Set-Cookie",
          `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
        )
        .send({ ok: true }),
    );
    return (cookies?: string) => {
      void cookies;
      return { scope: "local", expiresAt: Date.now() + lifetime * 1000 };
    };
  }
  const username = process.env.INTERNAL_LOGIN_USERNAME;
  const hash = process.env.INTERNAL_LOGIN_PASSWORD_HASH;
  const secret = process.env.INTERNAL_SESSION_SECRET;
  if (!username || !hash || !secret || secret.length < 32)
    throw Error("内部测试登录配置不完整");
  const signature = (value: string) =>
    createHmac("sha256", secret).update(value).digest("hex");
  const equal = (a: string, b: string) => {
    const left = Buffer.from(a),
      right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
  };
  const valid = (cookies = "") => {
    const token = cookies
      .split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1);
    if (!token) return false;
    const [expires, nonce, signed, ...extra] = token.split(".");
    return (
      extra.length === 0 &&
      /^\d+$/.test(expires ?? "") &&
      /^[a-f0-9]{32}$/.test(nonce ?? "") &&
      /^[a-f0-9]{64}$/.test(signed ?? "") &&
      +expires > Date.now() &&
      +expires <= Date.now() + lifetime * 1000 &&
      equal(signature(`${expires}.${nonce}`), signed)
    );
  };
  const cookie = (value: string, age: number) =>
    `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
  const attempts = new Map<string, { count: number; reset: number }>();
  app.addHook("onRequest", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const path = req.url.split("?")[0];
    if (["/api/auth/login", "/api/auth/session", "/api/health"].includes(path))
      return;
    if (!valid(req.headers.cookie))
      return reply.code(401).send({ error: "请先登录" });
  });
  app.get("/api/auth/session", async (req, reply) =>
    reply.code(valid(req.headers.cookie) ? 204 : 401).send(),
  );
  app.post("/api/auth/login", async (req, reply) => {
    for (const [key, item] of attempts)
      if (item.reset <= Date.now()) attempts.delete(key);
    const attempt = attempts.get(req.ip);
    if (attempt && attempt.count >= 10)
      return reply
        .code(429)
        .header("Retry-After", Math.ceil((attempt.reset - Date.now()) / 1000))
        .send({ error: "尝试次数过多，请稍后再试" });
    const body = req.body as { username?: unknown; password?: unknown } | null;
    const [salt, expected] = hash.split(":");
    const accepted =
      typeof body?.username === "string" &&
      typeof body.password === "string" &&
      body.password.length <= 200 &&
      equal(passwordHash(body.password, salt), `${salt}:${expected}`) &&
      equal(body.username, username);
    if (!accepted) {
      attempts.set(req.ip, {
        count: (attempt?.count ?? 0) + 1,
        reset: attempt?.reset ?? Date.now() + 15 * 60 * 1000,
      });
      return reply.code(401).send({ error: "用户名或密码不正确" });
    }
    attempts.delete(req.ip);
    const value = `${Date.now() + lifetime * 1000}.${randomBytes(16).toString("hex")}`;
    return reply
      .header("Set-Cookie", cookie(`${value}.${signature(value)}`, lifetime))
      .send({ ok: true });
  });
  app.post("/api/auth/logout", async (_req, reply) =>
    reply.header("Set-Cookie", cookie("", 0)).send({ ok: true }),
  );
  return (cookies = "") => {
    const token =
      cookies
        .split(";")
        .map((value) => value.trim())
        .find((value) => value.startsWith(cookieName + "="))
        ?.slice(cookieName.length + 1) ?? "";
    return {
      scope: signature(`offline:${token}`),
      expiresAt: Number(token.split(".")[0]) || Date.now(),
    };
  };
}
