"use client";
import { useEffect, useRef, useState } from "react";
import { api, createRequestId } from "@homestash/api-client";
import {
  categories,
  categoryNames,
  type ImageReview,
  type ItemInput,
  type Location,
} from "@homestash/domain";
type Editable = {
  candidateId: string;
  selected: boolean;
  name: string;
  category: ItemInput["category"];
  quantity: string;
  unit: string;
  locationId: string;
  bestBeforeAt: string;
  expiresAt: string;
};
const maxBytes = 3 * 1024 * 1024;
async function imageData(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw Error("请选择 JPEG、PNG 或 WebP 图片。");
  if (file.size > 20 * 1024 * 1024)
    throw Error("原图超过20 MB，请选择更小的图片。");
  const read = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(Error("图片读取失败，请重选。"));
      reader.readAsDataURL(blob);
    });
  if (file.size <= maxBytes) return read(file);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw Error("当前浏览器无法处理大图，请选择3 MB内的图片。");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    if (!blob || blob.size > maxBytes)
      throw Error("压缩后仍超过3 MB，请换一张图片。");
    return read(blob);
  } finally {
    URL.revokeObjectURL(url);
  }
}
export function ImageIntake({
  locations,
  selectedId,
  retryId,
  timeZone = "UTC",
  onChanged,
  onViewInventory,
}: {
  locations: Location[];
  selectedId?: string;
  retryId?: string;
  timeZone?: string;
  onChanged: () => Promise<void>;
  onViewInventory: () => void;
}) {
  const [dataUrl, setDataUrl] = useState("");
  const [review, setReview] = useState<ImageReview | null>(null);
  const [history, setHistory] = useState<ImageReview[]>([]);
  const [rows, setRows] = useState<Editable[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<{ dataUrl: string; id: string } | null>(null);
  const retryCompleted = useRef(false);
  const confirmation = useRef<{ signature: string; id: string } | null>(null);
  function open(result: ImageReview, preservePreview = false) {
    if (!preservePreview) setDataUrl("");
    setReview(result);
    confirmation.current = null;
    setRows(
      result.candidates.map((candidate) => ({
        candidateId: candidate.id,
        selected:
          candidate.confidence === "high" &&
          candidate.quantity !== null &&
          candidate.unit !== null,
        name: candidate.name,
        category: candidate.category,
        quantity: candidate.quantity === null ? "" : String(candidate.quantity),
        unit: candidate.unit ?? "",
        locationId:
          candidate.category === "medicine" ||
          candidate.category === "supplement"
            ? "medicine"
            : candidate.category === "cosmetic"
              ? "bathroom"
              : candidate.category === "food"
                ? "fridge"
                : "other",
        bestBeforeAt: candidate.bestBeforeAt ?? "",
        expiresAt: candidate.expiresAt ?? "",
      })),
    );
  }
  useEffect(() => {
    void api<ImageReview[]>("/intake/images")
      .then((results) => {
        setHistory(results);
        const waiting = selectedId
          ? results.find((r) => r.id === selectedId)
          : !retryId
            ? results.find((r) => r.status === "pending")
            : undefined;
        if (waiting) open(waiting);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "候选读取失败"));
  }, [selectedId, retryId]);
  async function refreshDevicePhotos() {
    setBusy(true);
    setError("");
    try {
      const results = await api<ImageReview[]>("/intake/images");
      setHistory(results);
      if (!review || review.status !== "pending") {
        const waiting = results.find((r) => r.status === "pending");
        if (waiting) open(waiting);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "候选读取失败");
    } finally {
      setBusy(false);
    }
  }
  const patch = (id: string, change: Partial<Editable>) =>
    setRows((old) =>
      old.map((row) => (row.candidateId === id ? { ...row, ...change } : row)),
    );
  async function analyze() {
    setBusy(true);
    setError("");
    try {
      if (pending.current?.dataUrl !== dataUrl)
        pending.current = {
          dataUrl,
          id: (!retryCompleted.current && retryId) || createRequestId(),
        };
      const result = await api<ImageReview>("/intake/images", {
        requestId: pending.current.id,
        dataUrl,
      });
      retryCompleted.current = true;
      open(result, true);
      setHistory((old) => [result, ...old.filter((r) => r.id !== result.id)]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "识别失败，库存未改变");
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (!review) return;
    setBusy(true);
    setError("");
    try {
      const items = rows
        .filter((row) => row.selected)
        .map((row) => ({
          candidateId: row.candidateId,
          item: {
            name: row.name,
            category: row.category,
            quantity: Number(row.quantity),
            unit: row.unit,
            locationId: row.locationId,
            bestBeforeAt: row.bestBeforeAt || null,
            expiresAt: row.expiresAt || null,
            source: "camera",
            metadata: {},
          },
        }));
      if (!items.length) throw Error("请至少选择一个需要入库的候选。");
      const signature = JSON.stringify(items);
      if (confirmation.current?.signature !== signature)
        confirmation.current = { signature, id: createRequestId() };
      const result = await api<ImageReview>(
        `/intake/images/${review.id}/confirm`,
        { requestId: confirmation.current.id, items },
      );
      setReview(result);
      setHistory((old) => old.map((r) => (r.id === result.id ? result : r)));
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "确认失败，已保留候选供重试");
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!review) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<ImageReview>(
        `/intake/images/${review.id}/cancel`,
        {},
      );
      setReview(result);
      setHistory((old) => old.map((r) => (r.id === result.id ? result : r)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "取消失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="image-intake">
      <p className="eyebrow">拍一下，确认后记下来</p>
      <h1>拍照入库</h1>
      <p>支持物品照片、包装和购物小票。识别只是候选，核对后才会添加到库存。</p>
      <div className="panel image-upload">
        <label>
          拍照或选择图片
          <input
            aria-label="选择物品图片"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setBusy(true);
              setError("");
              setDataUrl("");
              setReview(null);
              setRows([]);
              void imageData(file)
                .then((value) => {
                  setDataUrl(value);
                  pending.current = null;
                })
                .catch((e) =>
                  setError(e instanceof Error ? e.message : "图片读取失败"),
                )
                .finally(() => setBusy(false));
            }}
          />
        </label>
        {dataUrl && (
          <img
            className="intake-preview"
            src={dataUrl}
            alt="本次待识别的图片"
          />
        )}
        <small>
          点击识别后，图片会发送给你配置的 AI
          服务。大图会先在浏览器压缩；原图不写入数据库。
        </small>
        <button disabled={busy || !dataUrl} onClick={() => void analyze()}>
          {busy ? "正在处理，请稍候…" : "识别图片"}
        </button>
      </div>
      <div className="panel">
        <h2>从冰箱贴拍照</h2>
        <p>
          将物品放入 Korvo 镜头视野，按 MODE
          拍照。设备显示识别完成后，刷新并核对候选，确认前不会入库。
        </p>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void refreshDevicePhotos()}
        >
          刷新设备照片
        </button>
      </div>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      {history.filter((r) => r.status === "pending" && r.id !== review?.id)
        .length > 0 && (
        <div className="panel">
          <h2>继续核对其他图片</h2>
          {history
            .filter((r) => r.status === "pending" && r.id !== review?.id)
            .map((r) => (
              <button
                key={r.id}
                disabled={busy}
                className="secondary"
                onClick={() => open(r)}
              >
                {new Date(r.createdAt).toLocaleString("zh-CN", { timeZone })} ·{" "}
                {r.candidates.length} 个候选
              </button>
            ))}
        </div>
      )}
      {review?.status === "pending" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void confirm();
          }}
        >
          <div className="section-title">
            <h2>
              核对识别结果 <small>{rows.length} 个候选</small>
            </h2>
          </div>
          <p>{review.notes || "请核对物品信息。"}</p>
          {!dataUrl && (
            <small>
              原图未存储，这里恢复的是识别候选，请对照你保留的图片核对。
            </small>
          )}
          {!rows.length && (
            <div className="empty panel">
              这张图片没有识别出可用物品。请换清晰的图片，或使用手动添加。
            </div>
          )}
          {rows.map((row, index) => {
            const candidate = review.candidates.find(
              (c) => c.id === row.candidateId,
            )!;
            return (
              <article className="panel intake-candidate" key={row.candidateId}>
                <label className="row">
                  <input
                    type="checkbox"
                    aria-label={`选择候选${index + 1}`}
                    checked={row.selected}
                    disabled={busy}
                    onChange={(e) =>
                      patch(row.candidateId, { selected: e.target.checked })
                    }
                  />
                  <strong>
                    候选 {index + 1} ·{" "}
                    {candidate.confidence === "high"
                      ? "识别较明确"
                      : candidate.confidence === "medium"
                        ? "请仔细核对"
                        : "不确定，建议对照图片"}
                  </strong>
                </label>
                <p className="intake-evidence">
                  识别依据：{candidate.evidence}
                </p>
                <div className="intake-fields">
                  <label>
                    名称
                    <input
                      aria-label={`候选${index + 1}名称`}
                      value={row.name}
                      disabled={busy || !row.selected}
                      required
                      maxLength={80}
                      onChange={(e) =>
                        patch(row.candidateId, { name: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    类别
                    <select
                      aria-label={`候选${index + 1}类别`}
                      value={row.category}
                      disabled={busy || !row.selected}
                      onChange={(e) =>
                        patch(row.candidateId, {
                          category: e.target.value as Editable["category"],
                        })
                      }
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
                      aria-label={`候选${index + 1}数量`}
                      type="number"
                      min="0.001"
                      max="1000000"
                      step="any"
                      value={row.quantity}
                      placeholder="请确认"
                      disabled={busy || !row.selected}
                      required
                      onChange={(e) =>
                        patch(row.candidateId, { quantity: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    单位
                    <input
                      aria-label={`候选${index + 1}单位`}
                      value={row.unit}
                      placeholder="请确认"
                      maxLength={20}
                      disabled={busy || !row.selected}
                      required
                      onChange={(e) =>
                        patch(row.candidateId, { unit: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    放在哪里
                    <select
                      aria-label={`候选${index + 1}位置`}
                      value={row.locationId}
                      disabled={busy || !row.selected}
                      onChange={(e) =>
                        patch(row.candidateId, { locationId: e.target.value })
                      }
                    >
                      {locations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    建议食用日期
                    <input
                      aria-label={`候选${index + 1}建议日期`}
                      type="date"
                      value={row.bestBeforeAt}
                      disabled={busy || !row.selected}
                      onChange={(e) =>
                        patch(row.candidateId, { bestBeforeAt: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    到期日期
                    <input
                      aria-label={`候选${index + 1}到期日期`}
                      type="date"
                      value={row.expiresAt}
                      disabled={busy || !row.selected}
                      onChange={(e) =>
                        patch(row.candidateId, { expiresAt: e.target.value })
                      }
                    />
                  </label>
                </div>
              </article>
            );
          })}
          <div className="row">
            <button
              type="submit"
              disabled={busy || !rows.some((r) => r.selected)}
            >
              确认添加所选物品
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => void cancel()}
            >
              取消这次识别
            </button>
          </div>
        </form>
      )}
      {review?.status === "confirmed" && (
        <div role="status" className="panel">
          <h2>已确认入库 {review.confirmedItems?.length ?? 0} 项</h2>
          <p>
            {review.confirmedItems
              ?.map((item) => `${item.name} ${item.quantity}${item.unit}`)
              .join("、")}
          </p>
          <button onClick={onViewInventory}>查看家中库存</button>
        </div>
      )}
      {review?.status === "cancelled" && (
        <p className="notice">
          这次识别已取消，库存未改变。可以选择下一张图片。
        </p>
      )}
    </section>
  );
}
