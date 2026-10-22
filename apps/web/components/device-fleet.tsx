"use client";
import { useState, type FormEvent } from "react";
import { api } from "@homestash/api-client";
import { KORVO_BOARD_ID, type ManagedDevice } from "@homestash/protocol";
const capabilityNames: Record<string, string> = {
  audio_input: "录音",
  audio_output: "播报",
  camera: "拍照",
  display: "屏幕",
  touch: "触摸",
  buttons: "按键",
  wifi: "Wi-Fi",
  ble_provisioning: "蓝牙配网",
  ota: "固件更新",
  persistent_storage: "离线存储",
  timer_sleep: "定时唤醒",
};
export function DeviceFleet({
  devices,
  timeZone = "UTC",
  onChanged,
}: {
  devices: ManagedDevice[];
  timeZone?: string;
  onChanged: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [credential, setCredential] = useState<{
    id: string;
    token: string;
  } | null>(null);
  const refresh = onChanged;
  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form);
    setBusy(true);
    setError("");
    setCredential(null);
    try {
      const result = await api<{ device: ManagedDevice; token: string }>(
        "/devices",
        {
          id: data.get("id"),
          name: data.get("name"),
          boardId: data.get("boardId"),
        },
      );
      setCredential({ id: result.device.id, token: result.token });
      form.reset();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    if (!window.confirm("停用后，该设备的凭据将立即失效。确认停用？")) return;
    setBusy(true);
    setError("");
    try {
      await api(`/devices/${id}/revoke`, {});
      if (credential?.id === id) setCredential(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function rotate(id: string) {
    if (
      !window.confirm(
        "原凭据将立即失效，设备需要填入新凭据才能重新连接。继续？",
      )
    )
      return;
    setBusy(true);
    setError("");
    setCredential(null);
    try {
      const result = await api<{ device: ManagedDevice; token: string }>(
        `/devices/${id}/rotate-token`,
        {},
      );
      setCredential({ id, token: result.token });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <h2>我的设备</h2>
      <p className="muted">
        每台设备独立登记和认证，共享家中库存。板型和能力由各自固件适配。
      </p>
      {error && <p role="alert">{error}</p>}
      {devices.length === 0 && <p>还没有登记设备。</p>}
      {devices.map((d) => (
        <article className="card" key={d.id}>
          <div className="row">
            <h3>{d.name}</h3>
            <span>{!d.enabled ? "已停用" : d.online ? "在线" : "离线"}</span>
          </div>
          <small>
            {d.id} · {d.boardId} · 固件 {d.report.firmwareVersion ?? "未上报"}
          </small>
          <p>
            {d.report.hardware?.capabilities
              .map((c) => capabilityNames[c])
              .join(" · ") || "此固件尚未上报能力，不能据此判定硬件不支持。"}
          </p>
          {d.report.screen && (
            <div className="actual-screen">
              <small>设备屏幕 · {d.report.network}</small>
              <p>{d.report.screen}</p>
            </div>
          )}
          {d.lastSeen && (
            <small>
              最近通信：
              {new Date(d.lastSeen).toLocaleString("zh-CN", { timeZone })}
            </small>
          )}
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void rotate(d.id)}
          >
            重新签发凭据
          </button>
          {d.enabled && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void revoke(d.id)}
            >
              停用设备
            </button>
          )}
        </article>
      ))}
      <details>
        <summary>登记另一台设备</summary>
        <form onSubmit={register}>
          <label>
            设备名称
            <input
              name="name"
              required
              maxLength={80}
              placeholder="例如：厨房冰箱贴"
            />
          </label>
          <label>
            设备 ID
            <input
              name="id"
              required
              maxLength={64}

              placeholder="例如：kitchen-02"
            />
          </label>
          <label>
            板型 ID
            <input
              name="boardId"
              required
              maxLength={80}
              defaultValue={KORVO_BOARD_ID}
            />
          </label>
          <small>
            使用该板型固件提供的
            ID。登记不会自动适配硬件，尚未支持的板型不会收到 Korvo 固件。
          </small>
          <button disabled={busy}>登记并生成凭据</button>
        </form>
      </details>
      {credential && (
        <div className="card" role="status">
          <h3>为 {credential.id} 保存连接凭据</h3>
          <p>
            将设备 ID
            和下面的凭据填入设备连接设置。凭据仅本次显示，关闭后无法重新读取。
          </p>
          <label>
            设备凭据
            <input
              readOnly
              type="password"
              value={credential.token}
              aria-label="新设备凭据"
              autoComplete="off"
            />
          </label>
          <button
            className="secondary"
            onClick={() =>
              void navigator.clipboard
                .writeText(credential.token)
                .catch(() => setError("复制失败，请选中凭据手动复制"))
            }
          >
            复制凭据
          </button>
          <button onClick={() => setCredential(null)}>已保存，关闭</button>
        </div>
      )}
    </section>
  );
}
