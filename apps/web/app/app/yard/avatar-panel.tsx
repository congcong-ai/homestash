"use client";
import { useEffect, useState } from "react";
import themes from "../../../../../packages/avatar/themes.json";
import styles from "./avatar-panel.module.css";
const states = [
  "陪伴",
  "醒来",
  "倾听",
  "思考",
  "播报",
  "笑眼",
  "惊喜",
  "爱心",
  "困困",
  "生气",
  "拍照",
  "错误",
];
type Config = {
  version: number;
  revision: number;
  theme: number;
  mode: string;
};
export function AvatarPanel() {
  const [config, setConfig] = useState<Config>({
    version: 1,
    revision: 0,
    theme: 0,
    mode: "standard",
  });
  const [state, setState] = useState(0);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    fetch("/api/yard/avatar")
      .then((r) => r.json())
      .then((d) => setConfig(d.config))
      .catch(() => setMessage("主题设置暂不可用"));
  }, []);
  const t = themes[config.theme];
  async function save() {
    setSaving(true);
    try {
      const r = await fetch("/api/yard/avatar", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ theme: config.theme, mode: config.mode }),
      });
      if (!r.ok) throw Error();
      setConfig(await r.json());
      setMessage("已保存，设备空闲轮询后生效");
    } catch {
      setMessage("保存失败，请重试");
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className={styles.panel}>
      <div>
        <h2>小冰的表情衣橱</h2>
        <p>换一种模样，还是陪着你的那个小冰。</p>
        <div className={styles.themes}>
          {themes.map((v, i) => (
            <button
              key={v.id}
              aria-pressed={config.theme === i}
              onClick={() => setConfig({ ...config, theme: i })}
              style={{ borderColor: `#${v.body}` }}
            >
              {v.name}
            </button>
          ))}
        </div>
        <label>
          屏幕布局{" "}
          <select
            value={config.mode}
            onChange={(e) => setConfig({ ...config, mode: e.target.value })}
          >
            <option value="standard">标准 · 角色与回复</option>
            <option value="fullscreen">全屏 · 专心看小冰</option>
          </select>
        </label>
        <p>全屏右上角保留「返回」，随时回到文字与操作。</p>
        <button disabled={saving} onClick={save}>
          {saving ? "正在保存…" : "应用到设备"}
        </button>
        <p role="status">{message}</p>
      </div>
      <div>
        <div className={styles.stage} data-state={state}>
          <svg
            viewBox="0 0 480 320"
            role="img"
            aria-label={`${t.name}，${states[state]}动画示意`}
          >
            <g className={styles.body}>
              <rect
                x="110"
                y="52"
                width="260"
                height="232"
                rx={t.radius}
                fill={`#${t.body}`}
              />
              {[0, 1].map((i) => (
                <g key={i}>
                  <g opacity={state === 7 ? 0 : 1}>
                    <rect
                      className={styles.eye}
                      x={110 + 260 * (i ? 0.68 : 0.32) - t.eyeWidth * 0.75}
                      y="133"
                      width={t.eyeWidth * 1.5}
                      height={
                        state === 8 || state === 5 ? 8 : t.eyeHeight * 1.5
                      }
                      rx={state === 7 ? 8 : t.eyeWidth}
                      fill={state === 7 ? `#${t.accent}` : "white"}
                    />
                    <ellipse
                      className={styles.pupil}
                      cx={110 + 260 * (i ? 0.68 : 0.32)}
                      cy={state === 8 || state === 5 ? 137 : 155}
                      rx={t.eyeWidth / 2}
                      ry={state === 8 || state === 5 ? 3 : t.eyeHeight * 0.55}
                      fill={`#${t.ink}`}
                    />
                    <circle
                      cx={105 + 260 * (i ? 0.68 : 0.32)}
                      cy="146"
                      r={state === 8 || state === 5 ? 0 : 5}
                      fill="white"
                    />
                  </g>
                  {state === 7 && (
                    <path
                      transform={`translate(${110 + 260 * (i ? 0.68 : 0.32) - t.eyeWidth * 0.75} 133) scale(${(t.eyeWidth * 1.5) / 40} ${(t.eyeHeight * 1.5) / 40})`}
                      d="M20 8C2 -7 -8 15 20 40C48 15 38 -7 20 8Z"
                      fill={`#${t.accent}`}
                    />
                  )}
                  <rect
                    x={85 + 260 * (i ? 0.68 : 0.32)}
                    y="203"
                    width="44"
                    height="9"
                    rx="5"
                    fill={`#${t.accent}`}
                  />
                  {state === 9 && (
                    <path
                      d={i ? "M270 116l40 -8" : "M169 108l40 8"}
                      stroke={`#${t.ink}`}
                      strokeWidth="7"
                    />
                  )}
                </g>
              ))}
              <rect
                className={styles.mouth}
                x="225"
                y="211"
                width="30"
                height={state === 6 ? 30 : state === 5 ? 18 : 8}
                rx="12"
                fill={`#${t.ink}`}
              />
            </g>
            <text x="16" y="28" fill={`#${t.ink}`} fontSize="16">
              {states[state]}
            </text>
            {config.mode === "fullscreen" && (
              <text x="408" y="28" fill={`#${t.ink}`} fontSize="16">
                返回
              </text>
            )}
          </svg>
        </div>
        <div className={styles.states}>
          {states.map((v, i) => (
            <button
              aria-pressed={state === i}
              key={v}
              onClick={() => setState(i)}
            >
              {v}
            </button>
          ))}
        </div>
        <small>动画设计预览；设备真实状态由语音、拍照事件驱动。</small>
      </div>
    </section>
  );
}
