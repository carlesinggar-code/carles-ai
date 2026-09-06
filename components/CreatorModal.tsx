"use client";

import {
  X,
  MessageCircle,
  Instagram,
  Linkedin,
  Github,
  Mail,
  Sparkles,
  ExternalLink,
  Clock,
} from "lucide-react";

interface CreatorModalProps {
  onClose: () => void;
}

const PROJECT_LINKS: { label: string; url: string }[] = [
  { label: "Website — Surya Abadi Transindo", url: "https://suryaabaditransindo.com" },
  { label: "Website — Zun Tour & Travel", url: "https://zuntourtravel.smkmodels.id" },
  { label: "Game — Battle Slime", url: "https://carlesinggar.itch.io/battle-slime" },
  { label: "Game — Word Game", url: "https://carlesinggar-code.github.io/word-game/" },
  { label: "App & AI — Carles.ai", url: "https://carles-ai.vercel.app" },
];

const UPCOMING_PROJECTS = [
  { label: "Carles Convert", desc: "Ubah ukuran, format & resolusi gambar/file" },
  { label: "Web Healthy", desc: "Analisis SEO, UI/UX & kecepatan website lain" },
];

const CONTACTS = [
  { label: "Instagram", value: "@carles_inggar", url: "https://www.instagram.com/carles_inggar", icon: Instagram },
  { label: "LinkedIn", value: "carles-inggar", url: "https://www.linkedin.com/in/carles-inggar/", icon: Linkedin },
  { label: "GitHub", value: "carlesinggar-code", url: "https://github.com/carlesinggar-code", icon: Github },
  { label: "Email", value: "carlesinggar@gmail.com", url: "mailto:carlesinggar@gmail.com", icon: Mail },
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
          <p className="text-sm opacity-70 mt-1">Kerap disapa &ldquo;Carles&rdquo; — Pembuat Carles.ai</p>
        </div>

        <div className="space-y-3 mb-5">
          <div
            className="rounded-xl px-4 py-3"
            style={{ backgroundColor: "var(--bg-secondary)" }}
          >
            <p className="text-xs opacity-60 mb-1">Tentang</p>
            <p className="text-sm">
              Punya beragam kreativitas dalam pembuatan website, aplikasi, dan
              game.
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
        </div>

        {/* Kontak */}
        <div className="mb-5">
          <p className="text-sm font-medium mb-2">Bisa disapa lewat</p>
          <div className="space-y-2">
            <a
              href={`https://wa.me/${WA_NUMBER}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-xl px-4 py-3 transition-opacity hover:opacity-80"
              style={{ backgroundColor: "var(--bg-secondary)" }}
            >
              <MessageCircle size={18} className="shrink-0 text-accent" />
              <div className="min-w-0">
                <p className="text-xs opacity-60">WhatsApp</p>
                <p className="text-sm truncate">+{WA_NUMBER}</p>
              </div>
            </a>

            {CONTACTS.map((c) => (
              <a
                key={c.label}
                href={c.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-xl px-4 py-3 transition-opacity hover:opacity-80 min-w-0"
                style={{ backgroundColor: "var(--bg-secondary)" }}
              >
                <c.icon size={18} className="shrink-0 text-accent" />
                <div className="min-w-0">
                  <p className="text-xs opacity-60">{c.label}</p>
                  <p className="text-sm truncate">{c.value}</p>
                </div>
              </a>
            ))}
          </div>
        </div>

        {/* Project yang sudah rilis */}
        <div className="mb-5">
          <p className="text-sm font-medium mb-2 flex items-center gap-1.5">
            <Sparkles size={14} className="text-accent" />
            Project Lainnya
          </p>
          <div className="space-y-2">
            {PROJECT_LINKS.map((p) => (
              <a
                key={p.label}
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-2 rounded-xl px-4 py-2.5 text-sm transition-opacity hover:opacity-80 min-w-0"
                style={{ backgroundColor: "var(--bg-secondary)" }}
              >
                <span className="truncate">{p.label}</span>
                <ExternalLink size={14} className="opacity-50 shrink-0" />
              </a>
            ))}
          </div>
        </div>

        {/* Project yang sedang dikerjakan */}
        <div>
          <p className="text-sm font-medium mb-2 flex items-center gap-1.5">
            <Clock size={14} className="text-accent" />
            Sedang Dikerjakan
          </p>
          <div className="space-y-2">
            {UPCOMING_PROJECTS.map((p) => (
              <div
                key={p.label}
                className="rounded-xl px-4 py-2.5"
                style={{ backgroundColor: "var(--bg-secondary)" }}
              >
                <p className="text-sm font-medium">{p.label}</p>
                <p className="text-xs opacity-60 mt-0.5">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
