import type { Metadata } from "next";
import { SettingsProvider } from "@/components/settings-context";
import { SETTINGS_INIT_SCRIPT } from "@/lib/appearance";
import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "猫咪笔记",
    template: "%s | 猫咪笔记",
  },
  description: "基于 Markdown 的个人在线笔记系统",
  robots: {
    // 笔记属于私有内容，默认不允许搜索引擎索引；分享页单独放行
    index: false,
    follow: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh" suppressHydrationWarning>
      <head>
        {/* 设置首帧前应用（配色/字体/字号/内容宽度/缩放/动效，读 cookie 缓存），避免刷新闪烁；事实源在服务端 .data/settings.json */}
        <script dangerouslySetInnerHTML={{ __html: SETTINGS_INIT_SCRIPT }} />
      </head>
      <body className="antialiased">
        <SettingsProvider>{children}</SettingsProvider>
      </body>
    </html>
  );
}
