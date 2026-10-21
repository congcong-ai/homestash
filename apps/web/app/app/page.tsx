"use client";
import { InventoryPanel } from "../../components/inventory-panel";
import { DeviceFleet } from "../../components/device-fleet";
import { DeviceMaintenance } from "../../components/device-maintenance";
import {
  useCallback,
  useEffect,
  useState,
  useRef,
  type FormEvent,
} from "react";
import { ShoppingReceive } from "../../components/shopping-receive";
import { IntakeCenter } from "../../components/intake-center";
import { ImageIntake } from "../../components/image-intake";
import { BarcodeIntake } from "../../components/barcode-intake";
import { api } from "@homestash/api-client";
import {
  categories,
  categoryNames,
  freshness,
  today,
  type InventoryItem,
  type InventoryEvent,
  type Location,
  type ShoppingItem,
} from "@homestash/domain";
import type {
  DeviceState,
  DeviceEvent,
  ManagedDevice,
} from "@homestash/protocol";
import {
  recommend,
  type Recipe,
  type CookingSession,
} from "@homestash/recipes";
type Settings = {
  persona: "default" | "gentle" | "cat";
  provider: {
    mode: "mock" | "openai-compatible";
    baseUrl: string;
    model: string;
  };
  keyConfigured?: boolean;
};
type State = {
  items: InventoryItem[];
  shopping: ShoppingItem[];
  locations: Location[];
  events: InventoryEvent[];
  todayFirst: (InventoryItem & { freshness: string })[];
  recipes: Recipe[];
  cooking: CookingSession | null;
  device: DeviceState;
  physicalDevices: ManagedDevice[];
  physicalDevice: {
    id: string;
    lastSeen: string;
    screen?: string;
    network?: string;
    firmwareVersion?: string;
    firmwarePartition?: string;
  } | null;
  settings: Settings;
};
const tabs = [
  ["home", "今日"],
  ["inventory", "家中库存"],
  ["add", "添点新鲜"],
  ["reviews", "待确认"],
  ["photos", "拍照入库"],
  ["barcodes", "条码入库"],
  ["recipes", "今晚吃什么"],
  ["shopping", "购物清单"],
  ["device", "冰箱贴"],
  ["settings", "设置"],
] as const;
const freshnessNames: Record<string, string> = {
  fresh: "新鲜",
  eat_soon: "建议尽快吃",
  urgent: "建议今天吃",
  expired: "日期已过，请核查",
};
const emoji = (name: string) =>
  name.includes("草莓")
    ? "🍓"
    : name.includes("蛋")
      ? "🥚"
      : name.includes("番茄")
        ? "🍅"
        : name.includes("奶")
          ? "🥛"
          : name.includes("菠菜")
            ? "🥬"
            : "🧺";
export default function Page() {
  const [receiving, setReceiving] = useState<ShoppingItem | null>(null);
  const pendingShopping = useRef(new Map<string, string>());
  const pendingCooking = useRef(new Map<string, string>());
  const pendingVoice = useRef<{ text: string; id: string } | null>(null);
  const pendingEvents = useRef(new Map<string, DeviceEvent>());
  const [connected, setConnected] = useState(true);
  const [state, setState] = useState<State | null>(null),
    [tab, setTab] = useState("home"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [text, setText] = useState("刚买了两个番茄、一盒草莓和十个鸡蛋。"),
    [editing, setEditing] = useState<InventoryItem | null>(null),
    [people, setPeople] = useState(2),
    [question, setQuestion] = useState("放多少？"),
    [recipeRequirements, setRecipeRequirements] = useState("");
  const refresh = useCallback(async () => {
    setState(await api<State>("/state"));
    setConnected(true);
  }, []);
  useEffect(() => {
    void refresh().catch(() =>
      setError("暂时连接不上本地服务，请确认 pnpm dev 已启动。"),
    );
    const id = setInterval(() => {
      void refresh().catch(() => setConnected(false));
    }, 3000);
    if ("serviceWorker" in navigator)
      void navigator.serviceWorker.register("/sw.js");
    return () => clearInterval(id);
  }, [refresh]);
  async function perform(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  async function event(payload: DeviceEvent["payload"]) {
    const key = JSON.stringify(payload);
    const request = pendingEvents.current.get(key) ?? {
      version: 1,
      eventId: crypto.randomUUID(),
      deviceId: "korvo-simulator",
      at: new Date().toISOString(),
      payload,
    };
    pendingEvents.current.set(key, request as DeviceEvent);
    const result = await api<{ message: string }>("/device/events", request);
    pendingEvents.current.delete(key);
    return result;
  }
  async function sendVoice(fromDevice = false, utterance = text) {
    if (pendingVoice.current?.text !== utterance)
      pendingVoice.current = { text: utterance, id: crypto.randomUUID() };
    await perform(async () => {
      const r = fromDevice
        ? await event({
            type: "VOICE_CAPTURED",
            text: utterance,
            simulated: true,
          })
        : await api<{ message: string; recipes?: Recipe[] }>("/voice", {
            requestId: pendingVoice.current!.id,
            text: utterance,
          });
      pendingVoice.current = null;
      setMessage(r.message);
      if ("recipes" in r && r.recipes) {
        setPeople((r.recipes as Recipe[])[0]?.people ?? 2);
        setTab("recipes");
      }
    });
  }
  async function shoppingAction(body: Record<string, unknown>) {
    const key = JSON.stringify(body),
      requestId = pendingShopping.current.get(key) ?? crypto.randomUUID();
    pendingShopping.current.set(key, requestId);
    const result = await api<ShoppingItem[]>("/shopping", {
      ...body,
      requestId,
    });
    pendingShopping.current.delete(key);
    return result;
  }
  async function submitItem(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      name: String(f.get("name")),
      category: String(f.get("category")),
      quantity: Number(f.get("quantity")),
      unit: String(f.get("unit")),
      locationId: String(f.get("locationId")),
      purchasedAt: String(f.get("purchasedAt")) || today(),
      ...(editing ? { openedAt: String(f.get("openedAt")) || null } : {}),
      bestBeforeAt: String(f.get("bestBeforeAt")) || null,
      expiresAt: String(f.get("expiresAt")) || null,
      metadata: editing ? { ...editing.metadata, estimatedDate: false } : {},
    };
    await perform(async () => {
      await api(
        editing ? `/items/${editing.id}/actions` : "/items",
        editing
          ? {
              type: "update",
              patch: body,
              expectedVersion: editing.version,
              requestId: crypto.randomUUID(),
            }
          : body,
      );
      setEditing(null);
      setTab("inventory");
      setMessage("已保存，家里的新鲜一目了然。");
    });
  }
  if (!state)
    return (
      <main className="loading">
        <h1>
          FreshMate<span>✳</span>
        </h1>
        <p role="status">{error || "正在打开你的厨房…"}</p>
        <button onClick={() => void refresh()}>重新连接</button>
      </main>
    );
  const active = state.items.filter((i) => i.quantity > 0);
  const allRecipes = state.recipes.some((r) => r.origin === "ai")
    ? state.recipes
    : recommend(state.items, people);
  const status = state.device;
  const cooking = state.cooking;
  const cookingActive =
    !!cooking && (!cooking.status || cooking.status === "active");
  async function cookingAction(
    action: string,
    extra: Record<string, unknown> = {},
  ) {
    const body = {
      action,
      ...(action === "start"
        ? {}
        : { sessionId: cooking?.id, revision: cooking?.revision ?? 0 }),
      ...extra,
    };
    const key = JSON.stringify(body);
    const requestId = pendingCooking.current.get(key) ?? crypto.randomUUID();
    pendingCooking.current.set(key, requestId);
    const result = await api<CookingSession>("/cooking", {
      ...body,
      requestId,
    });
    pendingCooking.current.delete(key);
    return result;
  }
  const voiceBox = (device = false) => (
    <div className="voice-box">
      <label htmlFor={device ? "device-voice" : "voice"}>
        {device ? "模拟说给冰箱贴听" : "和饭搭子说一句"}
      </label>
      <textarea
        id={device ? "device-voice" : "voice"}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="买了两个番茄，或者：今晚两个人吃什么？"
      />
      <div className="row">
        <small>
          {device
            ? "文字替代录音 · 不使用麦克风"
            : state.settings.provider.mode === "mock"
              ? "模拟 AI · 规则解析"
              : "已启用自选 AI 服务"}
        </small>
        <button
          disabled={busy || !text.trim() || (device && !status.online)}
          onClick={() => void sendVoice(device)}
        >
          发送 ↗
        </button>
      </div>
    </div>
  );
  const recipeCards = (list: Recipe[]) => (
    <div className="recipe-grid">
      {list.map((r, i) => (
        <article className="recipe" key={r.id}>
          <div className={`recipe-art art-${i}`}>
            <span>
              {r.id.includes("strawberry")
                ? "🍓"
                : r.id.includes("soup")
                  ? "🥣"
                  : "🍳"}
            </span>
            <small>{r.minutes} 分钟</small>
          </div>
          <div className="recipe-body">
            <small>
              {r.origin === "ai" ? "AI 菜谱 · " : "本地菜谱 · "}
              {r.used.length
                ? "用上家里的 " + r.used.join("、")
                : "食材还没备齐"}
            </small>
            <h3>{r.name}</h3>
            <p>
              {r.people} 人份 ·{" "}
              {r.missing.length
                ? "待补：" + r.missing.join("、")
                : "主要食材齐啦"}{" "}
            </p>
            <button
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await cookingAction("start", {
                    recipeId: r.id,
                    people: r.people,
                  });
                  setTab("recipes");
                })
              }
            >
              开始做饭 →
            </button>
            <button
              className="secondary"
              disabled={busy || !r.missing.length}
              onClick={() =>
                void perform(async () => {
                  await shoppingAction({
                    action: "from_recipe",
                    recipeId: r.id,
                    people: r.people,
                  });
                  setTab("shopping");
                })
              }
            >
              缺少食材加入清单
            </button>
          </div>
        </article>
      ))}
    </div>
  );
  const itemCard = (item: InventoryItem) => (
    <article className="item" key={item.id}>
      <span className="item-emoji">{emoji(item.name)}</span>
      <div className="grow">
        <div className="row">
          <h3>{item.name}</h3>
          <span className={`pill ${freshness(item)}`}>
            {freshnessNames[freshness(item)]}
          </span>
        </div>
        <p>
          {item.quantity} {item.unit} ·{" "}
          {state.locations.find((l) => l.id === item.locationId)?.name} ·{" "}
          {categoryNames[item.category]}
        </p>
        <small>
          {item.bestBeforeAt
            ? `建议食用 ${item.bestBeforeAt}`
            : "未设置建议日期"}
          {item.expiresAt ? ` · 到期 ${item.expiresAt}` : ""}
          {item.openedAt ? " · 已开封" : ""}
          {item.metadata.estimatedDate ? " · 估算日期" : ""}
        </small>
      </div>
    </article>
  );
  return (
    <div className="shell">
      <aside>
        <a className="brand" href="/" aria-label="返回 HomeStash 首页">
          FreshMate<span>✳</span>
        </a>
        <p className="brand-note tracking-wide">把新鲜，留在日常里。</p>
        <nav aria-label="主导航">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              className={tab === key ? "selected" : ""}
              onClick={() => {
                setTab(key);
                setEditing(null);
              }}
            >
              <span>
                {
                  {
                    home: "⌂",
                    inventory: "▦",
                    add: "＋",
                    reviews: "✓",
                    photos: "◉",
                    barcodes: "▥",
                    recipes: "♧",
                    shopping: "✓",
                    device: "▣",
                    settings: "⚙",
                  }[key]
                }
              </span>
              {label}
            </button>
          ))}
        </nav>
        <div className="local-note">
          <i /> HomeStash 本地模式
          <p>
            库存留在这台电脑
            <br />
            每一份食材，都被好好记住。
          </p>
        </div>
      </aside>
      <main>
        <header>
          <span>
            我的家{" "}
            <span className="muted">
              / {tabs.find((t) => t[0] === tab)?.[1]}
            </span>
          </span>
          <span className="pill">
            {state.settings.provider.mode === "mock" ? "模拟 AI" : "自选 AI"} ·
            软件体验版
          </span>
        </header>
        {!connected && (
          <div role="alert" className="alert">
            本地服务已断开，当前显示上次读取的数据，请恢复连接。
          </div>
        )}
        {error && (
          <div role="alert" className="alert">
            {error}
            <button onClick={() => setError("")}>关闭</button>
          </div>
        )}
        {message && (
          <div role="status" className="notice">
            {message}
            <button aria-label="关闭消息" onClick={() => setMessage("")}>
              ×
            </button>
          </div>
        )}
        {tab === "home" && (
          <>
            <section className="welcome">
              <div>
                <p className="eyebrow">你的厨房，有我惦记</p>
                <h1>
                  今天，也要好好吃饭<span>✳</span>
                </h1>
                <p>看看家里的新鲜，给晚餐一点灵感。</p>
                <button onClick={() => setTab("add")}>＋ 添点新鲜</button>
              </div>
              <div className="hero-art" aria-hidden="true">
                <span>🍅</span>
                <span>🥬</span>
                <span>🥚</span>
                <div>
                  少一点浪费
                  <br />
                  多一点美味 ♡
                </div>
              </div>
            </section>
            <div className="section-title">
              <h2>
                今天先吃 <small>{state.todayFirst.length} 件值得留意</small>
              </h2>
              <button className="link" onClick={() => setTab("inventory")}>
                看看全部 →
              </button>
            </div>
            <div className="today-list">
              {state.todayFirst.length ? (
                state.todayFirst.map(itemCard)
              ) : (
                <div className="empty">
                  {active.length
                    ? "家里的食材暂时都很从容。"
                    : "冰箱还是空的。说一句买了什么，让我帮你记住。"}
                </div>
              )}
            </div>
            <div className="section-title">
              <h2>
                今晚推荐 <small>从家里已有的食材开始</small>
              </h2>
              <button className="link" onClick={() => setTab("recipes")}>
                挑一道 →
              </button>
            </div>
            {recipeCards(state.recipes)}
            <div className="row quick-queries">
              {[
                "家里有什么",
                "今天先吃什么",
                "家里什么快过期",
                "看看购物清单",
              ].map((query) => (
                <button
                  key={query}
                  className="secondary"
                  disabled={busy}
                  onClick={() => void sendVoice(false, query)}
                >
                  {query}
                </button>
              ))}
            </div>
            {voiceBox()}
          </>
        )}
        {tab === "reviews" && (
          <IntakeCenter
            locations={state.locations}
            onChanged={refresh}
            onViewInventory={() => setTab("inventory")}
          />
        )}
        {tab === "barcodes" && (
          <BarcodeIntake
            locations={state.locations}
            onChanged={refresh}
            onViewInventory={() => setTab("inventory")}
          />
        )}
        {tab === "photos" && (
          <ImageIntake
            locations={state.locations}
            onChanged={refresh}
            onViewInventory={() => setTab("inventory")}
          />
        )}
        {tab === "shopping" && (
          <section>
            <p className="eyebrow">出门前，看看还缺什么</p>
            <h1>购物清单</h1>
            <p>
              按食谱添加缺少的食材，也可以记下家里要补的东西。买到后核对实际数量、位置和日期，确认才会入库。
            </p>
            <form
              className="shopping-form panel"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const f = new FormData(form);
                void perform(async () => {
                  await shoppingAction({
                    action: "add",
                    item: {
                      name: String(f.get("name")),
                      quantity: Number(f.get("quantity")),
                      unit: String(f.get("unit")),
                    },
                  });
                  form.reset();
                });
              }}
            >
              <label>
                物品
                <input
                  name="name"
                  placeholder="例如牛奶"
                  required
                  maxLength={80}
                />
              </label>
              <label>
                数量
                <input
                  name="quantity"
                  type="number"
                  min="0.001"
                  max="1000000"
                  step="any"
                  defaultValue="1"
                  required
                />
              </label>
              <label>
                单位
                <input
                  name="unit"
                  placeholder="瓶"
                  defaultValue="个"
                  required
                  maxLength={20}
                />
              </label>
              <button disabled={busy} type="submit">
                加入清单
              </button>
            </form>
            {receiving && (
              <ShoppingReceive
                key={receiving.id}
                entry={receiving}
                locations={state.locations}
                onChanged={refresh}
                onClose={() => setReceiving(null)}
              />
            )}
            <div className="inventory-list">
              {!(state.shopping ?? []).length && (
                <div className="empty panel">
                  <h2>清单还是空的</h2>
                  <p>
                    在菜谱卡片选择“缺少食材加入清单”，或直接添加想买的东西。
                  </p>
                  <button onClick={() => setTab("recipes")}>
                    看看今晚吃什么
                  </button>
                </div>
              )}
              {(state.shopping ?? []).map((item) => (
                <article key={item.id} className="panel shopping-entry">
                  <label>
                    <input
                      type="checkbox"
                      aria-label={`${item.name}已买到`}
                      checked={item.checked}
                      disabled={busy || !!item.inventoryItemId}
                      onChange={() =>
                        void perform(() =>
                          shoppingAction({
                            action: item.checked ? "uncheck" : "check",
                            id: item.id,
                          }),
                        )
                      }
                    />
                    <span
                      style={{
                        textDecoration: item.checked ? "line-through" : "none",
                      }}
                    >
                      {item.name} {item.quantity}
                      {item.unit}
                    </span>
                  </label>
                  <small>
                    {item.inventoryItemId
                      ? "已入库，可到家中库存查看这一批"
                      : item.checked
                        ? "已买到，请核对实物后入库"
                        : item.source === "manual"
                          ? "自己记下的"
                          : "来自食谱缺货清单"}
                  </small>
                  <div className="row">
                    {item.checked && !item.inventoryItemId && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => {
                          setReceiving(item);
                        }}
                      >
                        去入库确认
                      </button>
                    )}
                    <button
                      className="link"
                      disabled={busy}
                      onClick={() =>
                        void perform(() =>
                          shoppingAction({ action: "remove", id: item.id }),
                        )
                      }
                    >
                      移除
                    </button>
                  </div>
                </article>
              ))}
            </div>
            {voiceBox()}
          </section>
        )}
        {tab === "inventory" && (
          <InventoryPanel
            items={state.items}
            locations={state.locations}
            onChanged={refresh}
            onAdd={() => {
              setEditing(null);
              setTab("add");
            }}
            onEdit={(item) => {
              setEditing(item);
              setTab("add");
            }}
          />
        )}
        {tab === "add" && (
          <>
            <p className="eyebrow">给家里的新鲜，留个位置</p>
            <h1>
              {editing
                ? `修改物品 · 批次 ${editing.id.slice(0, 8)}`
                : "添点新鲜"}
            </h1>
            {!editing && voiceBox()}
            <form
              className="panel form-grid"
              onSubmit={submitItem}
              key={editing?.id ?? "new"}
            >
              <label>
                物品名称
                <input
                  name="name"
                  required
                  maxLength={80}
                  defaultValue={editing?.name}
                  placeholder="例如：番茄"
                />
              </label>
              <label>
                类别
                <select
                  name="category"
                  defaultValue={editing?.category ?? "food"}
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {categoryNames[c]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                数量
                <input
                  name="quantity"
                  type="number"
                  required
                  min="0"
                  max="1000000"
                  step="any"
                  defaultValue={editing?.quantity ?? 1}
                />
              </label>
              <label>
                单位
                <input
                  name="unit"
                  required
                  defaultValue={editing?.unit ?? "个"}
                />
              </label>
              <label>
                储存位置
                <select
                  name="locationId"
                  defaultValue={editing?.locationId ?? "fridge"}
                >
                  {state.locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                购买日期
                <input
                  name="purchasedAt"
                  type="date"
                  defaultValue={editing?.purchasedAt ?? today()}
                />
              </label>
              {editing && (
                <label>
                  开封日期（清空表示未开封）
                  <input
                    name="openedAt"
                    type="date"
                    defaultValue={editing.openedAt ?? ""}
                  />
                </label>
              )}
              <label>
                建议食用日期
                <input
                  name="bestBeforeAt"
                  type="date"
                  defaultValue={editing?.bestBeforeAt ?? ""}
                />
              </label>
              <label>
                包装到期日期
                <input
                  name="expiresAt"
                  type="date"
                  defaultValue={editing?.expiresAt ?? ""}
                />
              </label>
              <p className="muted full">
                建议日期不代表食品安全保证，请以包装、保存情况和实际状态为准。药品仅管理库存，不提供服用建议。
              </p>
              <button disabled={busy} type="submit">
                保存物品
              </button>
              {editing && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setEditing(null);
                    setTab("inventory");
                  }}
                >
                  取消
                </button>
              )}
            </form>
          </>
        )}
        {tab === "recipes" && (
          <>
            <p className="eyebrow">不用纠结，今晚吃这个</p>
            <h1>把库存变成一顿好饭</h1>
            <div className="row people">
              <label>
                用餐人数{" "}
                <input
                  aria-label="用餐人数"
                  type="number"
                  min="1"
                  max="20"
                  value={people}
                  onChange={(e) => setPeople(Number(e.target.value))}
                />
              </label>
              <button
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    await api<Recipe[]>("/recipes", {
                      people,
                      requirements: recipeRequirements,
                    });
                  })
                }
              >
                更新推荐
              </button>
              <label>
                晚餐想法
                <input
                  aria-label="晚餐要求"
                  placeholder="例如：20分钟内，清淡一些"
                  value={recipeRequirements}
                  onChange={(e) => setRecipeRequirements(e.target.value)}
                  maxLength={500}
                />
              </label>
              <small>
                {allRecipes.some((r) => r.origin === "ai")
                  ? "AI 生成菜谱 · 食材缺口按当前库存核对"
                  : "本地规则食谱 · 点击更新可使用已配置的 AI"}
              </small>
            </div>
            {cooking && (
              <section className="cooking panel">
                <div className="row">
                  <span className="pill">
                    {cooking.status === "completed"
                      ? "做完啦"
                      : cooking.status === "awaiting_confirmation"
                        ? "核对食材用量"
                        : "正在做饭"}{" "}
                    · {cooking.recipe.people} 人份 · {cooking.step + 1}/
                    {cooking.recipe.steps.length}
                  </span>
                  <h2>{cooking.recipe.name}</h2>
                </div>
                <h3>
                  {cooking.status === "completed"
                    ? cooking.answer
                    : cooking.recipe.steps[cooking.step]}
                </h3>
                <div className="row">
                  <button
                    disabled={busy || !cookingActive || cooking.step === 0}
                    onClick={() =>
                      void perform(() => cookingAction("previous"))
                    }
                  >
                    ← 上一步
                  </button>
                  <button
                    disabled={
                      busy ||
                      !cookingActive ||
                      cooking.step === cooking.recipe.steps.length - 1
                    }
                    onClick={() => void perform(() => cookingAction("next"))}
                  >
                    下一步 →
                  </button>
                  <button
                    disabled={busy || !cookingActive}
                    onClick={() => void perform(() => cookingAction("repeat"))}
                  >
                    再说一遍
                  </button>
                  {cooking.status !== "completed" && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void perform(() => cookingAction("finish"))
                      }
                    >
                      {cooking.status === "awaiting_confirmation"
                        ? "重新核对用量"
                        : "做完了"}
                    </button>
                  )}
                  {cookingActive &&
                    cooking.step === cooking.recipe.steps.length - 1 && (
                      <span>最后一步啦，享用美味吧。</span>
                    )}
                </div>
                <div className="row">
                  <input
                    aria-label="做饭问题"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                  />
                  <button
                    disabled={
                      busy || cooking.status === "completed" || !question.trim()
                    }
                    onClick={() =>
                      void perform(() => cookingAction("ask", { question }))
                    }
                  >
                    问问饭搭子
                  </button>
                </div>
                {cooking.answer && cooking.status !== "completed" && (
                  <p className="answer">{cooking.answer}</p>
                )}
                {cooking.status === "awaiting_confirmation" &&
                  cooking.consumption && (
                    <div className="consumption-confirmation">
                      <h3>核对后，再记下消耗</h3>
                      <p>
                        按食谱预估的数量；如果实际用量不同，请选择不扣减，再到库存中记录。
                      </p>
                      <ul>
                        {cooking.consumption.lines.map((line) => (
                          <li key={line.itemId}>
                            {line.name} {line.quantity}
                            {line.unit} · 批次 {line.itemId.slice(0, 8)}
                          </li>
                        ))}
                      </ul>
                      {cooking.consumption.missing.length > 0 && (
                        <p role="status">
                          {cooking.consumption.missing.join("、")}，请核对库存。
                        </p>
                      )}
                      <div className="row">
                        <button
                          disabled={
                            busy || cooking.consumption.missing.length > 0
                          }
                          onClick={() =>
                            void perform(() =>
                              cookingAction("confirm_consumption"),
                            )
                          }
                        >
                          确认扣减
                        </button>
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            void perform(() =>
                              cookingAction("skip_consumption"),
                            )
                          }
                        >
                          不扣减，结束做饭
                        </button>
                      </div>
                    </div>
                  )}
                <small>
                  设备语音支持“下一步”“上一步”“再说一遍”“放多少”“做完了”。只有明确确认后才扣减库存。
                </small>
              </section>
            )}
            {recipeCards(allRecipes)}
            {voiceBox()}
          </>
        )}
        {tab === "device" && (
          <>
            <p className="eyebrow">厨房里的小小陪伴</p>
            <h1>FreshMate 冰箱贴</h1>
            <p className="muted">Korvo LCD 模拟屏幕 · 800 × 480 比例</p>
            <DeviceFleet
              devices={state.physicalDevices ?? []}
              onChanged={refresh}
            />
            <p className="muted">
              Korvo 按 SET 开始录音，再按停止；MODE 拍照。下方为独立设备模拟器。
            </p>
            <DeviceMaintenance devices={state.physicalDevices ?? []} />
            <section className="device">
              <div className="lcd">
                <div className="row">
                  <b>FreshMate ✳</b>
                  <small>
                    {status.online ? "在线" : "离线"} · Wi-Fi{" "}
                    {status.wifi ? "已连接" : "已断开"} · {status.battery}%
                  </small>
                </div>
                <div className="screen-content break-words">
                  <small>
                    {status.recording ? "● 正在模拟录音" : "今天，也要好好吃饭"}
                  </small>
                  <h2>{status.screen}</h2>
                  {!cooking && (
                    <p>
                      {state.todayFirst
                        .map(
                          (i) => `${i.name} · ${freshnessNames[i.freshness]}`,
                        )
                        .join(" / ") || "家里的新鲜，我记着呢。"}
                    </p>
                  )}
                </div>
              </div>
              <div className="hardware-buttons">
                {(["SET", "PREVIOUS", "NEXT"] as const).map((b) => (
                  <button
                    key={b}
                    disabled={busy || !status.online}
                    onClick={() =>
                      void perform(() =>
                        event({ type: "BUTTON_PRESSED", button: b }),
                      )
                    }
                  >
                    {b === "SET"
                      ? "● 录音开关"
                      : b === "NEXT"
                        ? "下一步 →"
                        : "← 上一步"}
                  </button>
                ))}
              </div>
            </section>
            <div className="panel device-controls">
              <label>
                <input
                  type="checkbox"
                  checked={status.wifi}
                  onChange={(e) =>
                    void perform(() =>
                      event({
                        type: "HEARTBEAT",
                        wifi: e.target.checked,
                        online: status.online,
                        battery: status.battery,
                      }),
                    )
                  }
                />{" "}
                Wi-Fi
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={status.online}
                  onChange={(e) =>
                    void perform(() =>
                      event({
                        type: "HEARTBEAT",
                        wifi: status.wifi,
                        online: e.target.checked,
                        battery: status.battery,
                      }),
                    )
                  }
                />{" "}
                设备在线
              </label>
              <label>
                电量{" "}
                <input
                  aria-label="电量"
                  type="range"
                  min="0"
                  max="100"
                  value={status.battery}
                  onChange={(e) => {
                    const n = Number(e.currentTarget.value);
                    void perform(() =>
                      event({
                        type: "HEARTBEAT",
                        wifi: status.wifi,
                        online: status.online,
                        battery: n,
                      }),
                    );
                  }}
                />
              </label>
              <button
                disabled={busy}
                onClick={() =>
                  void perform(() =>
                    event({
                      type: "HEARTBEAT",
                      wifi: status.wifi,
                      online: true,
                      battery: status.battery,
                    }),
                  )
                }
              >
                发送心跳 / 上线
              </button>
              <select
                aria-label="电源状态"
                value={status.mode}
                disabled={!status.online || busy}
                onChange={(e) =>
                  void perform(() =>
                    event({
                      type: "POWER_CHANGED",
                      mode: e.target.value as DeviceState["mode"],
                    }),
                  )
                }
              >
                <option value="active">活动</option>
                <option value="idle">空闲</option>
                <option value="light_sleep">浅睡眠</option>
                <option value="deep_sleep">深睡眠</option>
              </select>
              <button
                disabled={busy || !status.online}
                onClick={() =>
                  void perform(async () => {
                    const r = await event({
                      type: "CAMERA_CAPTURED",
                      simulated: true,
                      width: 1280,
                      height: 720,
                      mime: "image/jpeg",
                    });
                    setMessage(r.message);
                  })
                }
              >
                模拟拍照（{status.cameraCount}）
              </button>
              <small>
                心跳超过 45 秒视为离线；模拟拍照仅发送事件，不进行识别。
              </small>
            </div>
            {voiceBox(true)}
          </>
        )}
        {tab === "settings" && (
          <>
            <p className="eyebrow">按你的习惯来</p>
            <h1>我的饭搭子</h1>
            <form
              className="panel form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void perform(async () => {
                  await api("/settings", {
                    persona: f.get("persona"),
                    provider: {
                      mode: f.get("mode"),
                      baseUrl: f.get("baseUrl"),
                      model: f.get("model"),
                    },
                  });
                  setMessage("设置已保存。");
                });
              }}
            >
              <label>
                说话风格
                <select name="persona" defaultValue={state.settings.persona}>
                  <option value="default">默认饭搭子</option>
                  <option value="gentle">温柔饭搭子</option>
                  <option value="cat">猫猫饭搭子</option>
                </select>
              </label>
              <label>
                AI 模式
                <select name="mode" defaultValue={state.settings.provider.mode}>
                  <option value="mock">模拟 AI（无需联网）</option>
                  <option value="openai-compatible">
                    自选 OpenAI-compatible 服务
                  </option>
                </select>
              </label>
              <label className="full">
                服务地址
                <input
                  name="baseUrl"
                  type="url"
                  required
                  defaultValue={state.settings.provider.baseUrl}
                />
              </label>
              <label>
                模型名称
                <input
                  name="model"
                  defaultValue={state.settings.provider.model}
                  placeholder="填写服务支持的模型名"
                />
              </label>
              <p>
                服务端密钥：{state.settings.keyConfigured ? "已配置" : "未配置"}
                <br />
                <small>
                  密钥只通过本机 .env 的 AI_API_KEY
                  注入，不发送给设备或显示在浏览器。
                </small>
              </p>
              <p className="full muted">
                模拟模式完全在本机运行。选择外部 AI
                服务后，你输入的文字会发送到该服务；库存数据库仍在本机。食谱和做饭问答当前使用本地规则。
              </p>
              <button disabled={busy}>保存设置</button>
            </form>
          </>
        )}
        <footer>
          FreshMate · 由 HomeStash 提供支持{" "}
          <span>少一点浪费，多一点生活。</span>
        </footer>
      </main>
    </div>
  );
}
