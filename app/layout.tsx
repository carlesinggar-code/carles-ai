import type { Metadata, Viewport } from "next";
import "./globals.css";
import Providers from "@/components/Providers";

export const metadata: Metadata = {
  title: "Carles.ai — Asisten AI Serba Bisa",
  description: "Carles.ai, asisten AI yang siap membantu apapun yang kamu butuhkan.",
};

// Fallback default (gelap) sebelum ThemeContext sempat jalan di client dan
// nyesuain ke light/dark pilihan user.
export const viewport: Viewport = {
  themeColor: "#16181c",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
