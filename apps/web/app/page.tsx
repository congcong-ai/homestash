import Link from "next/link";
import type { Metadata } from "next";
import FridgeDemo from "../components/fridge-demo";
import {
  GithubLink,
  MarketingFooter,
  MarketingHeader,
} from "../components/marketing-shell";
import { faqs, githubUrl } from "../lib/site";
import "./marketing.css";
export const metadata: Metadata = {
  title: "HomeStash · 家的小事，不必全靠记性",
  description:
    "开源的 FreshMate 智能冰箱贴，让食材不被遗忘、晚餐有着落。HomeStash 本地优先，库存数据留在自己家，MIT 协议，无硬件也可使用。",
  openGraph: {
    title: "HomeStash · 家的小事，不必全靠记性",
    description: "记住新鲜，少点浪费。开源、本地优先的家庭物品管理平台。",
    locale: "zh_CN",
    type: "website",
  },
};
export default function Home() {
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        name: "HomeStash",
        alternateName: "FreshMate 智能冰箱贴",
        applicationCategory: "LifestyleApplication",
        operatingSystem: "macOS, Linux",
        description: metadata.description,
        license: "https://opensource.org/license/mit",
        ...(githubUrl ? { codeRepository: githubUrl } : {}),
      },
      {
        "@type": "FAQPage",
        mainEntity: faqs.map((f) => ({
          "@type": "Question",
          name: f.question,
          acceptedAnswer: { "@type": "Answer", text: f.answer },
        })),
      },
    ],
  };
  return (
    <div className="marketing">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <MarketingHeader />
      <main className="m-main">
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow">
              <span />
              一个开源的居家小搭子
            </div>
            <h1>
              家的小事，
              <br />
              不必全靠
              <span className="memory-word">
                记性
                <svg viewBox="0 0 240 24" aria-hidden="true">
                  <path d="M3 17Q92 0 234 12M24 23Q145 10 213 20" />
                </svg>
              </span>
              。
            </h1>
            <p className="hero-description">
              买了什么、什么先吃、今晚做什么。
              <br />
              交给 FreshMate 冰箱贴，
              <br />
              把脑袋腾出来，装点别的快乐。
            </p>
            <div className="hero-actions">
              <GithubLink className="m-button m-button-dark">
                获取源码，自己部署 <span>↗</span>
              </GithubLink>
              <GithubLink className="m-text-link">
                去 GitHub 看看 <span>↗</span>
              </GithubLink>
            </div>
            <div className="hero-trust">
              <span>✳ MIT 开源</span>
              <span>⌂ 数据留在本机</span>
              <span>◌ 不必先买硬件</span>
            </div>
          </div>
          <FridgeDemo />
        </section>
        <div className="m-ticker" aria-label="产品理念">
          <div>
            {[0, 1].map((i) => (
              <span key={i} aria-hidden={i === 1 ? true : undefined}>
                少忘一点 <b>✳</b> 少浪费一点 <b>✳</b> 多一点生活 <b>✳</b>{" "}
                让新鲜有回音 <b>✳</b>{" "}
              </span>
            ))}
          </div>
        </div>
        <section className="moments m-section" id="moments">
          <div className="section-heading">
            <div>
              <span className="eyebrow">小小一贴，刚好用得上</span>
              <h2>
                不是多一个屏幕，
                <br />
                是少几件操心事。
              </h2>
            </div>
            <p>
              从买菜进门，到晚餐上桌。
              <br />
              那些容易忘的小事，有了着落。
            </p>
          </div>
          <div className="moment-grid">
            <article className="moment-card moment-pink">
              <span className="moment-number">01 / 买菜回来</span>
              <div className="moment-art produce" aria-hidden="true">
                <span>🍅</span>
                <span>🥚</span>
                <span>🥬</span>
                <i>记下了 ✓</i>
              </div>
              <h3>袋子放下，记忆接上。</h3>
              <p>
                一句话记下新食材，数量、位置随时查。
                <br />
                逛超市前，先看看家里还有什么。
              </p>
            </article>
            <article className="moment-card moment-yellow">
              <span className="moment-number">02 / 打开冰箱</span>
              <div className="moment-art reminder" aria-hidden="true">
                <span>🍓</span>
                <div>
                  嘿，先吃我。<small>今天先吃 · 日期可调整</small>
                </div>
                <b>↗</b>
              </div>
              <h3>别等忘了，才想起来。</h3>
              <p>
                临期、开封，一眼看见。
                <br />
                让每一份新鲜，都赶得上被喜欢。
              </p>
            </article>
            <article className="moment-card moment-green">
              <span className="moment-number">03 / 到了饭点</span>
              <div className="moment-art dinner" aria-hidden="true">
                <span>🍳</span>
                <i>家里有的，刚好能做。</i>
                <b>✳</b>
              </div>
              <h3>“随便”，终于有了答案。</h3>
              <p>
                用现有食材找晚餐灵感，跟着步骤做。
                <br />
                少纠结一会儿，早点吃上热乎的。
              </p>
            </article>
          </div>
          <p className="section-footnote">
            日期提醒仅供参考，请结合包装与实际状态判断食品安全。
          </p>
        </section>
        <section className="privacy-section m-section" id="open-source">
          <div className="privacy-symbol" aria-hidden="true">
            <span>⌂</span>
            <i>你的家，你做主。</i>
          </div>
          <div className="privacy-copy">
            <span className="eyebrow">开源的，才放心带回家</span>
            <h2>
              家的隐私，
              <br />
              就留在家里。
            </h2>
            <p>
              库存与操作记录保存在本机，不向官方云同步。
              <br />
              源码公开，MIT 协议。你可以查看、修改，
              <br />
              也可以把它变成更适合自己的样子。
            </p>
            <GithubLink className="m-button m-button-dark">
              查看开源项目 <span>↗</span>
            </GithubLink>
            <p className="privacy-detail">
              默认 Mock 模式不调用外部 AI。选择第三方 AI
              或云端语音时，相应文字或音频会发送给所选服务；也可配置自托管的兼容模型。
            </p>
            {!githubUrl && (
              <p className="repo-pending">GitHub 仓库地址待项目维护者提供。</p>
            )}
          </div>
        </section>
        <section className="more-banner">
          <div>
            <span className="eyebrow">从厨房出发，走进整个家</span>
            <h2>
              一个冰箱贴，
              <br />
              只是故事的开始。
            </h2>
            <p>
              日用品、宠物口粮、护肤品……
              <br />
              HomeStash 是一套可以继续生长的通用底座。
            </p>
            <Link href="/applications" className="m-text-link">
              看看更多可能 <span>↗</span>
            </Link>
          </div>
          <div className="more-orbit" aria-hidden="true">
            <span>🧴</span>
            <span>🐈</span>
            <span>🧺</span>
            <b>⌂</b>
          </div>
        </section>
        <section className="faq-section m-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">你可能还想知道</span>
              <h2>先聊几个小问题。</h2>
            </div>
          </div>
          <div className="faq-list">
            {faqs.map((f) => (
              <details key={f.question}>
                <summary>
                  {f.question}
                  <span>＋</span>
                </summary>
                <p>{f.answer}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="final-cta">
          <span>✳</span>
          <h2>
            把小事放下。
            <br />
            把日子过好。
          </h2>
          <GithubLink className="m-button m-button-light">
            在自己家里用起来 ↗
          </GithubLink>
          <p>官网仅作项目介绍 · 下载源码后在本地使用</p>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}
