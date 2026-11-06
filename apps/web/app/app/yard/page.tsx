"use client";
import Link from "next/link";
import type { ManagedDevice } from "@homestash/protocol";
import { useCallback, useEffect, useState, type FormEvent } from "react";
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
const rid = () => crypto.randomUUID();
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

export default function YardPage() {
  const [yard, setYard] = useState<Yard | null>(null);
  const [devices, setDevices] = useState<ManagedDevice[]>([]);
  const [deviceError, setDeviceError] = useState("");
  const [checkedAt, setCheckedAt] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [line, setLine] = useState("");
  const [token, setToken] = useState("");
  const [title, setTitle] = useState("今天的小院合影");
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
    setTts(next.tts);
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
          setError("小院状态更新失败，请检查服务连接后刷新页面。");
        });
    }, 15000);
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
        body: JSON.stringify({ text: "莓香一到，小院就热闹起来啦。" }),
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
    return <main className={styles.loading}>正在打开食灵小院…</main>;
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/app/yard">
          <span className={styles.brandIcon}>✳</span>
          <span>
            萌小冰 <small>食灵小院</small>
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
        <nav className={styles.navigation} aria-label="小院后台导航">
          <a href="#overview">小院概览</a>
          <a href="#devices">我的设备</a>
          <a href="#interaction">互动记录</a>
          <a href="#roles">食灵角色</a>
          <a href="#memories">家庭回忆</a>
          <a href="#settings">语音与设置</a>
        </nav>
        <section id="overview" className={styles.hero}>
          <div>
            <span className={styles.eyebrow}>家里的一方小院</span>
            <h1>
              家门一开，
              <br />
              <em>小院醒来了。</em>
            </h1>
            <p>和食灵说说今天的厨房故事，把一起经历的小事，留成家的回忆。</p>
            <div className={styles.heroTags}>
              <span>✦ 共享小院</span>
              <span>✦ 一起养成食灵</span>
              <span>✦ 拍照先征得同意</span>
            </div>
          </div>
          <div className={styles.heroArt} aria-label="草莓食灵插画">
            <div className={styles.sun} />
            <div className={styles.leaf}>✦</div>
            <div className={styles.berry}>🍓</div>
            <div className={styles.house}>⌂</div>
            <div className={styles.artCaption}>
              莓香一到，小院就热闹起来啦。
            </div>
          </div>
        </section>
        {error && (
          <div role="alert" className={styles.error}>
            {error}
            <button onClick={() => setError("")}>知道了</button>
          </div>
        )}
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
                  <h2>今天的小院</h2>
                </div>
                <span className={styles.simTag}>网页模拟器</span>
              </div>
              <p className={styles.subtle}>
                设备开门唤醒目前待传感器接入；这里的文字互动会明确标记为模拟事件。
              </p>
              <div className={styles.chat}>
                <div className={styles.botBubble}>
                  <span>✿ 萌小冰</span>
                  <p>{yard.role.line}</p>
                </div>
                {yard.interactions.slice(-20).map((turn) => (
                  <div className={styles.turn} key={turn.id}>
                    <div className={styles.userBubble}>{turn.text}</div>
                    <div className={styles.botBubble}>
                      <span>
                        ✿ 萌小冰 · {turn.simulated ? "网页模拟" : "设备互动"}
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
                  placeholder="试试：今天买了草莓 / 叫它莓老板"
                  aria-label="输入对食灵说的话"
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
                  <h2>我们的食灵</h2>
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
                      ? "已经在小院安家"
                      : "等一句草莓故事来唤醒"}
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
                  小院招呼语
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
                  “草莓食灵说，酸甜的果香像春末的一阵小风。”这是角色台词，不记录现实食材，也不代表家庭往事。
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
                  {yard.capabilities.cameraReady ? "相机就绪" : "相机未接通"}
                </span>
              </div>
              <p className={styles.subtle}>{yard.capabilities.cameraReason}</p>
              {!token ? (
                <button
                  className={styles.secondaryButton}
                  disabled={busy}
                  onClick={invite}
                >
                  发起一次拍照邀请
                </button>
              ) : (
                <div className={styles.consent}>
                  <strong>这次邀请已发出（90 秒有效）</strong>
                  <div>
                    <button disabled={busy} onClick={() => void consent(true)}>
                      我答应了
                    </button>
                    <button
                      className={styles.quietButton}
                      disabled={busy}
                      onClick={() => void consent(false)}
                    >
                      这次先不了
                    </button>
                  </div>
                </div>
              )}
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
                      重拍并重新确认
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
                <p>
                  仅用于验证许可、预览、重拍、保存和删除流程，不会调用 T5
                  摄像头。
                </p>
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
                  <h2>小院设置</h2>
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
                          ...yard.settings,
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
                          ...yard.settings,
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
                          ...yard.settings,
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
                <h2>小院回忆卡</h2>
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
                      <p>和 {memory.roleName} 的一段小院回忆</p>
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
                <p>小院还没有保存的回忆。</p>
                <small>
                  只有明确同意并确认保存后，照片才会留在本机私有目录。
                </small>
              </div>
            )}
          </section>
        )}
        <footer className={styles.footer}>
          <span>食灵小院 V1.1 · 新产品状态独立保存</span>
          <a href="#overview">回到小院顶部 ↑</a>
        </footer>
      </div>
    </main>
  );
}
