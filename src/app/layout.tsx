import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: "AI 智慧批改助手 - 手機無線語音遙控端",
  description: "雙裝置語音標註與 Gemini 3.8 Flash AI 智慧批改系統",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW">
      <body className="antialiased min-h-screen bg-slate-900 text-slate-100 flex flex-col">{children}</body>
    </html>
  );
}
