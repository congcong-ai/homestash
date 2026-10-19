"use client";
import { useState } from "react";
const scenes = [
  { tab: "买菜回家", prompt: "刚买了番茄、鸡蛋和草莓。", title: "新鲜到家，记住啦。", rows: [["🍅", "番茄", "2 个"], ["🥚", "鸡蛋", "10 个"], ["🍓", "草莓", "1 盒"]], note: "留点时间，给生活。", badge: "库存 +3", icon: "✳" },
  { tab: "别放到忘记", prompt: "冰箱里，什么要先吃？", title: "今天，先宠爱草莓。", rows: [["🍓", "草莓", "建议先吃"], ["🥛", "牛奶", "已开封"], ["🥬", "绿叶菜", "看看日期"]], note: "少一点浪费，多一点新鲜。", badge: "新鲜提醒", icon: "♡" },
  { tab: "今晚吃什么", prompt: "今晚两个人，吃点什么？", title: "就做一盘番茄炒蛋。", rows: [["🍅", "番茄", "家里有"], ["🥚", "鸡蛋", "家里有"], ["🍚", "配碗米饭", "刚刚好"]], note: "用家里的食材，做今天的晚餐。", badge: "晚餐有着落", icon: "↗" },
];
export default function FridgeDemo() {
  const [active, setActive] = useState(0);
  const scene = scenes[active];
  return <div className="fridge-demo"><div className="fridge-stage"><div className="stage-orbit"/><span className="stage-spark spark-one">✳</span><span className="stage-spark spark-two">✴</span><div className="fridge-body"><div className="fridge-seam"/><div className="fridge-handle"/><span className="fridge-label">家的小事，都有回音。</span><div className="magnet"><div className="magnet-top"><span>freshmate <b>✳</b></span><i/> </div><div className="magnet-screen" key={active}><span className="screen-date">你的厨房饭搭子 <span>本地模式</span></span><h3>{scene.title}</h3><div className="screen-rows">{scene.rows.map(([icon, name, amount]) => <div key={name}><span className="food-icon">{icon}</span><strong>{name}</strong><small>{amount}</small></div>)}</div><p>{scene.note}</p></div><div className="magnet-bottom"><div className="speaker-grill"/><span className="magnet-button">✳</span><span className="speaker-light"/></div></div><div className="fridge-sticker"><span>{scene.icon}</span>家的小事<br/>不必全靠记性</div><span className="fridge-brand">HomeStash / 日常的好帮手</span></div><div className="voice-bubble" key={`voice-${active}`}><span className="voice-wave"><i/><i/><i/><i/><i/></span><span>“{scene.prompt}”</span><span className="voice-arrow">↗</span></div><div className="floating-tag"><span>✓</span>{scene.badge}</div><span className="concept-caption">交互概念示意 · 非硬件实拍</span></div><div className="scene-tabs" role="group" aria-label="切换使用场景">{scenes.map((s, i) => <button key={s.tab} type="button" aria-pressed={active === i} onClick={() => setActive(i)}><span>0{i + 1}</span>{s.tab}</button>)}</div></div>;
}
