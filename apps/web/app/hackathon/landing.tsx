"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";

// 微信群二维码有效期至 2026-11-12 前，活动后须及时更换。
const GROUP_QR_IMAGE: string = "/hackathon/early-bird-group-qr.png";
const stories = [
  {
    number: "01",
    tag: "相遇",
    title: "打开冰箱，也打开一句问候。",
    text: "萌小冰的故事，从厨房里一次平常的相遇开始。让每天匆忙经过的地方，多一点愿意停留的理由。",
    line: "“回来啦，今天有什么新鲜事？”",
    icon: "✦",
  },
  {
    number: "02",
    tag: "共创",
    title: "一颗草莓，有了自己的名字。",
    text: "说说今天的食材，和家人一起给食灵取名、编故事。食物不只有一种吃法，也可以有一万个想象。",
    line: "“那就叫它，莓老板！”",
    icon: "✿",
  },
  {
    number: "03",
    tag: "留念",
    title: "把这一刻，留给以后的我们。",
    text: "在愿意的时候留一张合影，让食灵陪着家人出现在回忆卡里。日子很普通，也值得被记住。",
    line: "“这张，就叫周末的小幸福吧。”",
    icon: "▧",
  },
];
export default function HackathonLanding() {
  const [selected, setSelected] = useState(1);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current;
    const restore = () => {
      document.body.style.overflow = "";
    };
    el?.addEventListener("close", restore);
    return () => {
      restore();
      el?.removeEventListener("close", restore);
    };
  }, []);
  const open = () => {
    dialog.current?.showModal();
    document.body.style.overflow = "hidden";
  };
  return (
    <div className="hackathon">
      <header className="hk-header">
        <Link href="/hackathon" className="hk-brand">
          <span className="hk-brand-icon">✳</span>
          <span>
            萌小冰<small>食灵小院</small>
          </span>
        </Link>
        <nav aria-label="页面导航">
          <a href="#story">认识小院</a>
          <a href="#culture">AI × 文化</a>
          <button onClick={open} className="hk-nav-cta">
            早鸟登记 <span>↗</span>
          </button>
        </nav>
      </header>
      <main>
        <section className="hk-hero">
          <div className="hk-hero-grid" aria-hidden="true" />
          <div className="hk-hero-copy">
            <p className="hk-kicker">
              <span /> 文博会 · AI 文化造物黑客松
            </p>
            <h1>
              让烟火气，
              <br />
              有个会回应的<span className="hk-pink">名字。</span>
            </h1>
            <p className="hk-lead">
              冰箱上的小伙伴，厨房里的想象力。
              <br />
              和萌小冰一起，把一日三餐过成一家人的故事。
            </p>
            <div className="hk-actions">
              <button className="hk-button" onClick={open}>
                早鸟登记 · 进群享优惠 <span>↗</span>
              </button>
              <a href="#story" className="hk-outline">
                走进食灵小院 <span>↓</span>
              </a>
            </div>
            <p className="hk-note">加入早鸟群，优先了解产品体验与优惠信息</p>
          </div>
          <div className="hk-art" aria-label="萌小冰食灵角色概念示意">
            <div className="hk-orbit orbit-one" />
            <div className="hk-orbit orbit-two" />
            <span className="hk-float-label label-top">
              ✦ 一万个回答里，有我们的日常
            </span>
            <div className="hk-device">
              <div className="hk-device-top">
                <span>萌小冰 · 食灵小院</span>
                <i />
              </div>
              <div className="hk-device-screen">
                <span className="hk-screen-tag">今天，也有小小的快乐</span>
                <div className="hk-spirit">
                  <div className="hk-leaves">✦</div>
                  <span className="hk-eye left" />
                  <span className="hk-eye right" />
                  <span className="hk-cheek cl" />
                  <span className="hk-cheek cr" />
                  <span className="hk-mouth" />
                  <span className="hk-seed s1" />
                  <span className="hk-seed s2" />
                  <span className="hk-seed s3" />
                </div>
                <strong>你好呀，我是莓老板。</strong>
                <span>今天的故事，我们一起写。</span>
              </div>
              <div className="hk-device-bottom">
                <span>◉</span>
                <i />
                <span>✦</span>
              </div>
            </div>
            <div className="hk-memory">
              <span>✿</span>
              <div>
                家庭回忆 +1<small>普通的一天，也值得收藏</small>
              </div>
            </div>
            <span className="hk-art-caption">产品概念示意 · 开发中</span>
          </div>
          <div className="hk-hero-bottom">
            <span>2026.11.05 — 11.08</span>
            <span>杭州 · 白马湖</span>
            <a
              href="https://ai.builderlab.cn/activities/5037"
              target="_blank"
              rel="noreferrer"
            >
              查看活动官方页 ↗
            </a>
          </div>
        </section>
        <div className="hk-marquee" aria-hidden="true">
          AI ＋ 文化 <span>✳</span> 一万个回答 <span>✳</span> 让日常长出想象力{" "}
          <span>✳</span> 萌小冰 · 食灵小院 <span>✳</span>
        </div>
        <section id="story" className="hk-section">
          <div className="hk-section-head">
            <div>
              <p className="hk-kicker">01 / 一方小院，三段日常</p>
              <h2>
                家的故事，
                <br />
                从一句话开始。
              </h2>
            </div>
            <p>
              给食材一点想象，给陪伴一个形状。
              <br />
              这些小事，就是我们想做的事。
            </p>
          </div>
          <div className="hk-story-layout">
            <div className="hk-tabs" role="tablist" aria-label="小院故事">
              {stories.map((s, i) => (
                <button
                  key={s.number}
                  id={`story-tab-${i}`}
                  role="tab"
                  aria-selected={selected === i}
                  aria-controls="story-panel"
                  onClick={() => setSelected(i)}
                  className={selected === i ? "hk-tab active" : "hk-tab"}
                >
                  <span>
                    {s.number} / {s.tag}
                  </span>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                  <b>↗</b>
                </button>
              ))}
            </div>
            <div
              className="hk-story-scene"
              id="story-panel"
              role="tabpanel"
              aria-labelledby={`story-tab-${selected}`}
              tabIndex={0}
            >
              <span className="hk-scene-index">
                小院故事 / {stories[selected].tag}
              </span>
              <div className="hk-scene-icon">{stories[selected].icon}</div>
              <blockquote>{stories[selected].line}</blockquote>
              <span>体验叙事示意</span>
            </div>
          </div>
        </section>
        <section id="culture" className="hk-culture hk-section">
          <p className="hk-kicker">02 / AI ＋ 文化，一万个回答</p>
          <h2>
            我们的回答，
            <br />
            藏在每一家的<span className="hk-pink">烟火里。</span>
          </h2>
          <div className="hk-culture-copy">
            <p>
              文化也在饭桌边，在给一道菜起的小名里，在一家人共享的日常里。我们想用
              AI，把这些容易错过的瞬间，变成可以回应、可以共创、可以回看的小故事。
            </p>
            <p>
              萌小冰·食灵小院，是我们在这次文博会黑客松里交出的一份回答。它还在生长，邀请你来一起完成。
            </p>
          </div>
          <div className="hk-poster">
            <img
              src="/hackathon/culture-hackathon-poster.png"
              alt="AI 文化造物黑客松活动海报：AI＋文化，一万个回答；2026 年 11 月 5 日至 8 日，杭州白马湖"
              loading="lazy"
            />
          </div>
          <p className="hk-poster-credit">
            活动信息与视觉来自本次活动海报 ·{" "}
            <a
              href="https://ai.builderlab.cn/activities/5037"
              target="_blank"
              rel="noreferrer"
            >
              活动详情 ↗
            </a>
          </p>
        </section>
        <section id="early-bird" className="hk-early hk-section">
          <div>
            <p className="hk-kicker">03 / 小院初开，等你来坐坐</p>
            <h2>
              第一批邻居，
              <br />
              先来，先认识。
            </h2>
            <p>
              现在加入早鸟群，享早鸟优惠。
              <br />
              一起关注小院的进展，也把你的想法带给我们。
            </p>
            <button onClick={open} className="hk-button">
              早鸟登记 · 查看进群方式 <span>↗</span>
            </button>
            <small>具体价格、发售时间与权益以群内正式公布为准。</small>
          </div>
          <div className="hk-ticket">
            <span>萌小冰 · 食灵小院</span>
            <strong>
              早鸟
              <br />
              <em>邀请函</em>
            </strong>
            <div>
              给未来的小院邻居 <span>↗</span>
            </div>
          </div>
        </section>
        <section className="hk-faq hk-section">
          <h2>你可能还想知道</h2>
          <details>
            <summary>现在可以购买了吗？</summary>
            <p>
              当前开放早鸟进群意向登记，暂不在此页面收款。进群后可了解后续体验安排与正式价格。
            </p>
          </details>
          <details>
            <summary>页面里的体验都能在实机上使用了吗？</summary>
            <p>
              目前为 V1.1
              开发版本，页面演示为产品概念示意。相机、真实门触发与声纹等硬件体验仍需实机验证；具体开放能力以体验通知为准。
            </p>
          </details>
          <details>
            <summary>早鸟登记需要填写什么？</summary>
            <p>
              点击按钮查看进群方式即可，本页不收集手机号。扫描群二维码，即可入群了解早鸟优惠。
            </p>
          </details>
        </section>
      </main>
      <footer className="hk-footer">
        <Link href="/" className="hk-brand">
          ✳ 萌小冰 · 食灵小院
        </Link>
        <span>让日常长出想象力。</span>
        <a href="#early-bird">成为早鸟邻居 ↑</a>
      </footer>
      <dialog
        ref={dialog}
        className="hk-dialog"
        aria-labelledby="early-title"
        onClick={(e) => {
          if (e.target === e.currentTarget) dialog.current?.close();
        }}
      >
        <button
          className="hk-close"
          onClick={() => dialog.current?.close()}
          aria-label="关闭进群弹窗"
        >
          ×
        </button>
        <p className="hk-kicker">小院的第一批邻居</p>
        <h2 id="early-title">进群，解锁早鸟优惠。</h2>
        <p>一起见证萌小冰长大，优先了解体验与优惠信息。</p>
        <div className="hk-qr">
          {GROUP_QR_IMAGE ? (
            <img src={GROUP_QR_IMAGE} alt="萌小冰早鸟交流群二维码" />
          ) : (
            <>
              <span aria-hidden="true">⌗</span>
              <strong>群二维码即将放上</strong>
              <small>此处为占位，暂不可扫码</small>
            </>
          )}
        </div>
        <p className="hk-dialog-note">
          二维码于 11 月 12
          日前有效，请及时扫码。早鸟价格及具体权益，将在群内正式公布。
          <br />
          本页为进群意向入口，不代表已完成报名或购买。
        </p>
        <button className="hk-button" onClick={() => dialog.current?.close()}>
          知道了，先逛逛小院 ↗
        </button>
      </dialog>
    </div>
  );
}
