"use client";

import { useState, type FormEvent } from "react";
import styles from "./memory-book.module.css";

type Dated = { id: string; createdAt: string };
type MemoryPhoto = Dated & { title: string; url: string; source: string };
type Album = {
  chapters: {
    day: string;
    paragraphs: string[];
    captions: { id: string; text: string }[];
    generated: boolean;
  }[];
  conversations: (Dated & {
    text: string;
    reply: string;
    simulated: boolean;
  })[];
  photos: MemoryPhoto[];
};

const zone = "Asia/Shanghai";
const dayFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: zone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const timeFormat = new Intl.DateTimeFormat("zh-CN", {
  timeZone: zone,
  hour: "2-digit",
  minute: "2-digit",
});
const dateKey = (date: Date) => dayFormat.format(date);

function preset(days: number) {
  const today = new Date();
  return {
    from: dateKey(new Date(+today - (days - 1) * 86_400_000)),
    to: dateKey(today),
  };
}

function groupByDay<T extends Dated>(items: T[]) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const day = dateKey(new Date(item.createdAt));
    const group = groups.get(day) ?? [];
    group.push(item);
    groups.set(day, group);
  }
  return groups;
}

export function MemoryBook() {
  const [range, setRange] = useState(() => preset(7));
  const [includeTrials, setIncludeTrials] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [book, setBook] = useState<Album | null>(null);
  const [page, setPage] = useState(0);
  const photosByDay = groupByDay(book?.photos ?? []);
  const cards = (book?.chapters ?? []).flatMap((chapter) => {
    const photos = photosByDay.get(chapter.day) ?? [];
    return (photos.length ? photos : [null]).map((photo) => ({
      chapter,
      photo,
    }));
  });
  const current = cards[page];
  const { chapter, photo } = current ?? {};
  const caption =
    chapter && photo
      ? (chapter.captions.find(({ id }) => id === photo.id)?.text ??
        (photosByDay.get(chapter.day)?.length === 1
          ? chapter.paragraphs[0]
          : photo.title.trim().slice(0, 70) || "当天的留影"))
      : chapter?.paragraphs[0];
  const chats = chapter
    ? (groupByDay(book?.conversations ?? []).get(chapter.day) ?? [])
    : [];

  async function generate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setBook(null);
    setPage(0);
    setError("");
    try {
      const query = new URLSearchParams({
        ...range,
        includeTrials: String(includeTrials),
      });
      const response = await fetch(`/api/yard/memory-book?${query}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error();
      setBook((await response.json()) as Album);
    } catch {
      setError("暂时没能生成回忆册，请稍后再试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      id="memory-book"
      className={styles.book}
      aria-labelledby="memory-book-title"
    >
      <div className={styles.cover}>
        <span className={styles.kicker}>家的日记 / 回忆册</span>
        <h2 id="memory-book-title">冰箱拾光</h2>
        <p>随口聊的几句，认真拍的一张。把和小冰相处的日子，收进一本回忆册。</p>
      </div>
      <form onSubmit={generate}>
        <fieldset
          className={styles.controls}
          disabled={busy}
          aria-label="回忆册日期范围"
        >
          <div className={styles.presets}>
            <button type="button" onClick={() => setRange(preset(1))}>
              今天
            </button>
            <button type="button" onClick={() => setRange(preset(7))}>
              最近 7 天
            </button>
          </div>
          <label>
            开始日期
            <input
              required
              type="date"
              value={range.from}
              max={range.to || undefined}
              onChange={(event) =>
                setRange({ ...range, from: event.target.value })
              }
            />
          </label>
          <label>
            结束日期
            <input
              required
              type="date"
              value={range.to}
              min={range.from || undefined}
              onChange={(event) =>
                setRange({ ...range, to: event.target.value })
              }
            />
          </label>
          <button className={styles.generate} type="submit">
            {busy ? "整理中…" : "生成回忆册"}
          </button>
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={includeTrials}
              onChange={(event) => setIncludeTrials(event.target.checked)}
            />
            包含试聊与模拟照片
          </label>
        </fieldset>
      </form>
      {error && (
        <p className={styles.notice} role="alert">
          {error}
        </p>
      )}
      {busy && (
        <p className={styles.notice} role="status">
          正在把对话和照片整理成故事…
        </p>
      )}
      {book && (
        <div className={styles.pages}>
          {!chapter && (
            <p className={styles.notice} role="status">
              这段时间还没有回忆，试试换一段日期。
            </p>
          )}
          {chapter && (
            <>
              <article
                key={`${chapter.day}/${photo?.id ?? ""}`}
                className={styles.day}
                aria-label="回忆卡片"
              >
                {photo && (
                  <img
                    className={styles.photo}
                    src={photo.url}
                    alt={photo.title || "当天的留影"}
                  />
                )}
                <div className={styles.note}>
                  <p className={styles.prose}>{caption}</p>
                  <div className={styles.meta}>
                    <time dateTime={chapter.day}>
                      {new Intl.DateTimeFormat("zh-CN", {
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                        timeZone: zone,
                      }).format(new Date(`${chapter.day}T00:00:00+08:00`))}
                    </time>
                    {photo?.source === "simulated" && <span>模拟照片</span>}
                    {!chapter.generated && <span>记录摘记</span>}
                  </div>
                </div>
              </article>
              {cards.length > 1 && (
                <nav className={styles.pagination} aria-label="回忆册翻页">
                  <button
                    type="button"
                    aria-disabled={page === 0}
                    onClick={() => setPage(Math.max(0, page - 1))}
                  >
                    上一页
                  </button>
                  <span aria-live="polite">
                    第 {page + 1} / {cards.length} 张
                  </span>
                  <button
                    type="button"
                    aria-disabled={page === cards.length - 1}
                    onClick={() =>
                      setPage(Math.min(cards.length - 1, page + 1))
                    }
                  >
                    下一页
                  </button>
                </nav>
              )}
              {!!chats.length && (
                <details key={page} className={styles.records}>
                  <summary>当天的原始对话（{chats.length} 段）</summary>
                  {chats.map((chat) => (
                    <div key={chat.id} className={styles.chat}>
                      <small>
                        {timeFormat.format(new Date(chat.createdAt))}
                        {chat.simulated && " · 试聊"}
                      </small>
                      <p>
                        <strong>我</strong>
                        {chat.text}
                      </p>
                      <p>
                        <strong>小冰</strong>
                        {chat.reply}
                      </p>
                    </div>
                  ))}
                </details>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
