"use client";

import { useEffect, useState } from "react";
import styles from "./avatar-panel.module.css";

const endpoint = "/api/yard/wallpaper";

export function WallpaperPanel() {
  const [id, setId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw Error();
        const wallpaper = await response.json();
        setId(wallpaper.id);
      })
      .catch(() => {
        if (!controller.signal.aborted) setMessage("暂时无法读取当前壁纸");
      });
    return () => controller.abort();
  }, []);

  async function update(remove: boolean) {
    if (!remove && !file) return;
    setBusy(true);
    setMessage("");
    try {
      let body: string | undefined;
      if (!remove && file) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
          throw Error("请选择 JPEG、PNG 或 WebP 图片");
        if (file.size > 3 * 1024 * 1024) throw Error("请选择 3 MB 以内的图片");
        const image = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(Error("无法读取图片"));
          reader.readAsDataURL(file);
        });
        body = JSON.stringify({ image });
      }
      const response = await fetch(endpoint, {
        method: remove ? "DELETE" : "PUT",
        ...(body
          ? { headers: { "content-type": "application/json" }, body }
          : {}),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.detail || "保存失败，请重试");
      setId(result.id);
      setMessage(
        remove ? "已恢复默认待机画面" : "已保存，板子联网空闲时会同步",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.wallpaper}>
      <h3>待机壁纸</h3>
      <p>选一张照片，小冰会在空闲时显示。照片将居中裁成横屏比例。</p>
      {id && (
        <img
          src={`${endpoint}/${id}`}
          width={480}
          height={320}
          alt="当前待机壁纸"
        />
      )}
      <label>
        选择照片
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </label>
      <div className={styles.themes}>
        <button disabled={!file || busy} onClick={() => update(false)}>
          设为待机壁纸
        </button>
        {id && (
          <button disabled={busy} onClick={() => update(true)}>
            恢复默认
          </button>
        )}
      </div>
      <p role="status">{busy ? "正在保存…" : message}</p>
    </div>
  );
}
