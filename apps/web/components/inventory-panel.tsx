"use client";
import { useEffect, useRef, useState } from "react";
import { api, createRequestId } from "@homestash/api-client";
import {
  categories,
  categoryNames,
  freshnessInfo,
  today,
  type InventoryItem,
  type InventoryEvent,
  type Location,
} from "@homestash/domain";
const names: Record<string, string> = {
  ITEM_CREATED: "添加",
  ITEM_UPDATED: "修改",
  ITEM_CONSUMED: "消耗",
  ITEM_DISCARDED: "丢弃",
  ITEM_MOVED: "移动",
  ITEM_OPENED: "开封",
  ITEM_EXPIRED: "修改到期日期",
  ITEM_RESTOCKED: "补货",
  ITEM_CORRECTED: "纠正",
};
const statuses = {
  fresh: "日期尚充裕",
  eat_soon: "3天内需留意",
  urgent: "今天需留意",
  expired: "提醒日期已过",
};
export function InventoryPanel({
  items,
  calendar = { date: today(), timeZone: "UTC" },
  locations,
  onChanged,
  onEdit,
  onAdd,
}: {
  items: InventoryItem[];
  calendar?: { date: string; timeZone: string };
  locations: Location[];
  onChanged: () => Promise<void>;
  onEdit: (item: InventoryItem) => void;
  onAdd: () => void;
}) {
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [location, setLocation] = useState("");
  const [filter, setFilter] = useState("active");
  const [sort, setSort] = useState("deadline");
  const active = items.filter((i) => i.quantity > 0);
  const counts = {
    soon: active.filter((i) =>
      ["urgent", "eat_soon"].includes(freshnessInfo(i, calendar.date).status),
    ).length,
    expired: active.filter(
      (i) => freshnessInfo(i, calendar.date).status === "expired",
    ).length,
    undated: active.filter((i) => !freshnessInfo(i, calendar.date).deadline)
      .length,
  };
  const visible = items
    .filter((i) => {
      const info = freshnessInfo(i, calendar.date);
      return (
        (!query ||
          i.name.includes(query.trim()) ||
          i.id.startsWith(query.trim())) &&
        (!category || i.category === category) &&
        (!location || i.locationId === location) &&
        (filter === "empty"
          ? i.quantity === 0
          : i.quantity > 0 &&
            (filter === "active" ||
              (filter === "soon" &&
                ["urgent", "eat_soon"].includes(info.status)) ||
              (filter === "expired" && info.status === "expired") ||
              (filter === "undated" && !info.deadline)))
      );
    })
    .sort((a, b) =>
      sort === "newest"
        ? b.createdAt.localeCompare(a.createdAt)
        : (freshnessInfo(a, calendar.date).deadline ?? "9999").localeCompare(
            freshnessInfo(b, calendar.date).deadline ?? "9999",
          ) || a.createdAt.localeCompare(b.createdAt),
    );
  return (
    <section>
      <div className="section-title">
        <div>
          <p className="eyebrow">每一批，都记得清楚</p>
          <h1>
            家中库存 <small>{active.length} 批</small>
          </h1>
        </div>
        <button onClick={onAdd}>＋ 添加物品</button>
      </div>
      <div className="panel">
        <div className="row">
          <button
            className={filter === "active" ? "" : "secondary"}
            onClick={() => setFilter("active")}
          >
            在库 {active.length}
          </button>
          <button
            className={filter === "soon" ? "" : "secondary"}
            onClick={() => setFilter("soon")}
          >
            临期 {counts.soon}
          </button>
          <button
            className={filter === "expired" ? "" : "secondary"}
            onClick={() => setFilter("expired")}
          >
            日期已过 {counts.expired}
          </button>
          <button
            className={filter === "undated" ? "" : "secondary"}
            onClick={() => setFilter("undated")}
          >
            未设日期 {counts.undated}
          </button>
          <button
            className={filter === "empty" ? "" : "secondary"}
            onClick={() => setFilter("empty")}
          >
            已用完 / 已移出
          </button>
        </div>
        <div className="intake-fields inventory-filters">
          <label>
            搜索名称或批次
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="例如牛奶"
            />
          </label>
          <label>
            类别
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">全部类别</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {categoryNames[c]}
                </option>
              ))}
            </select>
          </label>
          <label>
            存放位置
            <select
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            >
              <option value="">全部位置</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            排序
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="deadline">提醒日期从近到远</option>
              <option value="newest">最近入库优先</option>
            </select>
          </label>
        </div>
        <p className="muted">
          不同批次分别管理，不合并不同单位的数量。日期仅作提醒；食品默认开封后2天提醒，可在编辑批次中自定义或关闭；请核对包装与实际状态。
        </p>
      </div>
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <p role="status">找到 {visible.length} 批库存</p>
      <div className="inventory-list">
        {!visible.length && (
          <div className="panel empty">
            当前条件下没有库存。可以切换筛选，或添加新物品。
          </div>
        )}
        {visible.map((item) => (
          <InventoryBatch
            key={item.id}
            item={item}
            sameName={
              items.filter(
                (i) =>
                  i.name === item.name &&
                  i.category === item.category &&
                  i.quantity > 0,
              ).length
            }
            locations={locations}
            onChanged={async () => {
              await onChanged();
              setNotice(
                "库存已保存。如批次已离开当前筛选，可切换在库或已用完列表查看。",
              );
            }}
            calendar={calendar}
            onEdit={onEdit}
          />
        ))}
      </div>
    </section>
  );
}
function InventoryBatch({
  item,
  calendar,
  sameName,
  locations,
  onChanged,
  onEdit,
}: {
  item: InventoryItem;
  calendar: { date: string; timeZone: string };
  sameName: number;
  locations: Location[];
  onChanged: () => Promise<void>;
  onEdit: (item: InventoryItem) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false),
    [events, setEvents] = useState<InventoryEvent[]>([]),
    [historyLoaded, setHistoryLoaded] = useState(false);
  const [reason, setReason] = useState("");
  const [actionsOpen, setActionsOpen] = useState(false);
  const [actionType, setActionType] = useState("consume");
  const [useAll, setUseAll] = useState(false);
  const pending = useRef(new Map<string, string>());
  const batch = item.id.slice(0, 8),
    info = freshnessInfo(item, calendar.date);
  const loc = (id: string) => locations.find((l) => l.id === id)?.name ?? id;
  const snapshot = (value: InventoryItem | null) =>
    value
      ? `${value.name} ${value.quantity}${value.unit} · ${loc(value.locationId)} · 开封 ${value.openedAt ?? "未开封"} · 建议 ${value.bestBeforeAt ?? "未设置"} · 到期 ${value.expiresAt ?? "未设置"} · 开封提醒 ${value.openedReminderDays === null ? "关闭" : typeof value.openedReminderDays === "number" ? `${value.openedReminderDays}天` : "默认"}`
      : "尚未添加";
  useEffect(() => {
    if (!historyOpen) return;
    let cancelled = false;
    setHistoryLoaded(false);
    void api<InventoryEvent[]>(`/items/${item.id}/events`)
      .then((value) => {
        if (!cancelled) {
          setEvents(value);
          setHistoryLoaded(true);
        }
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "记录读取失败");
      });
    return () => {
      cancelled = true;
    };
  }, [historyOpen, item.id, item.version]);
  async function submit(path: string, body: Record<string, unknown>) {
    const key = JSON.stringify({ path, version: item.version, ...body }),
      requestId = pending.current.get(key) ?? createRequestId();
    pending.current.set(key, requestId);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(path, { ...body, expectedVersion: item.version, requestId });
      await onChanged();
      pending.current.delete(key);
      setMessage("已保存，这一批库存已更新。");
      setReason("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败，请重试");
    } finally {
      setBusy(false);
    }
  }
  const latest = events[0];
  const correctable =
    historyLoaded &&
    latest?.after.version === item.version &&
    latest.type !== "ITEM_CORRECTED";
  return (
    <article
      className="panel inventory-batch"
      aria-label={`${item.name} 批次 ${batch}`}
    >
      <div className="section-title">
        <div>
          <h2>
            {item.name}{" "}
            <small>
              {item.quantity}
              {item.unit}
            </small>
          </h2>
          <small>
            批次 {batch} · {categoryNames[item.category]}
            {sameName > 1 ? ` · 同名在库 ${sameName} 批，请核对这一批` : ""}
          </small>
        </div>
        <span className={`pill ${info.status}`}>
          {item.quantity === 0
            ? "已用完 / 已移出"
            : info.deadline
              ? statuses[info.status]
              : "日期待补充"}
        </span>
      </div>
      <p>
        {loc(item.locationId)} · 购买 {item.purchasedAt ?? "未记录"} · 入库{" "}
        {new Date(item.createdAt).toLocaleString("zh-CN", {
          timeZone: calendar.timeZone,
        })}
      </p>
      <p>
        {info.deadline
          ? `${info.basis}：${info.deadline}${info.days === 0 ? " · 今天" : info.days! < 0 ? ` · 已过${-info.days!}天` : ` · 还有${info.days}天`}${info.estimated ? " · 估算" : ""}`
          : "未设置提醒日期，不代表长期可保存。"}
      </p>
      <small>
        建议食用 {item.bestBeforeAt ?? "未设置"} · 包装到期{" "}
        {item.expiresAt ?? "未设置"} · 开封 {item.openedAt ?? "未开封"}
      </small>
      <small>
        开封提醒：
        {item.openedReminderDays === null
          ? "已关闭"
          : typeof item.openedReminderDays === "number"
            ? `自定义${item.openedReminderDays}天`
            : item.category === "food"
              ? "默认2天"
              : "默认不启用"}
      </small>
      <div className="row batch-actions">
        {item.quantity > 0 && (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => setActionsOpen(!actionsOpen)}
          >
            {actionsOpen ? "收起操作" : "调整库存"}
          </button>
        )}
        <button
          className="secondary"
          disabled={busy}
          onClick={() => onEdit(item)}
        >
          编辑这一批
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => {
            setHistoryOpen(!historyOpen);
            setError("");
          }}
        >
          {historyOpen ? "收起记录" : "记录与纠正"}
        </button>
      </div>
      {item.quantity > 0 && actionsOpen && (
        <form
          className="batch-action-form"
          key={item.version}
          onSubmit={(e) => {
            e.preventDefault();
            const fields = new FormData(e.currentTarget);
            const type = String(fields.get("type"));
            const body =
              type === "move"
                ? { type, locationId: String(fields.get("locationId")) }
                : type === "open"
                  ? { type, date: String(fields.get("date")) }
                  : {
                      type,
                      quantity:
                        fields.get("all") === "on"
                          ? "all"
                          : Number(fields.get("quantity")),
                    };
            void submit(`/items/${item.id}/actions`, body);
          }}
        >
          <fieldset disabled={busy} className="intake-fields">
            <label>
              操作
              <select
                name="type"
                value={actionType}
                onChange={(e) => setActionType(e.target.value)}
              >
                <option value="consume">消耗</option>
                <option value="discard">丢弃</option>
                <option value="move">移动</option>
                <option value="open">开封</option>
              </select>
            </label>
            {(actionType === "consume" || actionType === "discard") && (
              <>
                <label>
                  数量（消耗 / 丢弃）
                  <input
                    name="quantity"
                    type="number"
                    required={!useAll}
                    disabled={useAll}
                    min="0.001"
                    max={item.quantity}
                    step="any"
                    defaultValue={Math.min(1, item.quantity)}
                  />
                </label>
                <label className="row">
                  <input
                    name="all"
                    type="checkbox"
                    checked={useAll}
                    onChange={(e) => setUseAll(e.target.checked)}
                  />
                  消耗 / 丢弃全部
                </label>
              </>
            )}
            {actionType === "move" && (
              <label>
                目标位置（移动）
                <select name="locationId" defaultValue={item.locationId}>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {actionType === "open" && (
              <label>
                日期（开封）
                <input
                  name="date"
                  type="date"
                  defaultValue={calendar.date}
                  required
                />
              </label>
            )}
          </fieldset>
          <button disabled={busy}>
            {busy ? "正在保存…" : `确认操作 · 批次 ${batch}`}
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="alert">
          {error}{" "}
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void onChanged().catch((e) => setError(String(e)))}
          >
            刷新库存
          </button>
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {historyOpen && (
        <div className="batch-history">
          <h3>这一批的完整记录</h3>
          {!historyLoaded && <p>正在读取记录…</p>}
          {correctable && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit(`/items/${item.id}/corrections`, {
                  eventId: latest.id,
                  reason,
                });
              }}
            >
              <p>
                纠正最近一次“{names[latest.type] ?? latest.type}”后：
                {latest.before
                  ? snapshot(latest.before)
                  : "移出误添加的库存，数量归零，保留历史"}
                。
              </p>
              <p className="muted">
                仅恢复这一批；不会撤回采购确认或重新打开烹饪任务。已有后续变动时会拒绝覆盖。
              </p>
              <label>
                纠正原因
                <input
                  value={reason}
                  required
                  maxLength={300}
                  disabled={busy}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="例如刚才点错了消耗数量"
                />
              </label>
              <button className="secondary" disabled={busy || !reason.trim()}>
                确认纠正最近操作
              </button>
            </form>
          )}
          {historyLoaded && !correctable && (
            <p>
              最近记录已纠正或库存已变化。需要进一步调整时，请编辑当前批次。
            </p>
          )}
          {events.map((event) => (
            <div key={event.id} className="batch-event">
              <strong>{names[event.type] ?? event.type}</strong> ·{" "}
              {new Date(event.at).toLocaleString("zh-CN", {
                timeZone: calendar.timeZone,
              })}
              <p>之前：{snapshot(event.before)}</p>
              <p>之后：{snapshot(event.after)}</p>
              {event.correction && (
                <p>
                  纠正原因：{event.correction.reason} · 原记录{" "}
                  {event.correction.eventId.slice(0, 8)}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
