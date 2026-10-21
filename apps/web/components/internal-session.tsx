"use client";
import { useEffect, useState } from "react";
export default function InternalSession({
  localLan = false,
}: {
  localLan?: boolean;
}) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => {
        if (r.status === 401) window.location.replace("/login");
        else if (r.status === 204) setEnabled(true);
      })
      .catch(() => {});
  }, []);
  if (!enabled) return null;
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "10px 20px",
        background: "#e9f0e8",
        color: "#254b3d",
        fontSize: 13,
      }}
    >
      <span>{localLan ? "家庭局域网访问" : "内部测试后台"}</span>
      <button
        onClick={async () => {
          await fetch("/api/auth/logout", { method: "POST" });
          window.location.replace("/login");
        }}
        style={{
          border: 0,
          background: "transparent",
          color: "inherit",
          cursor: "pointer",
        }}
      >
        退出登录
      </button>
    </div>
  );
}
