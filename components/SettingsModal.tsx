"use client";

import { useEffect, useState } from "react";
import { X, Check, User, Download, ChevronRight } from "lucide-react";
import { useTheme, ColorTheme, Mode } from "@/context/ThemeContext";
import { useLanguage } from "@/context/LanguageContext";
import { Lang } from "@/lib/translations";
import CreatorModal from "./CreatorModal";

interface SettingsModalProps {
  onClose: () => void;
}

export default function SettingsModal({ onClose }: SettingsModalProps) {
  const { colorTheme, setColorTheme, mode, setMode } = useTheme();
  const { lang, setLang, t } = useLanguage();
  const [showCreator, setShowCreator] = useState(false);
  const [apkInfo, setApkInfo] = useState<{ available: boolean; sizeMB?: string } | null>(null);

  useEffect(() => {
    fetch("/api/apk-info", { cache: "no-store" })
      .then((res) => res.json())
      .then(setApkInfo)
      .catch(() => setApkInfo({ available: false }));
  }, []);

  const colorOptions: { id: ColorTheme; label: string; swatch: string }[] = [
    { id: "blue", label: t("blue"), swatch: "#2563eb" },
    { id: "purple", label: t("purple"), swatch: "#7c3aed" },
  ];

  const modeOptions: { id: Mode; label: string; swatch: string }[] = [
    { id: "light", label: t("light"), swatch: "#ffffff" },
    { id: "dark", label: t("dark"), swatch: "#16181c" },
  ];

  const langOptions: { id: Lang; label: string }[] = [
    { id: "id", label: t("indonesian") },
    { id: "en", label: t("english") },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl shadow-xl p-6"
        style={{ backgroundColor: "var(--bg-primary)" }}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold">{t("settings")}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-black/5"
            aria-label={t("close")}
          >
            <X size={18} />
          </button>
        </div>

        {/* Tema Warna */}
        <div className="mb-6">
          <p className="text-sm font-medium mb-3">{t("colorTheme")}</p>
          <div className="grid grid-cols-2 gap-3">
            {colorOptions.map((opt) => (
              <button
                key={opt.id}
                onClick={() => setColorTheme(opt.id)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 transition-colors ${
                  colorTheme === opt.id ? "border-accent" : "border-transparent"
                }`}
                style={{ backgroundColor: "var(--bg-secondary)" }}
              >
                <span
                  className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                  style={{ backgroundColor: opt.swatch }}
                >
                  {colorTheme === opt.id && <Check size={12} className="text-white" />}
                </span>
                <span className="text-sm">{opt.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Mode Tampilan */}
        <div className="mb-6">
          <p className="text-sm font-medium mb-3">{t("displayMode")}</p>
          <div className="grid grid-cols-2 gap-3">
            {modeOptions.map((opt) => (
              <button
                key={opt.id}
                onClick={() => setMode(opt.id)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 transition-colors ${
                  mode === opt.id ? "border-accent" : "border-transparent"
                }`}
                style={{ backgroundColor: "var(--bg-secondary)" }}
              >
                <span
                  className="w-5 h-5 rounded-full border flex items-center justify-center shrink-0"
                  style={{ backgroundColor: opt.swatch, borderColor: "var(--border-color)" }}
                >
                  {mode === opt.id && (
                    <Check
                      size={12}
                      className={opt.id === "dark" ? "text-white" : "text-black"}
                    />
                  )}
                </span>
                <span className="text-sm">{opt.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Bahasa */}
        <div>
          <p className="text-sm font-medium mb-3">{t("language")}</p>
          <div className="grid grid-cols-2 gap-3">
            {langOptions.map((opt) => (
              <button
                key={opt.id}
                onClick={() => setLang(opt.id)}
                className={`px-3 py-2.5 rounded-xl border-2 text-sm transition-colors ${
                  lang === opt.id ? "border-accent text-accent" : "border-transparent"
                }`}
                style={{ backgroundColor: "var(--bg-secondary)" }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        {/* Lainnya */}
        <div className="mt-6 pt-5 border-t" style={{ borderColor: "var(--border-color)" }}>
          <p className="text-sm font-medium mb-3">Lainnya</p>
          <div className="space-y-2">
            <button
              onClick={() => setShowCreator(true)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-opacity hover:opacity-80"
              style={{ backgroundColor: "var(--bg-secondary)" }}
            >
              <User size={18} className="text-accent shrink-0" />
              <span className="text-sm flex-1 text-left">Tentang Pembuat</span>
              <ChevronRight size={16} className="opacity-40" />
            </button>

            {apkInfo?.available ? (
              <a
                href="/carles-ai.apk"
                download="Carles.ai.apk"
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-opacity hover:opacity-80"
                style={{ backgroundColor: "var(--bg-secondary)" }}
              >
                <Download size={18} className="text-accent shrink-0" />
                <span className="text-sm flex-1 text-left">Unduh App</span>
                <span className="text-xs opacity-50">{apkInfo.sizeMB} MB</span>
              </a>
            ) : (
              <div
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl opacity-50"
                style={{ backgroundColor: "var(--bg-secondary)" }}
              >
                <Download size={18} className="shrink-0" />
                <span className="text-sm flex-1 text-left">Unduh App</span>
                <span className="text-xs">Segera hadir</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {showCreator && <CreatorModal onClose={() => setShowCreator(false)} />}
    </div>
  );
}
