import type { Metadata, Viewport } from "next";
import "./globals.css";
import Providers from "@/components/Providers";

export const metadata: Metadata = {
  title: "Carles.ai — Asisten AI Serba Bisa",
  description: "Carles.ai, asisten AI yang siap membantu apapun yang kamu butuhkan.",
};

// PENTING: width & initialScale WAJIB ada di sini. Next.js otomatis nyertain
// viewport responsive (width=device-width) secara default, tapi begitu kita
// bikin export "viewport" sendiri (buat themeColor), itu MENGGANTIKAN
// default itu sepenuhnya — kalau nggak disertain manual lagi, HP jadi render
// halaman di lebar virtual desktop (980px) lalu di-zoom out, sehingga semua
// konten kelihatan "kepotong"/nembus di layar kecil.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
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
