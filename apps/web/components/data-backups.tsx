"use client";
import { useRef, useState } from "react";
import { api } from "@homestash/api-client";
type Summary = {
  items: number;
  events: number;
  locations: number;
  shopping: number;
  pending: number;
};
type Preview = Summary & {
  sha256: string;
  createdAt: string;
  currentFingerprint: string;
  current: Summary;
};
type Snapshot = Summary & { id: string; createdAt: string };
export function DataBackups({ onChanged }: { onChanged: () => Promise<void> }) {
  const [file, setFile] = useState<unknown>(null),
    [preview, setPreview] = useState<Preview | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState(""),
    [snapshots, setSnapshots] = useState<Snapshot[]>([]),
    [snapshotId, setSnapshotId] = useState("");
  const request = useRef<{ key: string; id: string } | null>(null);
  async function perform(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作未完成，请重试");
    } finally {
      setBusy(false);
    }
  }
  async function validate() {
    const result = await api<Preview>("/backups/validate", file);
    setPreview(result);
    setConfirmation("");
    request.current = null;
  }
  async function restore() {
    if (!preview) return;
    const key = preview.sha256 + preview.currentFingerprint;
    if (request.current?.key !== key)
      request.current = { key, id: crypto.randomUUID() };
    const result = await api<{ snapshotId: string; message: string }>(
      "/backups/restore",
      {
        requestId: request.current.id,
        backup: file,
        currentFingerprint: preview.currentFingerprint,
        confirmation,
      },
    );
    setSnapshotId(result.snapshotId);
    setMessage(result.message);
    setPreview(null);
    setConfirmation("");
    await onChanged();
    setSnapshots(await api<Snapshot[]>("/backups/snapshots"));
  }
  return (
    <section className="panel data-backups">
      <p className="eyebrow">家的记录，自己留一份</p>
      <h2>数据备份与恢复</h2>
      <p>
        包含库存、完整历史、购物清单、待确认候选、菜谱与烹饪进度。设备凭据、AI配置、固件、原图和音频不包含在内。备份是未加密的本地文件，请妥善保管。
      </p>
      <a className="backup-download" href="/api/backups/export" download>
        下载家庭数据备份
      </a>
      <hr />
      <h3>从文件恢复</h3>
      <p>
        恢复会覆盖当前家庭业务数据。请先停止设备录音和做饭操作；校验后如有新变更，会要求重新校验。系统会在覆盖前自动保存一份恢复前快照。
      </p>
      <label>
        选择 HomeStash 备份文件
        <input
          type="file"
          accept="application/json,.json"
          disabled={busy}
          onChange={(e) => {
            const selected = e.target.files?.[0];
            setFile(null);
            setPreview(null);
            setError("");
            setMessage("");
            setSnapshotId("");
            setConfirmation("");
            request.current = null;
            if (selected)
              void perform(async () => {
                if (selected.size > 20 * 1024 * 1024)
                  throw Error("备份超过20MB，当前版本不支持网页恢复");
                setFile(JSON.parse(await selected.text()));
              });
          }}
        />
      </label>
      <button
        className="secondary"
        disabled={busy || !file}
        onClick={() => void perform(validate)}
      >
        校验并预览
      </button>
      {preview && (
        <div className="backup-preview">
          <h3>
            恢复预览 · {new Date(preview.createdAt).toLocaleString("zh-CN")}
          </h3>
          <p>
            备份：{preview.items} 批库存、{preview.events} 条记录、
            {preview.shopping} 项购物、{preview.pending} 个待确认。
          </p>
          <p>
            当前：{preview.current.items} 批库存、{preview.current.events}{" "}
            条记录。恢复后以备份为准，不进行合并。
          </p>
          <p className="muted">
            SHA-256校验已通过；校验和用于检测文件损坏，不证明文件来源可信。请只恢复自己保存的备份。
          </p>
          <label>
            输入“覆盖恢复”确认
            <input
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              disabled={busy}
              autoComplete="off"
            />
          </label>
          <button
            className="danger"
            disabled={busy || confirmation !== "覆盖恢复"}
            onClick={() => void perform(restore)}
          >
            {busy ? "正在恢复…" : "保存恢复前快照并恢复"}
          </button>
        </div>
      )}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {snapshotId && (
        <p>
          <a href={`/api/backups/snapshots/${snapshotId}`} download>
            下载本次恢复前快照
          </a>
        </p>
      )}
      <details
        onToggle={(e) => {
          if (e.currentTarget.open)
            void perform(async () =>
              setSnapshots(await api<Snapshot[]>("/backups/snapshots")),
            );
        }}
      >
        <summary>查看自动保存的恢复前快照</summary>
        <p>
          保存在Core本机的备份目录，当前不自动清理。需要回退时下载快照，再选择该文件校验恢复。
        </p>
        {!snapshots.length && <p>暂无恢复前快照。</p>}
        {snapshots.map((s) => (
          <p key={s.id}>
            <a href={`/api/backups/snapshots/${s.id}`} download>
              {new Date(s.createdAt).toLocaleString("zh-CN")} · {s.items} 批库存
              / {s.events} 条记录
            </a>
          </p>
        ))}
      </details>
    </section>
  );
}
