"use client";
import { useEffect, useState } from "react";
import { api } from "@homestash/api-client";
type Release = {
  version: string;
  project: string;
  size: number;
  sha256: string;
};
export function DeviceMaintenance({
  version,
  partition,
}: {
  version?: string;
  partition?: string;
}) {
  const [release, setRelease] = useState<Release | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    void api<Release | null>("/firmware")
      .then(setRelease)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "无法读取固件信息"),
      );
  }, []);
  async function publish(file: File) {
    setBusy(true);
    setError("");
    try {
      if (
        !file.name.toLowerCase().endsWith(".bin") ||
        file.size > 4 * 1024 * 1024
      )
        throw Error("请选择不超过4 MB的应用 .bin 文件");
      const response = await fetch("/api/firmware", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? "固件发布失败");
      setRelease(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "固件发布失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <h2>设备连接与更新</h2>
      <p>
        在冰箱贴屏幕右上角打开“设置”，选择 Wi-Fi，或修改 Core
        地址和设备凭据。Wi-Fi 密码不会回传到网页。
      </p>
      <p>
        当前设备固件：{version ?? "等待新版固件上报"}
        {partition ? ` · ${partition}` : ""}
      </p>
      <h3>发布可安装固件</h3>
      <p className="muted">
        选择 HomeStash 的 Korvo 应用固件，发布到本机 Core；然后在设备“设置 →
        更新”中检查并确认安装。发布不会强制重启设备。
      </p>
      <label>
        选择固件文件
        <input
          aria-label="选择固件文件"
          type="file"
          accept=".bin"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void publish(file);
            e.target.value = "";
          }}
        />
      </label>
      {busy && <p role="status">正在校验并发布…</p>}
      {error && <p role="alert">{error}</p>}
      {release && (
        <div className="actual-screen">
          <p>
            已发布 {release.version} · {(release.size / 1024 / 1024).toFixed(2)}{" "}
            MB
          </p>
          <small>SHA-256：{release.sha256}</small>
        </div>
      )}
      <small>
        仅上传当前项目的应用镜像；不要上传整片备份或引导程序。首次支持 OTA
        的基础固件仍需要 UART 安装。
      </small>
    </section>
  );
}
