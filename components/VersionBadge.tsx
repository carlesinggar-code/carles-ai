"use client";

import { useLanguage } from "@/context/LanguageContext";
import { APP_VERSION } from "@/lib/version";

/** Label versi kecil di pojok kanan bawah: "ID versi 1.2" / "EN version 1.2". */
export default function VersionBadge() {
  const { lang } = useLanguage();
  const label = lang === "en" ? `EN version ${APP_VERSION}` : `ID versi ${APP_VERSION}`;

  return (
    <div
      className="fixed bottom-1 right-2 z-[5] pointer-events-none select-none text-[10px] leading-none opacity-50"
      style={{ color: "var(--text-secondary)" }}
      aria-label={label}
    >
      {label}
    </div>
  );
}
