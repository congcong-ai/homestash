"use client";
import Link from "next/link";
import { OfflinePhotos } from "./offline-photos";
import { ModelPanel } from "./model-panel";
import { FoodPanel } from "./food-panel";
import { AvatarPanel } from "./avatar-panel";
import { createRequestId } from "@homestash/api-client";
import type { ManagedDevice } from "@homestash/protocol";
import {
  useCallback,
  useEffect,
  useState,
  useRef,
  type FormEvent,
} from "react";
import styles from "./yard.module.css";

type Memory = {
  id: string;
  title: string;
  createdAt: string;
  roleName: string;
  source: "device" | "simulated";
  photoUrl: string;
};
type Yard = {
  photoJob: { status: string; expiresAt: number } | null;
  consent: { token: string; expiresAt: number; accepted: boolean } | null;
  role: {
    name: string;
    line: string;
    createdAt: string | null;
    keepsakeCount: number;
  };
  settings: { proactiveVoice: boolean; listening: boolean; silent: boolean };
  interactions: {
    id: string;
    text: string;
    reply: string;
    createdAt: string;
    simulated: boolean;
  }[];
  memories: Memory[];
  preview: {
    id: string;
    title: string;
    createdAt: string;
    source: "simulated" | "device";
  } | null;
  capabilities: {
    cameraReady: boolean;
    cameraReason: string;
    voiceIdentity: string;
  };
  tts: {
    provider: string;
    model: string;
    voice: string;
    speed: number;
    asrProvider: string;
    localTtsConfigured: boolean;
    localTtsKeyConfigured: boolean;
    cloudKeyConfigured: boolean;
  };
};
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.error ?? `请求失败（${response.status}）`);
  return data as T;
}
const rid = createRequestId;
const capabilityNames: Record<string, string> = {
  audio_input: "麦克风",
  audio_output: "扬声器",
  camera: "摄像头",
  display: "显示屏",
  touch: "触摸",
  buttons: "按键",
  wifi: "无线网络",
  ble_provisioning: "蓝牙配网",
  ota: "固件更新",
  persistent_storage: "持久存储",
  timer_sleep: "定时唤醒",
};

type StoryRules = {
  version: number;
  rules: {
    id: string;
    enabled: boolean;
    trigger: "wake" | "keyword";
    keyword: string;
    line: string;
    mood: "happy" | "curious" | "rest";
    keepsake: "none" | "first-story";
  }[];
};
export default function YardPage() {
  const [story, setStory] = useState<StoryRules | null>(null);
  const [storyMessage, setStoryMessage] = useState("");
  const [storyBusy, setStoryBusy] = useState(false);
  const [trial, setTrial] = useState<{
    id: string;
    text: string;
    reply: string;
  } | null>(null);
  const saveReplies = async (keyword?: string, ruleId?: string) => {
    if (!story || storyBusy) return;
    setStoryBusy(true);
    setStoryMessage("");
    setTrial(null);
    let saved = false;
    try {
      const next = await api<StoryRules>("/api/yard/rules", {
        method: "PUT",
        body: JSON.stringify(story),
      });
      setStory(next);
      saved = true;
      setStoryMessage("已保存，下次聊天就会使用这些回答。");
      if (keyword && ruleId) {
        const result = await api<{ reply: string }>("/api/yard/interactions", {
          method: "POST",
          body: JSON.stringify({
            requestId: createRequestId(),
            text: keyword,
            simulated: true,
          }),
        });
        setTrial({ id: ruleId, text: keyword, reply: result.reply });
        await refresh();
      }
    } catch (error) {
      setStoryMessage(
        `${saved ? "设置已保存，但试聊未完成：" : "保存失败："}${(error as Error).message}`,
      );
    } finally {
      setStoryBusy(false);
    }
  };
  useEffect(() => {
    void api<StoryRules>("/api/yard/rules")
      .then(setStory)
      .catch((e: Error) => setStoryMessage(e.message));
  }, []);

  const [yard, setYard] = useState<Yard | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const latestTurnId = yard?.interactions.at(-1)?.id;
  useEffect(() => {
    if (chatRef.current)
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [latestTurnId]);
  const [devices, setDevices] = useState<ManagedDevice[]>([]);
  const [deviceError, setDeviceError] = useState("");
  const [checkedAt, setCheckedAt] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [line, setLine] = useState("");
  const [token, setToken] = useState("");
  const [title, setTitle] = useState("和小冰聊聊天合影");
  const [testMode, setTestMode] = useState(false);
  const [ttsAudio, setTtsAudio] = useState("");
  const [tts, setTts] = useState({
    provider: "disabled",
    model: "qwen3-tts-flash",
    voice: "Momo",
    speed: 1,
  });
  const refresh = useCallback(async () => {
    const next = await api<Yard>("/api/yard");
    setYard(next);
    setToken(next.consent?.token ?? "");
    setName(next.role.name);
    setLine(next.role.line);
    setTts({
      provider: next.tts.provider,
      model: next.tts.model,
      voice: next.tts.voice,
      speed: next.tts.speed,
    });
  }, []);
  const refreshDevices = useCallback(async () => {
    try {
      setDevices(await api<ManagedDevice[]>("/api/devices"));
      setDeviceError("");
      setCheckedAt(new Date().toLocaleTimeString("zh-CN"));
    } catch {
      setDeviceError("无法读取设备状态，请重试。上次结果可能已过期。");
    }
  }, []);
  useEffect(() => {
    void refreshDevices();
    const timer = setInterval(() => void refreshDevices(), 15000);
    return () => clearInterval(timer);
  }, [refreshDevices]);
  useEffect(() => {
    void refresh().catch((e: Error) => setError(e.message));
  }, [refresh]);
  useEffect(() => {
    const timer = setInterval(() => {
      void api<Yard>("/api/yard")
        .then((next) => setYard(next))
        .catch(() => {
          setError("家庭空间状态更新失败，请检查服务连接后刷新页面。");
        });
    }, 2000);
    return () => clearInterval(timer);
  }, []);
  useEffect(
    () => () => {
      if (ttsAudio) URL.revokeObjectURL(ttsAudio);
    },
    [ttsAudio],
  );
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  };
  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!text.trim()) return;
    const value = text.trim();
    setText("");
    await run(() =>
      api("/api/yard/interactions", {
        method: "POST",
        body: JSON.stringify({
          requestId: rid(),
          text: value,
          simulated: true,
        }),
      }),
    );
  };
  const audition = async () =>
    run(async () => {
      await api("/api/yard/tts", {
        method: "PATCH",
        body: JSON.stringify(tts),
      });
      const response = await fetch("/api/yard/tts/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "莓莓在，甜甜的陪伴就在。" }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? "语音试听失败。");
      }
      const url = URL.createObjectURL(await response.blob());
      setTtsAudio(url);
      try {
        await new Audio(url).play();
      } catch {
        /* 浏览器阻止自动播放时仍显示播放器供手动试听 */
      }
    });
  const invite = async () =>
    run(async () => {
      const result = await api<{ token: string }>("/api/yard/photo/invite", {
        method: "POST",
        body: JSON.stringify({ requestId: rid() }),
      });
      setToken(result.token);
      await api("/api/yard/photo/consent", {
        method: "POST",
        body: JSON.stringify({ token: result.token, accepted: true }),
      });
    });
  const consent = async (accepted: boolean) =>
    run(async () => {
      if (accepted && !token) throw new Error("请先发起一次新的拍照邀请。");
      await api(
        accepted ? "/api/yard/photo/consent" : "/api/yard/photo/cancel",
        {
          method: "POST",
          body: JSON.stringify(accepted ? { token, accepted } : {}),
        },
      );
      if (!accepted) setToken("");
    });
  const fixtureJpeg = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 960;
    canvas.height = 640;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器不支持模拟预览画布。");
    const gradient = context.createLinearGradient(0, 0, 960, 640);
    gradient.addColorStop(0, "#fbe4e7");
    gradient.addColorStop(1, "#f6efdc");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 960, 640);
    context.fillStyle = "#fffaf2";
    context.beginPath();
    context.roundRect(90, 75, 780, 490, 42);
    context.fill();
    context.textAlign = "center";
    context.fillStyle = "#a24354";
    context.font = "bold 48px sans-serif";
    context.fillText("软件联调模拟画面", 480, 190);
    context.font = "160px sans-serif";
    context.fillText("🍓  🏡  🍓", 480, 390);
    context.fillStyle = "#6f665f";
    context.font = "28px sans-serif";
    context.fillText("这不是 T5 相机拍摄", 480, 485);
    return canvas.toDataURL("image/jpeg", 0.86).split(",")[1];
  };
  const preview = async () =>
    run(async () => {
      if (!token) throw new Error("需先发起邀请并明确答应。");

      await api("/api/yard/photo/preview", {
        method: "POST",
        body: JSON.stringify({
          token,
          requestId: rid(),
          title,
          jpegBase64: fixtureJpeg(),
          simulated: true,
        }),
      });
    });
  const saveMemory = async () => {
    if (!yard?.preview) return;
    await run(() =>
      api("/api/yard/photo/save", {
        method: "POST",
        body: JSON.stringify({ requestId: yard.preview!.id, title }),
      }),
    );
    setToken("");
  };
  if (!yard && !error)
    return <main className={styles.loading}>正在打开暖暖的家…</main>;
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/app/yard">
          <span className={styles.brandIcon}>✳</span>
          <span>
            萌小冰 <small>暖暖的家</small>
          </span>
        </Link>
        <div className={styles.headerActions}>
          <span className={styles.pill}>本地家庭空间</span>
          <a className={styles.backoffice} href="#devices">
            设备状态 ↗
          </a>
        </div>
      </header>

      <div className={styles.content}>
        <nav className={styles.navigation} aria-label="家庭空间导航">
          <a href="#overview">家的日常</a>
          <a href="#devices">我的设备</a>
          <a href="#interaction">互动记录</a>
          <a href="#roles">萌萌伙伴</a>
          <a href="#memories">家庭回忆</a>
          <a href="#settings">语音与设置</a>
          <a href="#avatar-settings">表情与吃饭互动</a>
        </nav>
        <section id="overview" className={styles.hero}>
          <div>
            <span className={styles.eyebrow}>有你在，家就暖暖的</span>
            <h1>
              你回来啦，
              <br />
              <em>莓莓等你好久啦。</em>
            </h1>
            <p>和萌萌伙伴聊聊今天，分享一口好吃的，把小日子过得甜甜的。</p>
            <div className={styles.heroTags}>
              <span>✦ 一家人在一起</span>
              <span>✦ 陪伙伴慢慢长大</span>
              <span>✦ 点一下，留住小瞬间</span>
            </div>
          </div>
          <div className={styles.heroArt} aria-label="草莓伙伴莓莓插画">
            <div className={styles.sun} />
            <div className={styles.leaf}>✦</div>
            <div className={styles.berry}>🍓</div>
            <div className={styles.house}>⌂</div>
            <div className={styles.artCaption}>莓莓在，甜甜的陪伴就在。</div>
          </div>
        </section>
        {error && (
          <div role="alert" className={styles.error}>
            {error}
            <button onClick={() => setError("")}>知道了</button>
          </div>
        )}
        <section className={`${styles.card} ${styles.storyCard}`}>
          <h2>教小冰怎么接话</h2>
          <p>
            给小冰教一句暖暖的回答。设置好后，聊天时你说到这句话，小冰就会这样回应你。
          </p>
          <div className={styles.replyExample}>
            <strong>比如，你说「我回来啦」</strong>
            <p>小冰回答：「欢迎回家！今天辛苦啦，抱抱你。」</p>
            <small>
              可以写一句话，也可以只写几个字。聊天内容包含这些字时就会匹配；多条同时匹配时，使用排在前面的回答。
            </small>
          </div>
          <form
            className={styles.storyForm}
            onChange={() => {
              setTrial(null);
              setStoryMessage("");
            }}
            onSubmit={(e) => {
              e.preventDefault();
              void saveReplies();
            }}
          >
            <fieldset disabled={storyBusy} className={styles.replyFields}>
              {story?.rules.map((rule, index) => (
                <fieldset key={rule.id}>
                  <legend>
                    {rule.trigger === "wake"
                      ? "见面时，小冰先说什么"
                      : "你说一句，小冰回一句"}
                  </legend>
                  <label>
                    使用这句回答
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={(e) =>
                        setStory({
                          ...story,
                          rules: story.rules.map((r, i) =>
                            i === index
                              ? { ...r, enabled: e.target.checked }
                              : r,
                          ),
                        })
                      }
                    />
                  </label>
                  {rule.trigger === "wake" && (
                    <p className={styles.replyHelp}>
                      设备唤醒时使用的招呼语。网页聊天不会自动播放；开门自动招呼还需要设备传感器支持。
                    </p>
                  )}
                  {rule.trigger === "keyword" && (
                    <label>
                      当你说到……
                      <input
                        value={rule.keyword}
                        required
                        placeholder="比如：我回来啦"
                        maxLength={30}
                        onChange={(e) =>
                          setStory({
                            ...story,
                            rules: story.rules.map((r, i) =>
                              i === index
                                ? { ...r, keyword: e.target.value }
                                : r,
                            ),
                          })
                        }
                      />
                    </label>
                  )}
                  <label>
                    {rule.trigger === "wake" ? "小冰的招呼语" : "小冰就回答……"}
                    <input
                      value={rule.line}
                      placeholder="比如：欢迎回家！今天辛苦啦，抱抱你。"
                      maxLength={80}
                      required
                      onChange={(e) =>
                        setStory({
                          ...story,
                          rules: story.rules.map((r, i) =>
                            i === index ? { ...r, line: e.target.value } : r,
                          ),
                        })
                      }
                    />
                  </label>
                  {rule.trigger === "keyword" && (
                    <details className={styles.replyMore}>
                      <summary>更多设置（可以不改）</summary>
                      <label>
                        回答后，小冰的心情
                        <select
                          value={rule.mood}
                          onChange={(e) =>
                            setStory({
                              ...story,
                              rules: story.rules.map((r, i) =>
                                i === index
                                  ? {
                                      ...r,
                                      mood: e.target.value as typeof rule.mood,
                                    }
                                  : r,
                              ),
                            })
                          }
                        >
                          <option value="happy">开心</option>
                          <option value="curious">好奇</option>
                          <option value="rest">休息</option>
                        </select>
                      </label>
                      <label>
                        这次聊天要点亮纪念吗
                        <select
                          value={rule.keepsake}
                          onChange={(e) =>
                            setStory({
                              ...story,
                              rules: story.rules.map((r, i) =>
                                i === index
                                  ? {
                                      ...r,
                                      keepsake: e.target
                                        .value as typeof rule.keepsake,
                                    }
                                  : r,
                              ),
                            })
                          }
                        >
                          <option value="none">不用啦</option>
                          <option value="first-story">
                            我们的第一个故事（仅一次）
                          </option>
                        </select>
                      </label>
                      <small>
                        纪念是一个互动标记，不会保存照片或家庭故事。
                      </small>
                    </details>
                  )}
                  {rule.trigger === "keyword" && (
                    <div className={styles.replyTrial}>
                      <button
                        type="button"
                        disabled={!rule.enabled || !rule.keyword.trim()}
                        onClick={(e) => {
                          if (e.currentTarget.form?.reportValidity())
                            void saveReplies(rule.keyword.trim(), rule.id);
                        }}
                      >
                        保存并试一试
                      </button>
                      <small>
                        会保存本页全部设置，并发送一次网页试聊；会留下互动记录，也可能点亮纪念。
                      </small>
                      {trial?.id === rule.id && (
                        <div role="status" className={styles.replyExample}>
                          <p>你说：{trial.text}</p>
                          <p>小冰回答：{trial.reply}</p>
                        </div>
                      )}
                    </div>
                  )}
                </fieldset>
              ))}
            </fieldset>
            <button disabled={!story || storyBusy} type="submit">
              {storyBusy ? "正在保存…" : "保存回答"}
            </button>
            <p role="status">{storyMessage}</p>
          </form>
        </section>
        <section id="devices" className={`${styles.card} ${styles.devices}`}>
          <div className={styles.cardHeading}>
            <div>
              <span className={styles.kicker}>设备与连接</span>
              <h2>我的萌小冰</h2>
            </div>
            <button
              className={styles.secondaryButton}
              onClick={() => void refreshDevices()}
            >
              刷新状态
            </button>
          </div>
          <p className={styles.subtle}>
            每 15 秒读取服务端记录；45 秒内有心跳才显示在线。
            {checkedAt && `最近检查 ${checkedAt}`}
          </p>
          {deviceError && (
            <p role="alert" className={styles.subtle}>
              {deviceError}
            </p>
          )}
          {!devices.length && !deviceError && (
            <p className={styles.subtle}>
              尚无登记设备。完成设备凭据配置并连接 Core
              后，这里将显示心跳与上报信息。
            </p>
          )}
          <div className={styles.deviceGrid}>
            {devices.map((device) => (
              <article key={device.id} className={styles.deviceItem}>
                <div className={styles.cardHeading}>
                  <h3>{device.name}</h3>
                  <span className={styles.statusTag}>
                    {!device.enabled
                      ? "已停用"
                      : deviceError
                        ? "状态待刷新"
                        : device.online
                          ? "在线"
                          : "离线"}
                  </span>
                </div>
                <dl>
                  <dt>设备编号</dt>
                  <dd>{device.id}</dd>
                  <dt>板卡</dt>
                  <dd>{device.boardId}</dd>
                  <dt>最近心跳</dt>
                  <dd>
                    {device.lastSeen
                      ? new Date(device.lastSeen).toLocaleString("zh-CN")
                      : "尚未收到"}
                  </dd>
                  <dt>网络上报</dt>
                  <dd>{device.report.network ?? "尚未上报"}</dd>
                  <dt>固件版本</dt>
                  <dd>{device.report.firmwareVersion ?? "尚未上报"}</dd>
                  <dt>声明能力</dt>
                  <dd>
                    {device.report.hardware?.capabilities
                      .map(
                        (capability) =>
                          capabilityNames[capability] ?? "其他能力",
                      )
                      .join("、") || "尚未上报"}
                  </dd>
                </dl>
              </article>
            ))}
          </div>
          <div className={styles.capabilityGrid}>
            <div>
              <strong>门动作传感器</strong>
              <p>尚未验证连通，开门唤醒未验收</p>
            </div>
            <div>
              <strong>设备相机</strong>
              <p>
                {yard?.capabilities.cameraReady
                  ? "设备报告就绪"
                  : "未接通，可继续文字互动"}
              </p>
            </div>
            <div>
              <strong>声纹身份</strong>
              <p>未验证，使用通用称呼</p>
            </div>
            <div>
              <strong>动态语音</strong>
              <p>
                {yard?.tts.provider === "disabled"
                  ? "未配置"
                  : (yard?.tts.provider ?? "正在读取")}{" "}
                · 整句合成
              </p>
            </div>
          </div>
        </section>
        {yard && (
          <div className={styles.grid}>
            <section
              id="interaction"
              className={`${styles.card} ${styles.chatCard}`}
            >
              <div className={styles.cardHeading}>
                <div>
                  <span className={styles.kicker}>01 · 自然接话</span>
                  <h2>和小冰聊聊天</h2>
                </div>
                <span className={styles.simTag}>文字试聊</span>
              </div>
              <p className={styles.subtle}>
                在这里输入你想对冰箱贴说的话，看看小冰怎么回答。网页和设备使用同一套回复逻辑；这里不测试麦克风和扬声器，也不会让冰箱贴出声。
              </p>
              <div className={styles.chat} ref={chatRef}>
                <div className={styles.botBubble}>
                  <span>✿ 萌小冰</span>
                  <p>{yard.role.line}</p>
                </div>
                {yard.interactions.slice(-20).map((turn) => (
                  <div className={styles.turn} key={turn.id}>
                    <div className={styles.userBubble}>{turn.text}</div>
                    <div className={styles.botBubble}>
                      <span>
                        ✿ 萌小冰 · {turn.simulated ? "文字试聊" : "设备互动"}
                      </span>
                      <p>{turn.reply}</p>
                    </div>
                    <small className={styles.subtle}>
                      {new Date(turn.createdAt).toLocaleString("zh-CN")}
                    </small>
                  </div>
                ))}
              </div>
              <form
                className={styles.composer}
                onSubmit={(e: FormEvent) => void send(e)}
              >
                <input
                  value={text}
                  maxLength={1000}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="聊聊今天：买了什么，或有什么开心事"
                  aria-label="输入对萌萌伙伴说的话"
                />
                <button disabled={busy || !text.trim()}>
                  说给小冰听 <span>↗</span>
                </button>
              </form>
            </section>
            <section id="roles" className={styles.card}>
              <div className={styles.cardHeading}>
                <div>
                  <span className={styles.kicker}>02 · 一起长大</span>
                  <h2>家里的萌萌伙伴</h2>
                </div>
                <span className={styles.keepsake}>
                  ✦ {yard.role.keepsakeCount} 枚纪念
                </span>
              </div>
              <div className={styles.roleCard}>
                <div className={styles.roleEmoji}>🍓</div>
                <div>
                  <strong>{yard.role.name}</strong>
                  <p>
                    {yard.role.createdAt
                      ? "已经成为家里的一员啦"
                      : "聊聊草莓，认识莓莓吧"}
                  </p>
                </div>
              </div>
              <form
                className={styles.roleForm}
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(() =>
                    api("/api/yard/role", {
                      method: "PATCH",
                      body: JSON.stringify({ name, line }),
                    }),
                  );
                }}
              >
                <label>
                  名字
                  <input
                    value={name}
                    maxLength={24}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label>
                  伙伴的悄悄话
                  <input
                    value={line}
                    maxLength={120}
                    onChange={(e) => setLine(e.target.value)}
                  />
                </label>
                <button disabled={busy}>保存角色</button>
              </form>
              <div className={styles.culture}>
                <span>今日小知识 · 原创叙事</span>
                <p>
                  “莓莓说：今天也要甜甜的，开心多一点点。”这是角色台词，不记录现实食材，也不代表家庭往事。
                </p>
              </div>
            </section>
            <section className={`${styles.card} ${styles.photoCard}`}>
              <div className={styles.cardHeading}>
                <div>
                  <span className={styles.kicker}>03 · 共同回忆</span>
                  <h2>留一张合影</h2>
                </div>
                <span className={styles.statusTag}>
                  {yard.capabilities.cameraReady
                    ? "近期采集成功"
                    : "待采集验证"}
                </span>
              </div>
              <p className={styles.subtle}>{yard.capabilities.cameraReason}</p>
              <p role="status">
                在小冰主屏点击「拍照」即可直接采集，预览会自动出现在这里。
              </p>
              <p role="status">
                {yard.photoJob?.status === "capturing"
                  ? yard.photoJob.expiresAt > Date.now()
                    ? "正在拍摄或传输，请稍候…"
                    : "本次拍摄已超时，请重试。"
                  : yard.photoJob?.status === "failed"
                    ? "拍摄未完成，请检查相机与网络。"
                    : ""}
              </p>
              <button disabled={busy} onClick={() => void consent(false)}>
                取消当前拍摄 / 放弃预览
              </button>
              {yard.capabilities.cameraReady && (
                <p className={styles.available}>相机功能已由设备报告就绪。</p>
              )}
              {yard.preview && (
                <div className={styles.preview}>
                  <img
                    src={`/api/yard/previews/${yard.preview.id}/photo`}
                    alt={
                      yard.preview.source === "simulated"
                        ? "软件模拟预览"
                        : "设备照片预览"
                    }
                  />
                  <span>
                    {yard.preview.source === "simulated"
                      ? "软件联调模拟样片 · 不是相机拍摄"
                      : "设备采集预览 · 确认后保存"}
                  </span>
                  <label>
                    回忆标题
                    <input
                      value={title}
                      maxLength={80}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </label>
                  <div>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const next = await api<{ token: string }>(
                            "/api/yard/photo/retake",
                            { method: "POST" },
                          );
                          setToken(next.token);
                        })
                      }
                    >
                      重拍
                    </button>
                    <button
                      className={styles.quietButton}
                      disabled={busy}
                      onClick={() => void consent(false)}
                    >
                      放弃
                    </button>
                    <button disabled={busy} onClick={() => void saveMemory()}>
                      确认保存
                    </button>
                  </div>
                </div>
              )}
              <details
                className={styles.testDetails}
                open={testMode}
                onToggle={(e) =>
                  setTestMode((e.currentTarget as HTMLDetailsElement).open)
                }
              >
                <summary>软件联调工具（模拟）</summary>
                <p>仅用于验证预览、保存和删除流程，不会调用 T5 摄像头。</p>
                {!token && (
                  <button disabled={busy} onClick={invite}>
                    创建模拟测试
                  </button>
                )}
                {token && (
                  <button
                    className={styles.testButton}
                    disabled={busy}
                    onClick={() => void preview()}
                  >
                    生成标记为模拟的预览
                  </button>
                )}
              </details>
            </section>
            <section
              id="settings"
              className={`${styles.card} ${styles.settingsCard}`}
            >
              <div className={styles.cardHeading}>
                <div>
                  <span className={styles.kicker}>04 · 温柔一点</span>
                  <h2>贴心小设置</h2>
                </div>
              </div>
              <div className={styles.settingRow}>
                <div>
                  <strong>开门主动招呼</strong>
                  <small>硬件传感器未接入前只保存偏好</small>
                </div>
                <input
                  type="checkbox"
                  checked={yard.settings.proactiveVoice}
                  onChange={(e) =>
                    void run(() =>
                      api("/api/yard/settings", {
                        method: "PATCH",
                        body: JSON.stringify({
                          listening: yard.settings.listening,
                          silent: yard.settings.silent,
                          proactiveVoice: e.target.checked,
                        }),
                      }),
                    )
                  }
                />
              </div>
              <div className={styles.settingRow}>
                <div>
                  <strong>开门后短时接话</strong>
                  <small>当前 T5 免唤醒采录未通过实机验证</small>
                </div>
                <input
                  type="checkbox"
                  checked={yard.settings.listening}
                  onChange={(e) =>
                    void run(() =>
                      api("/api/yard/settings", {
                        method: "PATCH",
                        body: JSON.stringify({
                          proactiveVoice: yard.settings.proactiveVoice,
                          silent: yard.settings.silent,
                          listening: e.target.checked,
                        }),
                      }),
                    )
                  }
                />
              </div>
              <div className={styles.settingRow}>
                <div>
                  <strong>安静模式</strong>
                  <small>不自动播放主动语音</small>
                </div>
                <input
                  type="checkbox"
                  checked={yard.settings.silent}
                  onChange={(e) =>
                    void run(() =>
                      api("/api/yard/settings", {
                        method: "PATCH",
                        body: JSON.stringify({
                          proactiveVoice: yard.settings.proactiveVoice,
                          listening: yard.settings.listening,
                          silent: e.target.checked,
                        }),
                      }),
                    )
                  }
                />
              </div>
              <div className={styles.ttsForm}>
                <h3>语音服务</h3>
                <p>
                  ASR 独立读取服务端配置：{yard.tts.asrProvider}
                  。密钥留在服务器。
                </p>
                <label>
                  动态 TTS 方案
                  <select
                    value={tts.provider}
                    onChange={(e) =>
                      setTts({ ...tts, provider: e.target.value })
                    }
                  >
                    <option value="disabled">未配置</option>
                    <option
                      value="bailian"
                      disabled={!yard.tts.cloudKeyConfigured}
                    >
                      百炼云端
                    </option>
                    <option
                      value="local-http"
                      disabled={!yard.tts.localTtsConfigured}
                    >
                      本地主机 HTTP
                    </option>
                  </select>
                </label>
                <div className={styles.ttsInputs}>
                  <label>
                    模型
                    <input
                      value={tts.model}
                      onChange={(e) =>
                        setTts({ ...tts, model: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    音色
                    <input
                      value={tts.voice}
                      onChange={(e) =>
                        setTts({ ...tts, voice: e.target.value })
                      }
                    />
                  </label>
                </div>
                {tts.provider === "local-http" && (
                  <label>
                    速度 · 0.5—2
                    <input
                      type="number"
                      min="0.5"
                      max="2"
                      step="0.1"
                      value={tts.speed}
                      onChange={(e) =>
                        setTts({ ...tts, speed: Number(e.target.value) })
                      }
                    />
                  </label>
                )}
                {tts.provider === "bailian" && (
                  <small>
                    当前 HTTP
                    模式不额外发送速度/风格参数，具体能力由所选模型决定。
                  </small>
                )}
                <div className={styles.ttsActions}>
                  <button
                    className={styles.secondaryButton}
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        api("/api/yard/tts", {
                          method: "PATCH",
                          body: JSON.stringify(tts),
                        }),
                      )
                    }
                  >
                    保存语音配置
                  </button>
                  <button
                    className={styles.secondaryButton}
                    disabled={busy || tts.provider === "disabled"}
                    onClick={() => void audition()}
                  >
                    试听当前音色
                  </button>
                  <button
                    className={styles.textButton}
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        api("/api/yard/tts/reset", { method: "POST" }),
                      )
                    }
                  >
                    恢复默认
                  </button>
                </div>
                {ttsAudio && (
                  <audio
                    className={styles.audioPlayer}
                    controls
                    src={ttsAudio}
                    aria-label="TTS 语音试听"
                  />
                )}
              </div>
            </section>
          </div>
        )}
        {yard && (
          <section
            id="memories"
            className={`${styles.card} ${styles.memories}`}
          >
            <div className={styles.cardHeading}>
              <div>
                <span className={styles.kicker}>05 · 家庭共同记忆</span>
                <h2>暖暖回忆卡</h2>
              </div>
              <span className={styles.pill}>只保存用户确认的内容</span>
            </div>
            {yard.memories.length ? (
              <div className={styles.memoryGrid}>
                {yard.memories.map((memory) => (
                  <article className={styles.memory} key={memory.id}>
                    <img src={memory.photoUrl} alt={memory.title} />
                    <div>
                      <small>
                        {new Date(memory.createdAt).toLocaleString("zh-CN")}
                        {memory.source === "simulated" ? " · 模拟" : " · 设备"}
                      </small>
                      <h3>{memory.title}</h3>
                      <p>和 {memory.roleName} 的一段暖暖的回忆</p>
                      <button
                        className={styles.deleteButton}
                        onClick={() =>
                          void run(() =>
                            api(`/api/yard/memories/${memory.id}`, {
                              method: "DELETE",
                            }),
                          )
                        }
                      >
                        删除这张回忆
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className={styles.emptyMemory}>
                <span>♡</span>
                <p>第一张合影，等我们一起留下。</p>
                <small>
                  只有明确同意并确认保存后，照片才会留在本机私有目录。
                </small>
              </div>
            )}
          </section>
        )}
        <div id="avatar-settings">
          <AvatarPanel />
          <FoodPanel />
          <ModelPanel />
          <OfflinePhotos />
        </div>
        <footer className={styles.footer}>
          <span>暖暖的家 V1.1 · 新产品状态独立保存</span>
          <a href="#overview">回到顶部 ↑</a>
        </footer>
      </div>
    </main>
  );
}
