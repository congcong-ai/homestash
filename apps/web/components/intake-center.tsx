"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@homestash/api-client";
import type { IntakeEntry, ShoppingItem, Location } from "@homestash/domain";
import { ImageIntake } from "./image-intake";
import { BarcodeIntake } from "./barcode-intake";
import { ShoppingReceive } from "./shopping-receive";

const kindNames = {
  image: "照片 / 小票",
  barcode: "条码",
  shopping: "买到的物品",
};
const statusNames = {
  pending: "待核对",
  confirmed: "已入库",
  cancelled: "已取消",
  failed: "需重试",
};
export function IntakeCenter({
  locations,
  onChanged,
  onViewInventory,
}: {
  locations: Location[];
  onChanged: () => Promise<void>;
  onViewInventory: () => void;
}) {
  const [entries, setEntries] = useState<IntakeEntry[]>([]);
  const [selected, setSelected] = useState<IntakeEntry | null>(null);
  const [shopping, setShopping] = useState<ShoppingItem | null>(null);
  const [filter, setFilter] = useState("waiting");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    setEntries(await api<IntakeEntry[]>("/intake/reviews"));
  }, []);
  useEffect(() => {
    void refresh().catch((e) =>
      setError(e instanceof Error ? e.message : "读取失败"),
    );
  }, [refresh]);
  async function changed() {
    await onChanged();
    await refresh();
  }
  async function open(entry: IntakeEntry) {
    setError("");
    setBusy(true);
    try {
      if (entry.kind === "shopping") {
        const items = await api<ShoppingItem[]>("/shopping");
        const item = items.find((i) => i.id === entry.id);
        if (!item) throw Error("购物项已经移除，请刷新列表");
        setShopping(item);
      }
      setSelected(entry);
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取失败");
    } finally {
      setBusy(false);
    }
  }
  async function dismiss(entry: IntakeEntry) {
    setBusy(true);
    setError("");
    try {
      await api(`/intake/failures/${entry.kind}/${entry.id}/dismiss`, {});
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  const waiting = entries.filter(
    (e) => e.status === "pending" || e.status === "failed",
  );
  const visible =
    filter === "waiting"
      ? waiting
      : entries.filter(
          (e) => e.status === "confirmed" || e.status === "cancelled",
        );
  if (selected)
    return (
      <section>
        <button
          className="secondary"
          onClick={() => {
            setSelected(null);
            void refresh().catch((e) => setError(String(e)));
          }}
        >
          ← 返回待确认中心
        </button>
        {selected.status === "failed" && (
          <p className="notice">{selected.note}</p>
        )}
        {selected.kind === "image" && (
          <ImageIntake
            key={selected.id}
            locations={locations}
            selectedId={selected.status === "failed" ? undefined : selected.id}
            retryId={selected.status === "failed" ? selected.id : undefined}
            onChanged={changed}
            onViewInventory={onViewInventory}
          />
        )}
        {selected.kind === "barcode" && (
          <BarcodeIntake
            key={selected.id}
            locations={locations}
            selectedId={selected.status === "failed" ? undefined : selected.id}
            retryId={selected.status === "failed" ? selected.id : undefined}
            initialBarcode={selected.barcode}
            onChanged={changed}
            onViewInventory={onViewInventory}
          />
        )}
        {selected.kind === "shopping" && shopping && (
          <ShoppingReceive
            entry={shopping}
            locations={locations}
            onChanged={changed}
            onClose={() => setSelected(null)}
          />
        )}
      </section>
    );
  return (
    <section>
      <p className="eyebrow">把新买的东西，安心收好</p>
      <h1>待确认</h1>
      <p>
        照片、小票、条码和买到的物品都在这里。核对后才会入库；重复确认不会新增同一批库存。
      </p>
      <div className="row">
        <button
          className={filter === "waiting" ? "" : "secondary"}
          onClick={() => setFilter("waiting")}
        >
          待处理 {waiting.length}
        </button>
        <button
          className={filter === "history" ? "" : "secondary"}
          onClick={() => setFilter("history")}
        >
          已处理记录
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => {
            setError("");
            void refresh().catch((e) => setError(String(e)));
          }}
        >
          刷新
        </button>
      </div>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      <div className="inventory-list">
        {!visible.length && (
          <div className="panel empty">
            <h2>{filter === "waiting" ? "都收拾好了" : "还没有处理记录"}</h2>
            <p>
              识别的照片、小票和条码，以及购物清单中已买到的物品，会显示在这里。
            </p>
          </div>
        )}
        {visible.map((entry) => (
          <article className="panel" key={`${entry.kind}:${entry.id}`}>
            <small>
              {kindNames[entry.kind]} · {statusNames[entry.status]} ·{" "}
              {new Date(entry.createdAt).toLocaleString("zh-CN")}
            </small>
            <h2>{entry.title}</h2>
            <p>{entry.note}</p>
            <div className="row">
              {(entry.status === "pending" || entry.status === "failed") && (
                <button disabled={busy} onClick={() => void open(entry)}>
                  {entry.status === "failed" ? "重新处理" : "核对并入库"}
                </button>
              )}
              {entry.status === "failed" && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void dismiss(entry)}
                >
                  忽略这次失败
                </button>
              )}
              {(entry.status === "confirmed" ||
                entry.status === "cancelled") && (
                <button
                  className="secondary"
                  onClick={() =>
                    entry.kind === "shopping"
                      ? onViewInventory()
                      : void open(entry)
                  }
                >
                  {entry.status === "confirmed" ? "查看入库结果" : "查看记录"}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
