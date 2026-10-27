"use client";
import {
  beginLogout,
  clearOffline,
  pendingLogout,
  flushLogout,
} from "../public/offline-storage.js";
import { useEffect, useState } from "react";
export default function InternalSession({
  localLan = false,
}: {
  localLan?: boolean;
}) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const expired = () => {
      clearOffline();
      window.location.replace("/login");
    };
    const onStorage = () => {
      if (pendingLogout()) window.location.replace("/login");
    };
    window.addEventListener("homestash:auth-required", expired);
    window.addEventListener("storage", onStorage);
    if (pendingLogout()) {
      void flushLogout()
        .catch(() => {})
        .finally(() => window.location.replace("/login"));
      return () => {
        window.removeEventListener("homestash:auth-required", expired);
        window.removeEventListener("storage", onStorage);
      };
    }
    fetch("/api/auth/session")
      .then((r) => {
        if (r.status === 401) expired();
        else if (r.status === 204) setEnabled(true);
      })
      .catch(() => {});
    return () => {
      window.removeEventListener("homestash:auth-required", expired);
      window.removeEventListener("storage", onStorage);
    };
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
          beginLogout();
          try {
            await flushLogout(true);
          } catch {
            /* 重连后先完成退出 */
          }
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
