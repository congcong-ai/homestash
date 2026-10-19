import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "FreshMate · 你的厨房饭搭子",
  description: "HomeStash 本地优先家庭库存平台",
  manifest: "/manifest.webmanifest",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
