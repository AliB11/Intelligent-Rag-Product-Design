import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "مولد هوشمند محصول بانکی و دوقلوی دیجیتال ALM",
  description:
    "سامانه تولید معکوس محصول بانکی و شبیه‌ساز دوقلوی دیجیتال مدیریت دارایی و بدهی برای زیست‌بوم بانکی ایران",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css"
          crossOrigin="anonymous"
        />
      </head>
      <body className="bg-abyss text-chalk antialiased">
        <div className="pointer-events-none fixed inset-0 z-0 opacity-[0.55] [background-image:linear-gradient(to_right,rgba(120,150,200,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(120,150,200,0.06)_1px,transparent_1px)] [background-size:56px_56px]" />
        <div className="pointer-events-none fixed inset-x-0 top-0 z-0 h-[420px] bg-[radial-gradient(60%_100%_at_50%_0%,rgba(224,178,92,0.14),transparent_70%)]" />
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
