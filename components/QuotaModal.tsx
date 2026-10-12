"use client";

import { AlertCircle, Clock } from "lucide-react";
import { signIn } from "next-auth/react";
import { Lang } from "@/lib/translations";

interface QuotaModalProps {
  onClose: () => void;
  lang: Lang;
  reason: "user_limit" | "global_limit";
  kind?: "chat" | "image" | "upload";
  isGuest: boolean;
  resetTime: string;
}

export default function QuotaModal({ onClose, lang, reason, kind = "chat", isGuest, resetTime }: QuotaModalProps) {
  const isEn = lang === "en";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div
        className="w-full max-w-sm rounded-2xl shadow-xl border p-8 text-center animate-in fade-in zoom-in duration-200"
        style={{ backgroundColor: "var(--bg-primary)", borderColor: "var(--border-color)" }}
      >
        <div className="flex justify-center mb-4 text-amber-500">
          <AlertCircle size={48} />
        </div>
        
        <h2 className="text-xl font-semibold mb-2">
          {kind === "image"
            ? (isEn ? "Daily Image Limit Reached" : "Jatah Gambar Harian Habis")
            : kind === "upload"
              ? (isEn ? "Daily Upload Limit Reached" : "Jatah Kirim Gambar Habis")
              : (isEn ? "Daily Limit Reached" : "Jatah Harian Habis")}
        </h2>
        
        <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>
          {reason === "global_limit"
            ? (isEn ? "The global image quota is exhausted for today." : "Jatah pembuatan gambar global hari ini sudah habis.")
            : kind === "image"
              ? (isEn
                  ? `You've reached your daily image creation limit.${isGuest ? " Sign in to create images." : ""}`
                  : `Kamu telah mencapai batas pembuatan gambar harian.${isGuest ? " Login dulu untuk membuat gambar." : ""}`)
              : kind === "upload"
                ? (isEn ? "You've reached your daily limit for sending images." : "Kamu telah mencapai batas kirim gambar harian.")
                : (isEn
                    ? `You've reached your daily chat limit.${isGuest ? " Guest limit is lower than registered users." : ""}`
                    : `Kamu telah mencapai batas chat harian.${isGuest ? " Jatah tamu lebih sedikit daripada pengguna terdaftar." : ""}`)}
        </p>

        <div className="flex items-center justify-center gap-2 mb-8 text-xs font-medium px-4 py-2 rounded-full bg-accent/10 text-accent w-fit mx-auto">
          <Clock size={14} />
          <span>{isEn ? "Resets at" : "Reset jam"} {resetTime}</span>
        </div>

        <div className="flex flex-col gap-3">
          {isGuest && (
            <button
              onClick={() => signIn("google")}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-accent text-white font-medium text-sm hover:opacity-90 transition-opacity"
            >
              {isEn ? "Sign in for higher limit" : "Login untuk jatah lebih banyak"}
            </button>
          )}
          <button
            onClick={onClose}
            className="w-full px-4 py-3 rounded-xl border text-sm font-medium hover:bg-black/5 transition-colors"
            style={{ borderColor: "var(--border-color)" }}
          >
            {isEn ? "Got it" : "Mengerti"}
          </button>
        </div>
      </div>
    </div>
  );
}
