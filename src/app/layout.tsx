import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "일손 · 우리 가게 AI 마케팅팀",
  description: "브랜드를 기억하고 글, 이미지, 영상을 만들어 주는 소상공인용 AI 마케팅팀",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full bg-stone-50 text-stone-900">{children}</body>
    </html>
  );
}
