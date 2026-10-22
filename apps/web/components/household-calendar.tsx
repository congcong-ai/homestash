"use client";
import { useRef, useState, type FormEvent } from "react";
import { api, createRequestId } from "@homestash/api-client";
import type { HouseholdCalendar as Calendar } from "@homestash/domain";
const zones = [
  ["UTC", "协调世界时 UTC（原有默认）"],
  ["Asia/Shanghai", "北京 / 上海"],
  ["Asia/Hong_Kong", "香港"],
  ["Asia/Tokyo", "东京"],
  ["Asia/Singapore", "新加坡"],
  ["Europe/London", "伦敦"],
  ["America/Los_Angeles", "洛杉矶"],
  ["America/New_York", "纽约"],
  ["Australia/Sydney", "悉尼"],
];
export function HouseholdCalendar({
  calendar,
  onChanged,
}: {
  calendar: Calendar;
  onChanged: () => Promise<void>;
}) {
  const initial = zones.some(([id]) => id === calendar.timeZone)
    ? calendar.timeZone
    : "custom";
  const [zone, setZone] = useState(initial),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const pending = useRef<{ signature: string; id: string } | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const timeZone = zone === "custom" ? String(f.get("customTimeZone")) : zone;
    const body = { timeZone, expectedRevision: calendar.revision };
    const signature = JSON.stringify(body);
    if (pending.current?.signature !== signature)
      pending.current = { signature, id: createRequestId() };
    setBusy(true);
    setError("");
    try {
      await api("/calendar", { ...body, requestId: pending.current.id });
      await onChanged();
      pending.current = null;
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败，请重试");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel" aria-label="家庭时区与日期">
      <h2>家庭时区与日期</h2>
      <p>
        家庭今天：<strong>{calendar.date}</strong> · {calendar.timeZone}
      </p>
      <form onSubmit={(e) => void submit(e)} className="form-grid">
        <label>
          家庭时区
          <select
            name="timeZone"
            value={zone}
            onChange={(e) => setZone(e.target.value)}
          >
            {zones.map(([id, label]) => (
              <option value={id} key={id}>
                {label}
              </option>
            ))}
            <option value="custom">其他 IANA 时区</option>
          </select>
        </label>
        {zone === "custom" && (
          <label>
            其他时区名称
            <input
              name="customTimeZone"
              defaultValue={initial === "custom" ? calendar.timeZone : ""}
              placeholder="例如：Europe/Paris"
              maxLength={100}
              required
            />
          </label>
        )}
        <p className="full muted">
          库存提醒、默认日期、语音和设备统一按这个家庭时区。保存后重新计算“今天”，不会改写已录入的日期或扣减库存；正在处理的旧日期请求会要求重新确认。
        </p>
        <button disabled={busy}>保存家庭时区</button>
        {error && (
          <p role="alert" className="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
