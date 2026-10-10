"use client";

import { LogIn } from "lucide-react";
import { signIn } from "next-auth/react";
import Logo from "./Logo";
import { Lang } from "@/lib/translations";

interface AuthModalProps {
  onClose: () => void;
  lang: Lang;
}

export default function AuthModal({ onClose, lang }: AuthModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div
        className="w-full max-w-sm rounded-2xl shadow-xl border p-8 text-center animate-in fade-in zoom-in duration-200"
        style={{ backgroundColor: "var(--bg-primary)", borderColor: "var(--border-color)" }}
      >
        <div className="flex justify-center mb-6">
          <Logo size={40} withText={false} />
        </div>
        <h2 className="text-xl font-semibold mb-2">
          {lang === "en" ? "Feature restricted" : "Fitur terbatas"}
        </h2>
        <p className="text-sm mb-8" style={{ color: "var(--text-secondary)" }}>
          {lang === "en"
            ? "This feature (Images/Vision/Files) requires signing in with Google."
            : "Fitur ini (Gambar/Vision/File) memerlukan login dengan Google untuk melanjutkan."}
        </p>
        <div className="flex flex-col gap-3">
          <button
            onClick={() => signIn("google")}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl bg-accent text-white font-medium text-sm hover:opacity-90 transition-opacity"
          >
            <LogIn size={18} />
            {lang === "en" ? "Sign in with Google" : "Masuk dengan Google"}
          </button>
          <button
            onClick={onClose}
            className="w-full px-4 py-3 rounded-xl border text-sm font-medium hover:bg-black/5 transition-colors"
            style={{ borderColor: "var(--border-color)" }}
          >
            {lang === "en" ? "Maybe later" : "Mungkin nanti"}
          </button>
        </div>
      </div>
    </div>
  );
}
