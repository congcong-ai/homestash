"use client";
import { useEffect, useState } from "react";
type Models = {
  enabled: boolean;
  chatModel: string;
  asrModel: string;
  ttsModel: string;
  keyConfigured: boolean;
};
export function ModelPanel() {
  const [models, setModels] = useState<Models>();
  const [key, setKey] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => {
    fetch("/api/yard/models")
      .then((r) => r.json())
      .then(setModels)
      .catch(() => setStatus("模型设置暂不可用"));
  }, []);
  async function save() {
    if (!models) return;
    try {
      const { keyConfigured, ...config } = models;
      void keyConfigured;
      const r = await fetch("/api/yard/models", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...config, ...(key ? { apiKey: key } : {}) }),
      });
      if (!r.ok) throw Error();
      setModels(await r.json());
      setKey("");
      setStatus("已保存，下次模型请求使用新配置");
    } catch {
      setStatus("保存失败，请检查配置");
    }
  }
  return (
    <section
      style={{
        padding: 24,
        background: "#eef4fc",
        borderRadius: 24,
        margin: "24px 0",
      }}
    >
      <h2>阿里百炼</h2>
      <p>
        一个API
        Key用于聊天、语音识别与合成。保存后不回显密钥；声音回忆的付费转写由上方独立开关控制。
      </p>
      {models && (
        <>
          <label>
            <input
              type="checkbox"
              checked={models.enabled}
              onChange={(e) =>
                setModels({ ...models, enabled: e.target.checked })
              }
            />
            启用统一百炼配置
          </label>
          <p>
            <label>
              API Key（{models.keyConfigured ? "已配置，留空保留" : "尚未配置"}
              ）
              <input
                type="password"
                autoComplete="new-password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                style={{ maxWidth: "100%", minHeight: 44 }}
              />
            </label>
          </p>
          {(["chatModel", "asrModel", "ttsModel"] as const).map((k, i) => (
            <p key={k}>
              <label>
                {["聊天模型", "识别模型", "合成模型"][i]}{" "}
                <input
                  style={{ maxWidth: "100%", minHeight: 44 }}
                  value={models[k]}
                  onChange={(e) =>
                    setModels({ ...models, [k]: e.target.value })
                  }
                />
              </label>
            </p>
          ))}
          <button style={{ minHeight: 44 }} onClick={save}>
            保存百炼设置
          </button>
        </>
      )}
      <p role="status">{status}</p>
    </section>
  );
}
