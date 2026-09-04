"use client";

import { X, MessageCircle, Sparkles, ExternalLink } from "lucide-react";

interface CreatorModalProps {
  onClose: () => void;
}

// Ganti/tambah link project kamu di sini — tinggal edit array ini,
// bisa lebih atau kurang dari 3.
const PROJECT_LINKS: { label: string; url: string }[] = [
  { label: "Project 1", url: "https://github.com/carlesinggar-code" },
  { label: "Project 2", url: "https://carlesinggar.itch.io/battle-slime" },
  { label: "Project 3", url: "https://suryaabaditransindo.com" },
];

// Format internasional tanpa tanda "+" dan tanpa angka 0 di depan
const WA_NUMBER = "6282338975109";

export default function CreatorModal({ onClose }: CreatorModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl shadow-xl p-6 max-h-[85vh] overflow-y-auto"
        style={{ backgroundColor: "var(--bg-primary)" }}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold">Tentang Pembuat</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-black/5"
            aria-label="Tutup"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col items-center text-center mb-5">
          <div className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-semibold mb-3 text-white bg-accent">
            CI
          </div>
          <p className="font-semibold text-base">Carles Inggar Nur Cahya</p>
          <p className="text-sm opacity-70 mt-1">Pembuat Carles.ai</p>
        </div>

        <div className="space-y-3 mb-5">
          <div
            className="rounded-xl px-4 py-3"
            style={{ backgroundColor: "var(--bg-secondary)" }}
          >
            <p className="text-xs opacity-60 mb-1">Hobi</p>
            <p className="text-sm">
              Menyalurkan kreativitas melalui pengembangan website, game, dan
              aplikasi.
            </p>
          </div>

          <div
            className="rounded-xl px-4 py-3"
            style={{ backgroundColor: "var(--bg-secondary)" }}
          >
            <p className="text-xs opacity-60 mb-1">Motivasi</p>
            <p className="text-sm">
              Luangkan waktu 1-2 jam setiap hari untuk mengembangkan diri —
              orang hebat adalah mereka yang terus mau belajar untuk menjadi
              lebih baik dari hari sebelumnya.
            </p>
          </div>

          <a
            href={`https://wa.me/${WA_NUMBER}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-xl px-4 py-3 transition-opacity hover:opacity-80"
            style={{ backgroundColor: "var(--bg-secondary)" }}
          >
            <MessageCircle size={18} className="shrink-0 text-accent" />
            <div>
              <p className="text-xs opacity-60">WhatsApp</p>
              <p className="text-sm">+{WA_NUMBER}</p>
            </div>
          </a>
        </div>

        <div>
          <p className="text-sm font-medium mb-2 flex items-center gap-1.5">
            <Sparkles size={14} className="text-accent" />
            Kunjungi Project Lainnya
          </p>
          <div className="space-y-2">
            {PROJECT_LINKS.map((p) => (
              <a
                key={p.label}
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between rounded-xl px-4 py-2.5 text-sm transition-opacity hover:opacity-80"
                style={{ backgroundColor: "var(--bg-secondary)" }}
              >
                <span>{p.label}</span>
                <ExternalLink size={14} className="opacity-50" />
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
