"use client";
import { useRef, useState, type FormEvent } from "react";
import { api, createRequestId } from "@homestash/api-client";
import {
  categories,
  categoryNames,
  today,
  shoppingRemaining,
  shoppingReceived,
  shoppingRevision,
  type ShoppingItem,
  type Location,
} from "@homestash/domain";

export function ShoppingReceive({
  entry,
  locations,
  date = today(),
  onChanged,
  onClose,
}: {
  entry: ShoppingItem;
  locations: Location[];
  date?: string;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<{ signature: string; id: string } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const item = {
      name: String(fields.get("name")),
      category: String(fields.get("category")),
      quantity: Number(fields.get("quantity")),
      unit: String(fields.get("unit")),
      locationId: String(fields.get("locationId")),
      purchasedAt: String(fields.get("purchasedAt")),
      bestBeforeAt: String(fields.get("bestBeforeAt")) || null,
      expiresAt: String(fields.get("expiresAt")) || null,
    };
    const signature = JSON.stringify({
      item,
      revision: shoppingRevision(entry),
    });
    if (pending.current?.signature !== signature)
      pending.current = { signature, id: createRequestId() };
    setBusy(true);
    setError("");
    try {
      await api(`/shopping/${entry.id}/receive`, {
        requestId: pending.current.id,
        expectedRevision: shoppingRevision(entry),
        item,
      });
      await onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "入库未完成，请重试");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="panel" onSubmit={(e) => void submit(e)}>
      <h2>核对购买信息 · {entry.name}</h2>
      {!!entry.receipts?.length && (
        <p>
          此前已入库{shoppingReceived(entry)}
          {entry.unit}，本次只填写新收到的数量；已有关联后请保持名称、单位一致。
        </p>
      )}
      <p>
        计划购买 {entry.quantity}
        {entry.unit}
        。请按实际购买填写，每次确认会新建一批库存；日期不确定可以留空。
      </p>
      <fieldset disabled={busy} className="intake-fields">
        <label>
          名称
          <input
            name="name"
            defaultValue={entry.name}
            required
            maxLength={80}
          />
        </label>
        <label>
          类别
          <select name="category" defaultValue="food">
            {categories.map((c) => (
              <option key={c} value={c}>
                {categoryNames[c]}
              </option>
            ))}
          </select>
        </label>
        <label>
          实际购买数量
          <input
            name="quantity"
            type="number"
            min="0.001"
            max="1000000"
            step="any"
            defaultValue={
              entry.receipts?.length ? shoppingRemaining(entry) : entry.quantity
            }
            required
          />
        </label>
        <label>
          单位
          <input
            name="unit"
            defaultValue={entry.unit}
            required
            maxLength={20}
          />
        </label>
        <label>
          放在哪里
          <select name="locationId" defaultValue="fridge">
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          购买日期
          <input name="purchasedAt" type="date" defaultValue={date} required />
        </label>
        <label>
          建议食用日期
          <input name="bestBeforeAt" type="date" />
        </label>
        <label>
          到期日期
          <input name="expiresAt" type="date" />
        </label>
      </fieldset>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button disabled={busy}>{busy ? "正在入库…" : "确认购买并入库"}</button>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={onClose}
        >
          稍后再核对
        </button>
      </div>
    </form>
  );
}
