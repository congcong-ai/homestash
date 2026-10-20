import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "HomeStash · 开源的居家小搭子",
  description:
    "开源、本地优先的家庭物品管理平台。FreshMate 智能冰箱贴，让家的小事不必全靠记性。",
  manifest: "/manifest.webmanifest",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
