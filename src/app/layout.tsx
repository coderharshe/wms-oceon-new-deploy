import type { Metadata } from "next";
import "./globals.css";
import RegisterServiceWorker from "@/components/RegisterServiceWorker";
import { ThemeApplier } from "@/components/ThemeApplier";

export const metadata: Metadata = {
  title: "OCEON-WMS",
  description: "OCEON-WMS — Wholesale/Retail Warehouse Management System",
  manifest: "/manifest.json",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export const viewport = {
  themeColor: "#1f2937",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Outfit:wght@400;500;600;700&family=Poppins:wght@400;500;600;700&family=Roboto:wght@400;500;700&display=swap"
        />
      </head>
      <body>
        <ThemeApplier />
        <RegisterServiceWorker />
        {children}
      </body>
    </html>
  );
}
