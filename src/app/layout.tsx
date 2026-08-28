import type { Metadata, Viewport } from "next";
import { Noto_Sans_KR } from "next/font/google";
import { DisableBrowserZoom } from "@/components/layout/DisableBrowserZoom";
import "./globals.css";

const notoSansKr = Noto_Sans_KR({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "ChargerPick · 대구",
  description: "도착했을 때 충전할 수 있는 곳을 찾는 대구 EV 세이프차지",
};

/** Map / auth app: limit browser page zoom (Android). iOS may still allow pinch (a11y). */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={`${notoSansKr.variable} h-full`}>
      <body className="h-full overflow-hidden antialiased">
        <DisableBrowserZoom />
        {children}
      </body>
    </html>
  );
}
