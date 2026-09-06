"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

export default function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    // Daftarin service worker (buat cache app shell + riwayat lama tetap
    // kebuka pas nggak ada internet)
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // gagal daftar (browser lama/nggak didukung) — biarin aja, app tetap
        // jalan normal, cuma nggak dapet fallback offline
      });
    }

    setIsOffline(!navigator.onLine);
    const goOnline = () => setIsOffline(false);
    const goOffline = () => setIsOffline(true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div className="flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium bg-amber-500/15 text-amber-500 border-b border-amber-500/20 shrink-0">
      <WifiOff size={14} />
      Kamu sedang offline — riwayat chat lama masih bisa dibuka, tapi kirim pesan baru butuh koneksi internet.
    </div>
  );
}
