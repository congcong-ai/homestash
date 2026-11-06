import type { Metadata } from "next";
import HackathonLanding from "./landing";
import "./hackathon.css";
export const metadata: Metadata = {
  title: "萌小冰·食灵小院｜文博会 AI 文化造物黑客松",
  description:
    "AI＋文化，一万个回答。萌小冰让厨房里的日常，长成一家人的故事。加入早鸟群，了解体验进展与早鸟优惠。",
  openGraph: {
    title: "萌小冰·食灵小院｜让烟火气，有个会回应的名字",
    description: "文博会 AI 文化造物黑客松 · 早鸟招募",
    images: ["/hackathon/culture-hackathon-poster.png"],
    locale: "zh_CN",
  },
};
export default function Page() {
  return <HackathonLanding />;
}
