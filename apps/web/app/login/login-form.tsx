"use client";
import Link from "next/link";
import { clearOffline, flushLogout } from "../../public/offline-storage.js";
import { useEffect, useState, type FormEvent } from "react";
import "./login.css";
export default function LoginForm({
  localLan = false,
}: {
  localLan?: boolean;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    clearOffline();
    void flushLogout()
      .then(() => fetch("/api/auth/session"))
      .then(async (response) => {
        if (
          response.status === 200 &&
          (await response.json()).enabled === false
        )
          window.location.replace("/app");
      })
      .catch(() => setError("副本已清除，请连接Core完成退出后再登录。"));
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await flushLogout();
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: values.get("username"),
          password: values.get("password"),
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw Error(data.error || "登录失败，请重试");
      }
      clearOffline();
      window.location.assign("/app");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "连接失败，请稍后重试");
      setBusy(false);
    }
  }
  return (
    <main className="internal-login">
      <section className="login-card">
        <Link href="/" className="login-brand">
          ⌂ homestash
        </Link>
        <span className="login-label">
          {localLan ? "家庭局域网访问" : "内部测试"}
        </span>
        <h1>欢迎回来</h1>
        <p>
          {localLan
            ? "使用这台HomeStash Core的家庭访问账号登录。手机与电脑需连接同一可信局域网。"
            : "此后台仅供项目内部测试。想在自己家使用？请从官网获取源码并自行部署。"}
        </p>
        <form method="post" onSubmit={submit}>
          <label htmlFor="username">用户名</label>
          <input
            id="username"
            name="username"
            autoComplete="username"
            required
            maxLength={100}
            placeholder="请输入用户名"
          />
          <label htmlFor="password">密码</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={200}
            placeholder="请输入密码"
          />
          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}
          <button disabled={busy}>
            {busy ? "正在登录…" : localLan ? "进入我的厨房" : "登录测试后台"}
          </button>
        </form>
        <Link href="/" className="login-home">
          ← 返回项目官网
        </Link>
      </section>
    </main>
  );
}
