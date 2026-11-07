"use client";
import { useEffect, useState } from "react";
type Photo = { id: string; url: string; receivedAt: string };
export function OfflinePhotos() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [status, setStatus] = useState("");
  const load = () =>
    fetch("/api/yard/offline-photos")
      .then((r) => r.json())
      .then((d) => setPhotos(d.items))
      .catch(() => setStatus("待整理照片暂不可用"));
  useEffect(() => {
    void load();
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, []);
  async function resolve(id: string, save: boolean) {
    try {
      const r = await fetch(`/api/yard/offline-photos/${id}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ save }),
      });
      if (!r.ok) throw Error();
      await load();
      setStatus(save ? "已保存到家庭回忆" : "已放弃这张照片");
    } catch {
      setStatus("操作失败，请重试");
    }
  }
  return (
    <section
      style={{
        padding: 24,
        margin: "24px 0",
        border: "1px solid #dfd5c9",
        borderRadius: 20,
      }}
    >
      <h2>待整理照片</h2>
      <p>
        设备拍下的照片会同步到这里，也可以在设备相册中浏览。离线时会等联网后补传。确认后才成为家庭回忆，页面显示上传时间。
      </p>
      {photos.length === 0 && <p>暂时没有待整理照片</p>}
      {photos.map((v) => (
        <div key={v.id}>
          <img
            src={v.url}
            alt="设备离线拍摄，待确认"
            style={{ width: "100%", maxWidth: 480, height: "auto" }}
          />
          <p>上传于 {new Date(v.receivedAt).toLocaleString("zh-CN")}</p>
          <button
            style={{ minHeight: 44, marginRight: 12 }}
            onClick={() => resolve(v.id, true)}
          >
            保存回忆
          </button>
          <button
            style={{ minHeight: 44 }}
            onClick={() => resolve(v.id, false)}
          >
            放弃
          </button>
        </div>
      ))}
      <p role="status">{status}</p>
    </section>
  );
}
