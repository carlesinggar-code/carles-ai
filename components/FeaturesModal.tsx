"use client";

import {
  X,
  Sparkles,
  Search,
  Image as ImageIcon,
  FileText,
  Mic,
  Volume2,
  RotateCcw,
  Copy,
  Share2,
  Smartphone,
  WifiOff,
  Palette,
} from "lucide-react";

interface FeaturesModalProps {
  onClose: () => void;
}

const FEATURES: { icon: typeof Sparkles; title: string; desc: string }[] = [
  {
    icon: Sparkles,
    title: "AI Ganda (Gemini + Groq)",
    desc: "Otomatis pakai Gemini dulu buat jawaban akurat, kalau lambat/gagal langsung fallback ke Groq yang lebih cepat — tanpa perlu milih manual.",
  },
  {
    icon: Search,
    title: "Info Real-Time",
    desc: "Bisa jawab soal harga, berita, atau jadwal terkini lewat Google Search grounding, lengkap dengan sumber link di bawah jawaban.",
  },
  {
    icon: ImageIcon,
    title: "Baca & Analisis Gambar",
    desc: "Kirim foto soal/tugas, AI langsung bantu kerjakan — bukan cuma deskripsi gambar.",
  },
  {
    icon: FileText,
    title: "Baca Dokumen",
    desc: "PDF, Word, Excel, CSV, dan TXT bisa dilampirkan. PDF hasil scan/foto juga tetap kebaca lewat OCR otomatis.",
  },
  {
    icon: Mic,
    title: "Input Suara",
    desc: "Ngomong langsung, otomatis jadi teks di kotak chat — nggak perlu ketik manual.",
  },
  {
    icon: Volume2,
    title: "Dengarkan Jawaban",
    desc: "Jawaban AI bisa dibacain keras-keras, cocok buat dengerin sambil ngerjain hal lain.",
  },
  {
    icon: RotateCcw,
    title: "Ulangi & Kelola Jawaban",
    desc: "Kurang puas sama jawaban? Klik Ulangi buat generate ulang, atau Salin & Bagikan buat dipakai di tempat lain.",
  },
  {
    icon: Smartphone,
    title: "Bisa Di-install jadi App",
    desc: "Unduh & install langsung ke HP dari menu Pengaturan — nggak perlu buka browser tiap kali.",
  },
  {
    icon: WifiOff,
    title: "Tetap Kebuka Saat Offline",
    desc: "Riwayat chat lama tetap bisa dibuka walau nggak ada internet (kirim pesan baru tetap butuh koneksi).",
  },
  {
    icon: Palette,
    title: "Tema & Bahasa",
    desc: "Ganti warna, mode terang/gelap, dan bahasa (Indonesia/English) sesuai selera, lewat menu Pengaturan.",
  },
];

export default function FeaturesModal({ onClose }: FeaturesModalProps) {
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
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">Fitur Carles.ai</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-black/5"
            aria-label="Tutup"
          >
            <X size={18} />
          </button>
        </div>
        <p className="text-sm opacity-60 mb-5">
          Semua yang bisa dilakukan asisten AI ini.
        </p>

        <div className="space-y-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="flex items-start gap-3 rounded-xl px-4 py-3"
              style={{ backgroundColor: "var(--bg-secondary)" }}
            >
              <div className="w-8 h-8 rounded-lg bg-accent/15 flex items-center justify-center shrink-0 mt-0.5">
                <f.icon size={16} className="text-accent" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium">{f.title}</p>
                <p className="text-xs opacity-60 mt-0.5">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
