import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LogicBench PH — 74LS/74HC breadboard manager & simulator",
  description:
    "Plan a real breadboard pin-for-pin before touching hardware: datasheet-driven chip library, 4-state logic simulator, electrical rule checker, 7-segment decoder labs, K-map tool, and a personal chip inventory.",
  keywords: ["74LS", "74HC", "breadboard", "7-segment", "7447", "4511", "logic simulator", "electronics lab"],
  authors: [{ name: "mlger" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
      </body>
    </html>
  );
}
