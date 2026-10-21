"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "@homestash/api-client";
import {
  Barcode,
  categories,
  categoryNames,
  type BarcodeReview,
  type Location,
} from "@homestash/domain";

export function BarcodeIntake({
  locations,
  selectedId,
  retryId,
  initialBarcode,
  onChanged,
  onViewInventory,
}: {
  locations: Location[];
  selectedId?: string;
  retryId?: string;
  initialBarcode?: string;
  onChanged: () => Promise<void>;
  onViewInventory: () => void;
}) {
  const [barcode, setBarcode] = useState(initialBarcode ?? "");
  const [review, setReview] = useState<BarcodeReview | null>(null);
  const [history, setHistory] = useState<BarcodeReview[]>([]);
  const [external, setExternal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState({
    name: "",
    category: "food",
    quantity: "",
    unit: "",
    locationId: "fridge",
    expiresAt: "",
    bestBeforeAt: "",
  });
  const lookup = useRef<{ barcode: string; id: string } | null>(null);
  const retryCompleted = useRef(false);
  const confirmation = useRef<{ signature: string; id: string } | null>(null);
  function open(value: BarcodeReview) {
    setReview(value);
    setBarcode(value.barcode);
    confirmation.current = null;
    setDraft({
      name: value.product?.name ?? "",
      category: value.product?.category ?? "food",
      quantity: "",
      unit: "",
      locationId:
        !value.product || value.product.category === "food"
          ? "fridge"
          : ["medicine", "supplement"].includes(value.product.category)
            ? "medicine"
            : value.product.category === "cosmetic"
              ? "bathroom"
              : "other",
      expiresAt: "",
      bestBeforeAt: "",
    });
  }
  useEffect(() => {
    void api<{ externalProvider: string | null; reviews: BarcodeReview[] }>(
      "/intake/barcodes",
    )
      .then((data) => {
        setExternal(data.externalProvider);
        setHistory(data.reviews);
        const waiting = selectedId
          ? data.reviews.find((r) => r.id === selectedId)
          : !retryId
            ? data.reviews.find((r) => r.status === "pending")
            : undefined;
        if (waiting) open(waiting);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "条码记录读取失败"),
      );
  }, [selectedId, retryId]);
  async function perform(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败，库存未改变");
    } finally {
      setBusy(false);
    }
  }
  async function analyze() {
    const parsed = Barcode.safeParse(barcode);
    if (!parsed.success)
      throw Error("请输入校验位正确的8、12、13或14位商品条码。");
    const code = parsed.data;
    if (lookup.current?.barcode !== code)
      lookup.current = {
        barcode: code,
        id: (!retryCompleted.current && retryId) || crypto.randomUUID(),
      };
    const value = await api<BarcodeReview>("/intake/barcodes", {
      barcode: code,
      requestId: lookup.current.id,
    });
    retryCompleted.current = true;
    open(value);
    setHistory((old) => [value, ...old.filter((r) => r.id !== value.id)]);
  }
  async function readPhoto(file: File) {
    if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024)
      throw Error("请选择10MB内的条码照片。");
    type Detector = {
      detect(image: ImageBitmap): Promise<{ rawValue: string }[]>;
    };
    const constructor = (
      window as unknown as {
        BarcodeDetector?: new (options: { formats: string[] }) => Detector;
      }
    ).BarcodeDetector;
    if (!constructor)
      throw Error(
        "此浏览器暂不支持照片读码，请输入包装上的数字，或使用扫码枪。",
      );
    const image = await createImageBitmap(file);
    try {
      const values = [
        ...new Set(
          (
            await new constructor({
              formats: ["ean_13", "ean_8", "upc_a", "itf"],
            }).detect(image)
          )
            .map((r) => r.rawValue)
            .filter((r) => Barcode.safeParse(r).success),
        ),
      ];
      if (values.length !== 1)
        throw Error(
          values.length
            ? "照片里有多个条码，请只拍一个包装。"
            : "没有读到有效商品条码，请输入包装上的数字。",
        );
      setBarcode(values[0]);
      setReview(null);
    } finally {
      image.close();
    }
  }
  function confirm(event: FormEvent) {
    event.preventDefault();
    if (!review) return;
    void perform(async () => {
      const item = {
        ...draft,
        quantity: Number(draft.quantity),
        expiresAt: draft.expiresAt || null,
        bestBeforeAt: draft.bestBeforeAt || null,
        source: "barcode",
        metadata: {},
      };
      const signature = JSON.stringify(item);
      if (confirmation.current?.signature !== signature)
        confirmation.current = { signature, id: crypto.randomUUID() };
      const result = await api<BarcodeReview>(
        `/intake/barcodes/${review.id}/confirm`,
        { requestId: confirmation.current.id, item },
      );
      setReview(result);
      setHistory((old) => old.map((r) => (r.id === result.id ? result : r)));
      await onChanged();
    });
  }
  return (
    <section className="image-intake">
      <p className="eyebrow">扫一扫包装，核对后收好</p>
      <h1>条码入库</h1>
      <p>
        输入包装上的条码数字，或使用扫码枪。查商品不会改变库存，数量和日期请按本次购买填写。
      </p>
      <form
        className="panel image-upload"
        onSubmit={(e) => {
          e.preventDefault();
          void perform(analyze);
        }}
      >
        <label>
          商品条码
          <input
            aria-label="商品条码"
            inputMode="numeric"
            autoComplete="off"
            maxLength={14}
            value={barcode}
            required
            disabled={busy}
            onChange={(e) => {
              setBarcode(e.target.value);
              setReview(null);
            }}
            placeholder="8、12、13或14位数字"
          />
        </label>
        <label>
          也可以拍条码照片
          <input
            type="file"
            aria-label="选择条码照片"
            accept="image/*"
            capture="environment"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void perform(() => readPhoto(file));
              e.target.value = "";
            }}
          />
        </label>
        <small>
          {external
            ? "先查本地记录，未找到时把条码发送给 Open Food Facts；不发送库存或照片。"
            : "当前只查本地商品记录，不向外部服务发送条码。"}{" "}
          照片读码取决于浏览器支持，可随时手动输入。
        </small>
        <button disabled={busy || !barcode}>
          {busy ? "正在处理…" : "查询商品"}
        </button>
      </form>
      {error && (
        <p role="alert" className="alert">
          {error.startsWith("[")
            ? "条码或填写内容不正确，请核对后重试。"
            : error}
        </p>
      )}
      {history.some((r) => r.status === "pending" && r.id !== review?.id) && (
        <div className="panel">
          <h2>继续核对</h2>
          {history
            .filter((r) => r.status === "pending" && r.id !== review?.id)
            .map((r) => (
              <button
                className="secondary"
                key={r.id}
                disabled={busy}
                onClick={() => open(r)}
              >
                {r.product?.name ?? r.barcode}
              </button>
            ))}
        </div>
      )}
      {review?.status === "pending" && (
        <form className="panel" onSubmit={confirm}>
          <h2>{review.product ? "核对商品信息" : "补全这件物品"}</h2>
          <p>{review.note}</p>
          {review.product && (
            <p>
              来源：
              {review.product.source === "local" ? (
                "你此前确认的本地记录"
              ) : (
                <a
                  href={review.product.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Food Facts（ODbL）
                </a>
              )}
              {review.product.brand ? ` · ${review.product.brand}` : ""}
              {review.product.source === "local" &&
                review.product.sourceUrl && (
                  <>
                    {" "}
                    ·{" "}
                    <a
                      href={review.product.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      原始商品资料：Open Food Facts（ODbL）
                    </a>
                  </>
                )}
              {review.product.packageDescription
                ? ` · 包装规格 ${review.product.packageDescription}`
                : ""}
            </p>
          )}
          <p>条码：{review.barcode}</p>
          <div className="intake-fields">
            <label>
              名称
              <input
                aria-label="条码物品名称"
                required
                maxLength={80}
                disabled={busy}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label>
              类别
              <select
                aria-label="条码物品类别"
                disabled={busy}
                value={draft.category}
                onChange={(e) =>
                  setDraft({ ...draft, category: e.target.value })
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
              本次数量
              <input
                aria-label="条码物品数量"
                type="number"
                required
                min="0.001"
                max="1000000"
                step="any"
                disabled={busy}
                value={draft.quantity}
                onChange={(e) =>
                  setDraft({ ...draft, quantity: e.target.value })
                }
              />
            </label>
            <label>
              单位
              <input
                aria-label="条码物品单位"
                required
                maxLength={20}
                placeholder="如盒、瓶、袋"
                disabled={busy}
                value={draft.unit}
                onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
              />
            </label>
            <label>
              放在哪里
              <select
                aria-label="条码物品位置"
                disabled={busy}
                value={draft.locationId}
                onChange={(e) =>
                  setDraft({ ...draft, locationId: e.target.value })
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
                aria-label="条码物品建议日期"
                type="date"
                disabled={busy}
                value={draft.bestBeforeAt}
                onChange={(e) =>
                  setDraft({ ...draft, bestBeforeAt: e.target.value })
                }
              />
            </label>
            <label>
              到期日期
              <input
                aria-label="条码物品到期日期"
                type="date"
                disabled={busy}
                value={draft.expiresAt}
                onChange={(e) =>
                  setDraft({ ...draft, expiresAt: e.target.value })
                }
              />
            </label>
          </div>
          <div className="row">
            <button disabled={busy}>确认添加这件物品</button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  const value = await api<BarcodeReview>(
                    `/intake/barcodes/${review.id}/cancel`,
                    {},
                  );
                  setReview(value);
                  setHistory((old) =>
                    old.map((r) => (r.id === value.id ? value : r)),
                  );
                })
              }
            >
              取消本次入库
            </button>
          </div>
        </form>
      )}
      {review?.status === "confirmed" && (
        <div className="panel" role="status">
          <h2>已确认入库</h2>
          <p>
            {review.confirmedItem?.name} {review.confirmedItem?.quantity}
            {review.confirmedItem?.unit}
          </p>
          <button onClick={onViewInventory}>查看家中库存</button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => {
              lookup.current = null;
              void perform(analyze);
            }}
          >
            再添加一批同款
          </button>
        </div>
      )}
      {review?.status === "cancelled" && (
        <p className="notice">本次已取消，库存未改变。</p>
      )}
    </section>
  );
}
