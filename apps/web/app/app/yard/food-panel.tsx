"use client";
import { useEffect, useState } from "react";
type Food = {
  settings: {
    enabled: boolean;
    windows: { name: string; start: number; end: number }[];
  };
  entries: { id: string; text: string; meal: string; date: string }[];
};
type Audio = {
  settings: { transcribe: boolean; recognizeSpeaker: boolean };
  items: {
    id: string;
    url: string;
    createdAt: string;
    text?: string;
    analysis: string;
  }[];
};
const time = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const minute = (value: string) =>
  Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
export function FoodPanel() {
  const [food, setFood] = useState<Food>();
  const [audio, setAudio] = useState<Audio>();
  const [status, setStatus] = useState("");
  useEffect(() => {
    Promise.all([
      fetch("/api/yard/food").then((r) => r.json()),
      fetch("/api/yard/recordings").then((r) => r.json()),
    ])
      .then(([f, a]) => {
        setFood(f);
        setAudio(a);
      })
      .catch(() => setStatus("暂时无法读取吃饭小记"));
  }, []);
  async function save(path: string, body: unknown) {
    try {
      const r = await fetch(path, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw Error();
      setStatus("已保存");
    } catch {
      setStatus("保存失败，请检查时间范围后重试");
    }
  }
  return (
    <section
      style={{
        padding: 24,
        background: "#fff8ed",
        borderRadius: 24,
        margin: "24px 0",
      }}
    >
      <h2>今天吃什么</h2>
      <p>
        只留下吃饭的小故事，不计算余量或保质期。饭点使用北京时间，每天每餐最多问一次。
      </p>
      {food && (
        <>
          <label>
            <input
              type="checkbox"
              checked={food.settings.enabled}
              onChange={(e) =>
                setFood({
                  ...food,
                  settings: { ...food.settings, enabled: e.target.checked },
                })
              }
            />
            饭点轻轻问一句
          </label>
          {food.settings.windows.map((w, i) => (
            <div
              key={w.name}
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
                margin: "12px 0",
              }}
            >
              <span>{w.name}</span>
              {(["start", "end"] as const).map((k) => (
                <input
                  aria-label={`${w.name}${k === "start" ? "开始" : "结束"}`}
                  type="time"
                  style={{ minHeight: 44 }}
                  key={k}
                  value={time(w[k])}
                  onChange={(e) => {
                    const windows = food.settings.windows.map((v, n) =>
                      n === i ? { ...v, [k]: minute(e.target.value) } : v,
                    );
                    setFood({
                      ...food,
                      settings: { ...food.settings, windows },
                    });
                  }}
                />
              ))}
            </div>
          ))}
          <button
            style={{ minHeight: 44 }}
            onClick={() => save("/api/yard/food/settings", food.settings)}
          >
            保存饭点
          </button>
          {food.entries
            .slice(-10)
            .reverse()
            .map((v) => (
              <p key={v.id}>
                {v.date} {v.meal}：{v.text}
              </p>
            ))}
        </>
      )}
      <h3>声音回忆</h3>
      <p>
        原录音先保存在设备SD，联网且空闲时上传。转写可产生服务费用，默认关闭；实时接话的语音识别另行配置。
      </p>
      {audio && (
        <>
          <label>
            <input
              type="checkbox"
              checked={audio.settings.transcribe}
              onChange={(e) =>
                setAudio({
                  ...audio,
                  settings: { ...audio.settings, transcribe: e.target.checked },
                })
              }
            />
            对未处理的录音进行AI转写
          </label>
          <p>声纹识人尚未接通，录音暂不自动归属成员。</p>
          <button
            style={{ minHeight: 44 }}
            onClick={() =>
              save("/api/yard/recordings/settings", {
                ...audio.settings,
                recognizeSpeaker: false,
              })
            }
          >
            保存声音回忆设置
          </button>
          {audio.items
            .slice(-10)
            .reverse()
            .map((v) => (
              <div key={v.id}>
                <p>
                  {new Date(v.createdAt).toLocaleString("zh-CN")}{" "}
                  {v.text ?? "未转写"}
                </p>
                <audio
                  controls
                  preload="none"
                  src={v.url}
                  style={{ maxWidth: "100%" }}
                />
              </div>
            ))}
        </>
      )}
      <p role="status">{status}</p>
    </section>
  );
}
