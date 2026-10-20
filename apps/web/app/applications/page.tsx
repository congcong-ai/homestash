import Link from "next/link";
import type { Metadata } from "next";
import {
  GithubLink,
  MarketingHeader,
  MarketingFooter,
} from "../../components/marketing-shell";
import "../marketing.css";
export const metadata: Metadata = {
  title: "不止冰箱贴 · HomeStash 的更多可能",
  description:
    "HomeStash 是开源的通用家庭物品管理底座。食品、宠物口粮、日用品、护肤品，共用本地库存、日期提醒与操作记录，MIT 协议。",
};
const applications = [
  {
    icon: "🍅",
    title: "厨房里的新鲜管家",
    text: "买了什么、还有多少、什么先吃。FreshMate 把库存、日期提醒和食谱建议串起来。",
    status: "首个应用 · 已有软件能力",
  },
  {
    icon: "🐈",
    title: "毛孩子的口粮账本",
    text: "猫粮、罐头、零食分别记。数量和开封日期有据可查，补货前先看一眼。",
    status: "现有宠物食品分类可管理",
  },
  {
    icon: "🧴",
    title: "梳妆台的开封备忘",
    text: "精华哪天开的？面霜还剩多少？把日期与数量记下来，少一点遗忘和重复买。",
    status: "现有护肤品分类可管理",
  },
  {
    icon: "🧺",
    title: "储物柜的小账本",
    text: "纸巾、洗衣液、清洁用品，各在什么位置、还有多少，打开就能查。",
    status: "现有日用品分类可管理",
  },
  {
    icon: "🩹",
    title: "家庭药箱的库存卡",
    text: "记录药品、保健品的数量和包装有效期。只管物品，不提供诊断、剂量或服药建议。",
    status: "现有药品与保健品分类可管理",
  },
  {
    icon: "✳",
    title: "你来定义的下一种",
    text: "把同一套物品、位置、事件与设备协议，用在自己的场景。接入新的终端和交互，留给你继续创造。",
    status: "扩展方向 · 需自行开发适配",
  },
];
export default function Applications() {
  return (
    <div className="marketing">
      <MarketingHeader />
      <main className="m-main">
        <section className="applications-hero">
          <span className="eyebrow">同一个底座，装下更多日常</span>
          <h1>
            冰箱贴之外，
            <br />
            还有<em>一整个家</em>。
          </h1>
          <p>
            HomeStash 是一套通用的家庭物品管理底座。
            <br />
            FreshMate 是第一个应用，更多可能，从这里长出来。
          </p>
        </section>
        <section className="application-grid m-section" aria-label="应用场景">
          {applications.map((a) => (
            <article className="application-card" key={a.title}>
              <span className="application-icon" aria-hidden="true">
                {a.icon}
              </span>
              <h2>{a.title}</h2>
              <p>{a.text}</p>
              <span className="capability-tag">{a.status}</span>
            </article>
          ))}
        </section>
        <section className="platform-explainer m-section">
          <span className="eyebrow">给想继续创造的你</span>
          <h2>
            换一种场景，
            <br />
            不用从零开始。
          </h2>
          <div className="platform-steps">
            <div>
              <strong>浏览器 / 设备</strong>
              <small>输入与交互</small>
            </div>
            <b aria-hidden="true">→</b>
            <div>
              <strong>本地核心服务</strong>
              <small>意图解析与物品管理</small>
            </div>
            <b aria-hidden="true">→</b>
            <div>
              <strong>你的数据库</strong>
              <small>库存、位置与操作记录</small>
            </div>
          </div>
          <p className="platform-note">
            现有通用模型支持七类物品；库存、位置、开封和消耗记录可以复用。食谱与做饭流程属于
            FreshMate
            厨房应用。全新的业务流程和硬件需要进一步适配，当前版本以单家庭、本地运行方式使用。
          </p>
          <p className="hardware-note">
            ⌁ 硬件选型、制作与接入说明，后续单独补充。现在可以先从浏览器开始。
          </p>
          <div className="hero-actions">
            <GithubLink className="m-button m-button-dark">
              获取源码，自己部署 ↗
            </GithubLink>
            <GithubLink className="m-text-link">查看源码 ↗</GithubLink>
          </div>
          <Link className="back-link" href="/">
            ← 回到首页
          </Link>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}
