"use client";
import { useEffect, useState } from "react";
import {
  clearOffline,
  enableOffline,
  offlineEnabled,
  readSnapshot,
  saveSnapshot,
} from "../public/offline-storage.js";
import { offlineSnapshot } from "../lib/offline-snapshot";
export function OfflineControl({
  state,
}: {
  state: Parameters<typeof offlineSnapshot>[0];
}) {
  const [secure, setSecure] = useState(false);
  const [enabled, setEnabled] = useState(false),
    [saved, setSaved] = useState<number | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    setSecure(window.isSecureContext);
    const update = () => {
      setEnabled(offlineEnabled());
      setSaved(readSnapshot()?.savedAt ?? null);
    };
    update();
    window.addEventListener("storage", update);
    window.addEventListener("homestash:offline-changed", update);
    return () => {
      window.removeEventListener("storage", update);
      window.removeEventListener("homestash:offline-changed", update);
    };
  }, []);
  return (
    <section className="panel" aria-label="离线只读副本">
      <h2>断线时也能查一查</h2>
      <p>
        主动开启后，当前浏览器会保留库存、采购与食谱的只读副本。最多12小时，登录会话更早到期时也会失效。公共设备上请勿开启。
      </p>
      <p>
        {enabled
          ? saved
            ? `最后同步：${new Date(saved).toLocaleString("zh-CN", { timeZone: state.calendar.timeZone })}`
            : "已开启，当前副本不可用，请在线重新同步。"
          : "尚未开启离线副本。"}
      </p>
      <div className="row">
        <button
          className="secondary"
          onClick={() => {
            try {
              enableOffline();
              if (!saveSnapshot(offlineSnapshot(state)))
                throw Error(
                  "无法保存副本，可能超出浏览器存储空间，请重连后再试。",
                );
              setError("");
            } catch (e) {
              setError(e instanceof Error ? e.message : "无法保存副本");
            }
          }}
        >
          {enabled ? "立即同步只读副本" : "在此浏览器保留离线副本"}
        </button>
        <button
          className="secondary"
          disabled={!enabled}
          onClick={() => {
            clearOffline();
            setError("");
          }}
        >
          清除此浏览器副本
        </button>
        <a href="/offline.html" target="_blank" rel="noreferrer">
          查看只读副本
        </a>
      </div>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      <p className="muted">
        {secure
          ? "当前安全上下文支持离线页面缓存；首次开启后请等待页面缓存完成。"
          : "当前HTTP局域网连接不支持离线页面缓存；Core断线但网页服务仍在线时可查询，整个网页服务停机后不能保证刷新打开。"}
      </p>
      <small>
        不缓存登录口令、AI配置、设备凭据或原始图片。重连后使用最新数据，离线期间不会排队提交修改。浏览器副本不替代家庭数据备份。
      </small>
    </section>
  );
}
export function OfflineFallback() {
  return (
    <main>
      <h1>暂时连接不上Core</h1>
      <p>当前只读，重连后会更新并要求重新核对。</p>
      <iframe
        title="离线只读查询"
        src="/offline.html"
        style={{ width: "100%", minHeight: "85vh", border: 0 }}
      />
    </main>
  );
}
