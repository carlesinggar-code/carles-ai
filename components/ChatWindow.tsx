"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Menu, Settings, Paperclip, X, SquarePen, Mic, MicOff, FileText, ImagePlus, LogIn } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { signIn, useSession, signOut } from "next-auth/react";
import MessageBubble from "./MessageBubble";
import Logo from "./Logo";
import AuthModal from "./AuthModal";
import QuotaModal from "./QuotaModal";
import { resetTimeWIB } from "@/lib/quota";
import { ChatMessage, Conversation } from "@/lib/useChatHistory";
import { useLanguage } from "@/context/LanguageContext";
import { Lang } from "@/lib/translations";

// ---------------------------------------------------------------------
// Teks status saat menunggu jawaban (gaya Claude/Gemini). Teks berganti
// otomatis sesuai lama menunggu. Kalau server melaporkan hal NYATA (misal
// "Mencari di web: harga emas"), teks itu yang ditampilkan menggantikan.
// ---------------------------------------------------------------------
type LoadingKind = "text" | "vision" | "file" | "image";

const PHASES: Record<Lang, Record<LoadingKind, Array<[number, string]>>> = {
  id: {
    text: [
      [0, "Menghubungkan ke Carles.ai..."],
      [2, "Memahami pertanyaan Anda..."],
      [5, "Sedang mencari data terbaru..."],
      [10, "Menganalisis konteks..."],
      [15, "Menyusun jawaban lengkap..."],
      [25, "Hampir selesai, mohon tunggu..."],
    ],
    vision: [
      [0, "Mengunggah gambar ke AI..."],
      [2, "Membaca detail visual..."],
      [6, "Menganalisis isi gambar..."],
      [12, "Menyusun penjelasan..."],
      [20, "Sedang memproses, sebentar lagi..."],
    ],
    file: [
      [0, "Membaca lampiran file..."],
      [3, "Mengekstrak teks dokumen..."],
      [8, "Memahami isi dokumen..."],
      [15, "Menyusun ringkasan/jawaban..."],
      [25, "Masih memproses dokumen besar..."],
    ],
    image: [
      [0, "Menyiapkan kanvas digital..."],
      [3, "Memproses deskripsi gambar..."],
      [8, "Sedang membuat gambar (AI)..."],
      [15, "Menyempurnakan detail & warna..."],
      [25, "Hampir selesai menyusun gambar..."],
    ],
  },
  en: {
    text: [
      [0, "Connecting to Carles.ai..."],
      [2, "Understanding your question..."],
      [5, "Searching for latest data..."],
      [10, "Analyzing context..."],
      [15, "Putting the answer together..."],
      [25, "Almost there, please wait..."],
    ],
    vision: [
      [0, "Uploading image to AI..."],
      [2, "Looking at visual details..."],
      [6, "Understanding image content..."],
      [12, "Writing the explanation..."],
      [20, "Still processing, almost done..."],
    ],
    file: [
      [0, "Reading file attachment..."],
      [3, "Extracting document text..."],
      [8, "Understanding the content..."],
      [15, "Putting the answer together..."],
      [25, "Still working on large document..."],
    ],
    image: [
      [0, "Preparing digital canvas..."],
      [3, "Processing image description..."],
      [8, "Creating the image (AI)..."],
      [15, "Refining details & colors..."],
      [25, "Almost done with the image..."],
    ],
  },
};

function LoadingStatus({
  kind,
  override,
  lang,
}: {
  kind: LoadingKind;
  override: string | null;
  lang: Lang;
}) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => {
      setSeconds(Math.floor((Date.now() - started) / 1000));
    }, 500);
    return () => clearInterval(timer);
  }, []);

  const phases = PHASES[lang][kind];
  let text = phases[0][1];
  for (const [from, label] of phases) {
    if (seconds >= from) text = label;
  }
  if (override) text = override;

  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full bg-accent/15 flex items-center justify-center shrink-0">
        <Logo size={18} withText={false} />
      </div>
      <div
        className="rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2 min-w-0"
        style={{ backgroundColor: "var(--bg-secondary)" }}
      >
        <span className="flex items-center gap-1 shrink-0">
          <span className="typing-dot w-1.5 h-1.5 rounded-full bg-accent inline-block" />
          <span className="typing-dot w-1.5 h-1.5 rounded-full bg-accent inline-block" />
          <span className="typing-dot w-1.5 h-1.5 rounded-full bg-accent inline-block" />
        </span>
        <span
          className="text-sm animate-pulse break-words min-w-0"
          style={{ color: "var(--text-secondary)" }}
          aria-live="polite"
        >
          {text}
        </span>
      </div>
    </div>
  );
}

interface ChatPayloadMessage {
  role: "user" | "assistant";
  content: string;
  image?: string;
  /** Gambar BARU (data URL) — hanya untuk pesan terakhir; server memakainya langsung. */
  imageData?: string;
  imageNotes?: string;
  imageExpired?: boolean;
  file?: { name: string; mimeType: string; data: string };
}

interface ChatResult {
  reply: string;
  image?: string;
  /** Catatan isi gambar dari AI (untuk mengingat gambar setelah file-nya dihapus). */
  notes?: string;
}

interface ChatWindowProps {
  conversation: Conversation | null;
  onNewMessage: (conversationId: string, message: ChatMessage) => void;
  onUpdateMessage: (conversationId: string, messageId: string, content: string) => void;
  onEnsureConversation: () => Promise<string>;
  onNewChat: () => void;
  onOpenSettings: () => void;
  onOpenSidebar: () => void;
}

export default function ChatWindow({
  conversation,
  onNewMessage,
  onUpdateMessage,
  onEnsureConversation,
  onNewChat,
  onOpenSettings,
  onOpenSidebar,
}: ChatWindowProps) {
  const { t, lang } = useLanguage();
  const { data: session } = useSession();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  // Percakapan mana yang sedang menunggu jawaban. Animasi "mengetik"/teks yang
  // mengalir hanya tampil di percakapan ITU, bukan di percakapan lain yang
  // kebetulan sedang dibuka.
  const [sendingConvoId, setSendingConvoId] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<{ name: string; mimeType: string; data: string } | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  // Mode "Buat gambar": kalau aktif, pesan berikutnya dibuatkan GAMBAR (bukan dijawab teks).
  const [imageMode, setImageMode] = useState(false);
  // Jawaban yang sedang mengalir (streaming) — tampil live sebelum disimpan.
  const [streamingText, setStreamingText] = useState("");
  const [statusOverride, setStatusOverride] = useState<string | null>(null);
  const [loadingKind, setLoadingKind] = useState<LoadingKind>("text");
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [quotaModalData, setQuotaModalData] = useState<{ reason: "user_limit" | "global_limit"; kind: "chat" | "image" | "upload" } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  // PENTING: file dokumen SENGAJA TIDAK disimpan permanen di database (cuma
  // nama+tipenya) — isinya cuma dipakai sekali buat diambil sarinya jadi
  // teks. Cache di memori ini yang bikin fitur "Ulangi" masih bisa akses
  // isi file yang sama, selama sesi ini belum di-refresh.
  const attachmentCacheRef = useRef<Map<string, { file?: { name: string; mimeType: string; data: string } }>>(new Map());

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation?.messages.length, loading]);

  // Ikut turun pelan-pelan selagi teks jawaban mengalir
  useEffect(() => {
    if (streamingText) bottomRef.current?.scrollIntoView({ behavior: "auto" });
  }, [streamingText]);

  // Deteksi dukungan Web Speech API (Chrome/Edge). Kalau nggak didukung,
  // tombol mic disembunyikan sekalian daripada bikin bingung.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognition =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setVoiceSupported(!!SpeechRecognition);
  }, []);

  const suggestions = [
    t("suggestion1"),
    t("suggestion2"),
    t("suggestion3"),
    t("suggestion4"),
  ];

  function toggleVoiceInput() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognition =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    if (isRecording) {
      recognitionRef.current?.stop();
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognition = new SpeechRecognition();
    recognition.lang = lang === "en" ? "en-US" : "id-ID";
    recognition.continuous = false;
    recognition.interimResults = true;

    let finalTranscript = "";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interim += transcript;
        }
      }
      setInput((finalTranscript + interim).trim());
    };

    recognition.onerror = () => setIsRecording(false);
    recognition.onend = () => setIsRecording(false);

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  }

  // Foto dari kamera HP bisa 3-8MB+ dalam format asli. Vercel Serverless
  // Function punya limit request body 4.5MB, jadi kita kompres & resize
  // dulu di browser sebelum dijadikan base64 (dikirim ke API).
  const MAX_DIMENSION = 1280;
  const JPEG_QUALITY = 0.8;

  function compressImage(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("Gagal memuat gambar"));
        img.onload = () => {
          let { width, height } = img;
          if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
            if (width > height) {
              height = Math.round((height * MAX_DIMENSION) / width);
              width = MAX_DIMENSION;
            } else {
              width = Math.round((width * MAX_DIMENSION) / height);
              height = MAX_DIMENSION;
            }
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(reader.result as string);
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    });
  }

  // Potong nama file di level STRING (bukan cuma CSS), biar dijamin pendek
  // apapun yang terjadi ke layout di sekitarnya.
  function truncateFilename(name: string, maxLength = 22): string {
    if (name.length <= maxLength) return name;
    const dotIndex = name.lastIndexOf(".");
    const ext = dotIndex > 0 ? name.slice(dotIndex) : "";
    const base = dotIndex > 0 ? name.slice(0, dotIndex) : name;
    const keep = Math.max(maxLength - ext.length - 1, 4);
    return `${base.slice(0, keep)}…${ext}`;
  }

  const DOCUMENT_ACCEPT_TYPES = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "text/csv",
    "text/plain",
  ];
  const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024; // 4MB — jaga-jaga limit body Vercel (4.5MB)

  function readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function handleIncomingFile(file: File) {
    if (!session) {
      setAuthModalOpen(true);
      return;
    }
    if (file.type.startsWith("image/")) {
      try {
        const compressed = await compressImage(file);
        setPendingImage(compressed);
        setPendingFile(null);
      } catch {
        // Fallback: kalau kompresi gagal, pakai file asli (lebih baik daripada
        // gagal total, meskipun berisiko kena limit ukuran).
        const reader = new FileReader();
        reader.onload = () => setPendingImage(reader.result as string);
        reader.readAsDataURL(file);
      }
      return;
    }

    // Dokumen (PDF/Word/Excel/CSV/TXT)
    const isSupported =
      DOCUMENT_ACCEPT_TYPES.includes(file.type) ||
      /\.(pdf|docx?|xlsx?|csv|txt)$/i.test(file.name);
    if (!isSupported) {
      alert("Format file belum didukung. Coba PDF, Word (.docx), Excel (.xlsx), CSV, atau TXT.");
      return;
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      alert("Ukuran file kemaksimalan 4MB. Coba file yang lebih kecil.");
      return;
    }
    const base64 = await readFileAsBase64(file);
    setPendingFile({ name: file.name, mimeType: file.type || "application/octet-stream", data: base64 });
    setPendingImage(null);
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await handleIncomingFile(file);
  }

  // Drag & drop: bisa drag gambar/dokumen langsung dari folder ke area chat
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragCounterRef = useRef(0);

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    dragCounterRef.current += 1;
    if (e.dataTransfer.types.includes("Files")) setIsDraggingOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDraggingOver(false);
    }
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDraggingOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    await handleIncomingFile(file);
  }

  // Kirim ke /api/chat dan baca balasannya yang berupa stream (satu event
  // JSON per baris): status / potongan teks / URL gambar / selesai / error.
  async function requestChat(
    payload: { messages: ChatPayloadMessage[]; lang: Lang; mode: "text" | "image" },
    handlers: { onStatus?: (text: string) => void; onDelta?: (fullText: string) => void } = {}
  ): Promise<ChatResult> {
    let res: Response;
    try {
      res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      // "Failed to fetch" mentah tidak berguna bagi user — biasanya sinyal putus
      // atau koneksi HP sedang jelek.
      throw new Error(
        payload.lang === "en"
          ? "Connection problem. Check your internet and try again."
          : "Koneksi terputus. Periksa internet kamu lalu coba kirim lagi."
      );
    }

    if (!res.ok || !res.body) {
      let message = t("errorMsg");
      let reason: string | undefined;
      let quotaKind: string | undefined;
      try {
        const data = await res.json();
        if (data?.error) message = data.error;
        if (typeof data?.reason === "string") reason = data.reason;
        if (typeof data?.kind === "string") quotaKind = data.kind;
      } catch {
        // biarin pakai pesan default
      }
      // Hanya jatah harian milik user (HTTP 429 dari server kita) yang
      // memunculkan modal "Jatah Harian Habis".
      const httpErr = new Error(message) as Error & {
        quotaReason?: "user_limit" | "global_limit";
        quotaKind?: "chat" | "image" | "upload";
      };
      if (res.status === 429) {
        httpErr.quotaReason = reason === "global_limit" ? "global_limit" : "user_limit";
        httpErr.quotaKind = quotaKind === "image" || quotaKind === "upload" ? quotaKind : "chat";
      }
      throw httpErr;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let reply = "";
    let image: string | undefined;
    let notes: string | undefined;

    function handleLine(line: string) {
      if (!line.trim()) return;
      let ev: { t: string; text?: string; url?: string; message?: string };
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      if (ev.t === "status" && ev.text) {
        handlers.onStatus?.(ev.text);
      } else if (ev.t === "delta" && ev.text) {
        reply += ev.text;
        handlers.onDelta?.(reply);
      } else if (ev.t === "image" && ev.url) {
        image = ev.url;
      } else if (ev.t === "notes" && ev.text) {
        notes = ev.text;
      } else if (ev.t === "error") {
        // Jawaban sudah sebagian tampil? Pertahankan, jangan dibuang gara-gara error di ujung.
        if (reply.trim()) {
          reply += `\n\n⚠️ ${ev.message || t("errorMsg")}`;
          handlers.onDelta?.(reply);
        } else {
          throw new Error(ev.message || t("errorMsg"));
        }
      }
    }

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        handleLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    }
    handleLine(buffer);

    if (!reply && !image) throw new Error(t("errorMsg"));
    return { reply, image, notes };
  }

  // Penjaga anti-dobel: SEBELUM ini, pesan bisa terkirim berkali-kali kalau tombol
  // kirim ditekan lagi saat gambar masih diunggah (state "loading" baru menyala
  // setelah unggah selesai). Hasilnya pesan dobel + banyak percakapan baru.
  const sendingRef = useRef(false);
  const showLoadingHere = loading && (sendingConvoId === null || sendingConvoId === conversation?.id);

  async function handleSend(text?: string) {
    if (sendingRef.current) return;
    sendingRef.current = true;
    try {
      await handleSendInner(text);
    } finally {
      sendingRef.current = false;
      setLoading(false);
    }
  }

  async function handleSendInner(text?: string) {
    const content = (text ?? input).trim();
    if ((!content && !pendingImage && !pendingFile) || loading) return;

    if (imageMode && !session) {
      setAuthModalOpen(true);
      return;
    }

    const sendMode: "text" | "image" = imageMode ? "image" : "text";
    const kind: LoadingKind = imageMode
      ? "image"
      : pendingImage
        ? "vision"
        : pendingFile
          ? "file"
          : "text";

    // Nyalakan status "memproses" SEKARANG (bukan nanti setelah unggah), supaya
    // tombol kirim langsung nonaktif dan tidak bisa ditekan dua kali.
    setLoadingKind(kind);
    setLoading(true);

    const messageId = uuidv4();
    // Gambar yang baru dipilih dikirim LANGSUNG ke server (data URL) supaya
    // dibaca AI tanpa bergantung pada unduhan dari storage.
    const freshImageData = pendingImage ?? undefined;

    // File dokumen SENGAJA TIDAK disimpan permanen (cuma nama+tipenya di
    // database) — isinya udah "diambil sarinya" jadi teks pas dikirim ke
    // AI. Cache di memori ini yang bikin fitur "Ulangi" masih bisa baca
    // ulang isi file yang sama, selama belum refresh halaman.
    if (pendingFile) {
      attachmentCacheRef.current.set(messageId, { file: pendingFile });
    }

    // Gambar: upload ke Supabase Storage dulu → dapet URL publik. URL ini
    // dipakai buat DUA hal — ditampilin permanen di riwayat DAN dibaca
    // Gemini (server yang mengunduhnya dari URL ini).
    let imageUrl: string | undefined;
    if (pendingImage) {
      try {
        const uploadRes = await fetch("/api/upload-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataUrl: pendingImage, lang }),
        });
        const uploadData = await uploadRes.json();
        if (uploadRes.status === 429) {
          // Jatah kirim gambar harian habis — beri tahu, jangan kirim apa-apa.
          alert(uploadData.error);
          setLoading(false);
          return;
        }
        imageUrl = uploadRes.ok ? uploadData.url : undefined;
        if (!uploadRes.ok) console.error("Upload gambar gagal:", uploadData.error);
      } catch (err) {
        // Gagal upload: tetap lanjut — gambar dibaca AI langsung dari kiriman
        // ini, hanya saja tidak tersimpan di riwayat.
        console.error("Upload gambar gagal:", err);
      }
    }

    const convoId = conversation?.id ?? (await onEnsureConversation());

    const userMessage: ChatMessage = {
      id: messageId,
      role: "user",
      content: content || (pendingFile ? `(file terlampir: ${pendingFile.name})` : "(gambar terlampir)"),
      image: imageUrl,
      file: pendingFile ? { name: pendingFile.name, mimeType: pendingFile.mimeType } : undefined,
      createdAt: Date.now(),
    };
    onNewMessage(convoId, userMessage);
    setInput("");
    setPendingImage(null);
    setPendingFile(null);
    setStreamingText("");
    setStatusOverride(null);
    setLoadingKind(kind);
    setSendingConvoId(convoId);
    setLoading(true);

    try {
      const fullHistory = [...(conversation?.messages ?? []), userMessage];
      const lastIndex = fullHistory.length - 1;
      const cachedFile = attachmentCacheRef.current.get(messageId)?.file;
      const history: ChatPayloadMessage[] = fullHistory.map((m, i) => ({
        role: m.role,
        content: m.content,
        // Semua gambar di riwayat dikirim (URL-nya saja, ringan) — server
        // yang memilih beberapa terbaru untuk dibaca ulang Gemini.
        image: m.image,
        imageNotes: m.imageNotes,
        imageExpired: m.imageExpired,
        // Gambar baru + file dokumen cuma disertakan buat pesan TERAKHIR.
        imageData: i === lastIndex ? freshImageData : undefined,
        file: i === lastIndex ? cachedFile : undefined,
      }));

      const result = await requestChat(
        { messages: history, lang, mode: sendMode },
        { onStatus: setStatusOverride, onDelta: setStreamingText }
      );

      const assistantMessage: ChatMessage = {
        id: uuidv4(),
        role: "assistant",
        content: result.reply || t("errorMsg"),
        image: result.image,
        imageNotes: result.notes,
        createdAt: Date.now(),
      };
      onNewMessage(convoId, assistantMessage);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      
      // Modal HANYA untuk jatah harian user dari server kita (HTTP 429).
      // Error kuota dari Google/Gemini tampil apa adanya di bubble chat, supaya
      // tidak salah dikira "jatah chat kamu habis".
      const qe = err as { quotaReason?: "user_limit" | "global_limit"; quotaKind?: "chat" | "image" | "upload" } | null;
      if (qe?.quotaReason) {
        setQuotaModalData({ reason: qe.quotaReason, kind: qe.quotaKind ?? "chat" });
      } else {
        const assistantMessage: ChatMessage = {
          id: uuidv4(),
          role: "assistant",
          content: `⚠️ ${msg || t("errorMsg")}`,
          createdAt: Date.now(),
        };
        onNewMessage(convoId, assistantMessage);
      }
    } finally {
      setStreamingText("");
      setStatusOverride(null);
      setLoading(false);
      setSendingConvoId(null);
    }
  }

  // Fitur "Ulangi": kirim ulang pesan user sebelum pesan AI ini, lalu ganti
  // isi jawaban AI yang lama di tempat (bukan nambah pesan baru).
  async function handleRegenerate(messageId: string) {
    if (!conversation || regeneratingId) return;
    const idx = conversation.messages.findIndex((m) => m.id === messageId);
    if (idx <= 0) return;

    const historyUpTo = conversation.messages.slice(0, idx);
    const lastIndex = historyUpTo.length - 1;
    const lastMessage = historyUpTo[lastIndex];
    const cachedFile = attachmentCacheRef.current.get(lastMessage?.id)?.file;
    const history: ChatPayloadMessage[] = historyUpTo.map((m, i) => ({
      role: m.role,
      content: m.content,
      image: m.image,
      imageNotes: m.imageNotes,
      imageExpired: m.imageExpired,
      file: i === lastIndex ? cachedFile : undefined,
    }));

    setRegeneratingId(messageId);
    try {
      const result = await requestChat({ messages: history, lang, mode: "text" });
      onUpdateMessage(conversation.id, messageId, result.reply || t("errorMsg"));
    } catch (err) {
      // Jawaban lama TETAP dipertahankan (sebelumnya ditimpa teks error, jadi
      // jawaban yang bagus hilang). Jatah habis → modal; error lain → bubble baru.
      const qe = err as { quotaReason?: "user_limit" | "global_limit"; quotaKind?: "chat" | "image" | "upload" } | null;
      if (qe?.quotaReason) {
        setQuotaModalData({ reason: qe.quotaReason, kind: qe.quotaKind ?? "chat" });
      } else {
        onNewMessage(conversation.id, {
          id: uuidv4(),
          role: "assistant",
          content: `⚠️ ${err instanceof Error && err.message ? err.message : t("errorMsg")}`,
          createdAt: Date.now(),
        });
      }
    } finally {
      setRegeneratingId(null);
    }
  }

  return (
    <div
      className="relative flex flex-col h-full flex-1 min-w-0"
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {authModalOpen && <AuthModal onClose={() => setAuthModalOpen(false)} lang={lang} />}
      {quotaModalData && (
        <QuotaModal
          onClose={() => setQuotaModalData(null)}
          lang={lang}
          reason={quotaModalData.reason}
          kind={quotaModalData.kind}
          isGuest={!session}
          resetTime={resetTimeWIB()}
        />
      )}
      {isDraggingOver && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none border-4 border-dashed rounded-lg m-2"
          style={{ borderColor: "var(--accent)", backgroundColor: "rgba(37, 99, 235, 0.1)" }}
        >
          <div
            className="px-6 py-4 rounded-2xl text-sm font-medium shadow-lg"
            style={{ backgroundColor: "var(--bg-primary)" }}
          >
            📎 Lepas file di sini untuk melampirkan
          </div>
        </div>
      )}
      {/* Topbar (mobile + desktop header) */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b sticky top-0 z-20 shrink-0"
        style={{ borderColor: "var(--border-color)", backgroundColor: "var(--bg-primary)" }}
      >
        <div className="flex items-center gap-2">
          <button onClick={onOpenSidebar} className="p-1.5 md:hidden">
            <Menu size={20} />
          </button>
          <Logo size={22} className="hidden md:block" />
          <Logo size={22} withText={false} className="md:hidden" />
        </div>

        <div className="flex items-center gap-2">
          <button onClick={onNewChat} className="p-1.5 md:hidden" aria-label="Percakapan baru" title="Percakapan baru">
            <SquarePen size={20} />
          </button>
          
          <div className="h-6 w-px bg-border mx-1 hidden md:block" />

          {session?.user ? (
            <div className="flex items-center gap-3 pl-2">
              <div className="hidden sm:block text-right">
                <p className="text-xs font-medium truncate max-w-[120px]">{session.user.name}</p>
                <button
                  onClick={() => signOut()}
                  className="text-[10px] text-red-500 hover:underline"
                >
                  {lang === "en" ? "Sign out" : "Keluar"}
                </button>
              </div>
              {session.user.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={session.user.image}
                  alt={session.user.name ?? "User"}
                  className="w-8 h-8 rounded-full border border-accent/20"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center text-accent text-xs font-bold">
                  {session.user.name?.[0]?.toUpperCase()}
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={() => signIn("google")}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent text-white text-xs font-medium hover:opacity-90 transition-opacity"
            >
              <LogIn size={14} />
              <span>{lang === "en" ? "Sign In" : "Masuk"}</span>
            </button>
          )}

          <button onClick={onOpenSettings} className="p-1.5 ml-1" aria-label={t("settings")} title={t("settings")}>
            <Settings size={20} />
          </button>
        </div>
      </div>

      {/* Message area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden min-w-0">
        {!conversation || conversation.messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center px-6 text-center">
            <div className="mb-4">
              <Logo size={44} withText={false} />
            </div>
            <h1 className="text-xl font-semibold mb-2">{t("emptyTitle")}</h1>
            <p className="text-sm max-w-md mb-6" style={{ color: "var(--text-secondary)" }}>
              {t("emptySubtitle")}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSend(s)}
                  className="text-left text-sm px-4 py-3 rounded-xl border hover:border-accent hover:text-accent transition-colors"
                  style={{ borderColor: "var(--border-color)" }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-4 py-6 space-y-6 min-w-0">
            {conversation.messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                // Jawaban berupa gambar tidak punya tombol "Ulangi" —
                // cukup minta lagi lewat mode Buat gambar.
                onRegenerate={m.role === "assistant" && !m.image ? handleRegenerate : undefined}
                isRegenerating={regeneratingId === m.id}
              />
            ))}
            {showLoadingHere && streamingText && (
              <MessageBubble
                message={{ id: "streaming", role: "assistant", content: streamingText, createdAt: 0 }}
                streaming
              />
            )}
            {showLoadingHere && !streamingText && (
              <LoadingStatus kind={loadingKind} override={statusOverride} lang={lang} />
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="border-t px-4 py-4" style={{ borderColor: "var(--border-color)" }}>
        <div className="max-w-3xl mx-auto">
          {pendingImage && (
            <div className="relative inline-block mb-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={pendingImage} alt="Preview" className="h-20 rounded-lg border" style={{ borderColor: "var(--border-color)" }} />
              <button
                onClick={() => setPendingImage(null)}
                className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center"
                aria-label={t("removeImage")}
              >
                <X size={12} />
              </button>
            </div>
          )}

          {pendingFile && (
            <div
              className="flex items-center gap-2 mb-2 px-3 py-2 rounded-xl border text-xs w-fit max-w-full min-w-0"
              style={{ borderColor: "var(--border-color)", backgroundColor: "var(--bg-secondary)" }}
            >
              <FileText size={16} className="text-accent shrink-0" />
              <span>{truncateFilename(pendingFile.name)}</span>
              <button
                onClick={() => setPendingFile(null)}
                className="w-4 h-4 rounded-full bg-black/40 text-white flex items-center justify-center shrink-0"
                aria-label="Hapus file"
              >
                <X size={10} />
              </button>
            </div>
          )}

          {imageMode && (
            <div className="flex items-center gap-2 mb-2 text-xs" style={{ color: "var(--text-secondary)" }}>
              <ImagePlus size={14} className="text-accent shrink-0" />
              <span>
                {lang === "en"
                  ? "Create-image mode is on. Describe the image, or attach one to edit it."
                  : "Mode buat gambar aktif. Tulis deskripsi gambarnya, atau lampirkan gambar untuk diedit."}
              </span>
              <button onClick={() => setImageMode(false)} className="underline shrink-0">
                {lang === "en" ? "Turn off" : "Matikan"}
              </button>
            </div>
          )}

          {isRecording && (
            <div className="flex items-center gap-2 mb-2 text-xs" style={{ color: "var(--text-secondary)" }}>
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              Mendengarkan...
            </div>
          )}

          <div
            className="flex items-end gap-2 rounded-2xl border px-3 py-2"
            style={{ borderColor: "var(--border-color)", backgroundColor: "var(--bg-secondary)" }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-2 rounded-xl hover:bg-black/5 transition-colors shrink-0"
              aria-label={t("attachImage")}
              title={t("attachImage")}
            >
              <Paperclip size={18} style={{ color: "var(--text-secondary)" }} />
            </button>

            <button
              onClick={() => {
                if (!session) {
                  setAuthModalOpen(true);
                } else {
                  setImageMode((v) => !v);
                }
              }}
              className={`p-2 rounded-xl transition-colors shrink-0 ${
                imageMode ? "bg-accent text-white" : "hover:bg-black/5"
              }`}
              aria-pressed={imageMode}
              aria-label={lang === "en" ? "Create image" : "Buat gambar"}
              title={lang === "en" ? "Create image" : "Buat gambar"}
            >
              <ImagePlus size={18} style={imageMode ? undefined : { color: "var(--text-secondary)" }} />
            </button>

            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={
                imageMode
                  ? lang === "en"
                    ? "Describe the image you want..."
                    : "Deskripsikan gambar yang kamu mau..."
                  : t("placeholder")
              }
              rows={1}
              className="flex-1 resize-none bg-transparent outline-none text-sm py-1.5 max-h-32"
            />

            {voiceSupported && (
              <button
                onClick={toggleVoiceInput}
                className={`p-2 rounded-xl transition-colors shrink-0 ${
                  isRecording ? "bg-red-500 text-white" : "hover:bg-black/5"
                }`}
                aria-label={isRecording ? "Berhenti merekam" : "Pesan suara"}
                title={isRecording ? "Berhenti merekam" : "Pesan suara"}
              >
                {isRecording ? <MicOff size={18} /> : <Mic size={18} style={{ color: "var(--text-secondary)" }} />}
              </button>
            )}

            <button
              onClick={() => handleSend()}
              disabled={loading || (!input.trim() && !pendingImage && !pendingFile)}
              className="p-2 rounded-xl bg-accent text-white disabled:opacity-40 transition-opacity shrink-0"
              aria-label={t("send")}
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
