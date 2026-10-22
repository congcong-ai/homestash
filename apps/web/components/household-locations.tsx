"use client";
import { useRef, useState, type FormEvent } from "react";
import { api, createRequestId } from "@homestash/api-client";
import type { Location } from "@homestash/domain";
export function HouseholdLocations({
  locations,
  onChanged,
}: {
  locations: Location[];
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const pending = useRef<{ signature: string; id: string } | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>, location?: Location) {
    e.preventDefault();
    const form = e.currentTarget;
    const name = String(new FormData(form).get("name"));
    const body = location
      ? { action: "rename", id: location.id, expectedName: location.name, name }
      : { action: "create", name };
    const signature = JSON.stringify(body);
    if (pending.current?.signature !== signature)
      pending.current = { signature, id: createRequestId() };
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api("/locations", { ...body, requestId: pending.current.id });
      await onChanged();
      pending.current = null;
      if (!location) form.reset();
      setMessage("位置已保存，库存批次和记录保持原关联。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败，请重试");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel" aria-label="家庭存放位置">
      <h2>家庭存放位置</h2>
      <p>
        为储物柜、抽屉等起一个好记的名字。重命名保留原位置ID，库存和历史记录继续关联。
      </p>
      <form className="row location-form" onSubmit={(e) => void submit(e)}>
        <label>
          新位置名称
          <input
            name="name"
            required
            maxLength={32}
            placeholder="例如：阳台储物柜"
          />
        </label>
        <button disabled={busy}>新增位置</button>
      </form>
      {locations.map((location) => (
        <form
          key={location.id + location.name}
          className="row location-form"
          onSubmit={(e) => void submit(e, location)}
        >
          <label>
            {location.name}的位置名称
            <input
              name="name"
              required
              maxLength={32}
              defaultValue={location.name}
            />
          </label>
          <button className="secondary" disabled={busy}>
            保存名称
          </button>
        </form>
      ))}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <small>
        位置保留用于历史、纠正和备份引用；目前提供新增和重命名。自定义名称可用于语音移动，Mock只支持明确的完整位置名。
      </small>
    </section>
  );
}
