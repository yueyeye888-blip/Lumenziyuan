import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lumen 资源申购中心",
  description: "公司内部数字资源统一申购、额度采购、交付与续订平台",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
