import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "诗语映画 · 让文字里的世界动起来",
  description: "古诗与成语，一键变成国风知识动画。",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
