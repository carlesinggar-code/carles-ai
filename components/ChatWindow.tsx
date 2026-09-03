"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Menu, Settings, Paperclip, X } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import MessageBubble from "./MessageBubble";
import Logo from "./Logo";
import { ChatMessage, Conversation } from "@/lib/useChatHistory";
import { useLanguage } from "@/context/LanguageContext";

interface ChatWindowProps {
  conversation: Conversation | null;
  onNewMessage: (conversationId: string, message: ChatMessage) => void;
  onEnsureConversation: () => string;
  onOpenSettings: () => void;
  onOpenSidebar: () => void;
}

export default function ChatWindow({
  conversation,
  onNewMessage,
  onEnsureConversation,
  onOpenSettings,
  onOpenSidebar,
}: ChatWindowProps) {
  const { t, lang } = useLanguage();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation?.messages.length, loading]);

  const suggestions = [
    t("suggestion1"),
    t("suggestion2"),
    t("suggestion3"),
    t("suggestion4"),
  ];

  // Foto dari kamera HP bisa 3-8MB+ dalam format asli. Vercel Serverless
  // Function punya limit request body 4.5MB, jadi kita kompres & resize
  // dulu di browser sebelum dijadikan base64 (dikirim ke API).
  const MAX_DIMENSION = 1280;
  const JPEG_QUALITY = 0.7;

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

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) return;

    try {
      const compressed = await compressImage(file);
      setPendingImage(compressed);
    } catch {
      // Fallback: kalau kompresi gagal, pakai file asli (lebih baik daripada
      // gagal total, meskipun berisiko kena limit ukuran).
      const reader = new FileReader();
      reader.onload = () => setPendingImage(reader.result as string);
      reader.readAsDataURL(file);
    }
  }

  async function handleSend(text?: string) {
    const content = (text ?? input).trim();
    if ((!content && !pendingImage) || loading) return;

    const convoId = conversation?.id ?? onEnsureConversation();

    const userMessage: ChatMessage = {
      id: uuidv4(),
      role: "user",
      content: content || "(gambar terlampir)",
      image: pendingImage ?? undefined,
      createdAt: Date.now(),
    };
    onNewMessage(convoId, userMessage);
    setInput("");
    setPendingImage(null);
    setLoading(true);

    try {
      const fullHistory = [...(conversation?.messages ?? []), userMessage];
      const lastIndex = fullHistory.length - 1;
      const history = fullHistory.map((m, i) => ({
        role: m.role,
        content: m.content,
        // Cuma sertakan gambar untuk pesan TERAKHIR. Gambar lama di history
        // nggak perlu dikirim ulang tiap request (AI udah "komentar" soal itu
        // di balasan sebelumnya) — ini yang bikin payload membengkak & error.
        image: i === lastIndex ? m.image : undefined,
      }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, lang }),
      });

      const data = await res.json();

      const replyText: string = res.ok ? data.reply : `⚠️ ${data.error ?? t("errorMsg")}`;

      const assistantMessage: ChatMessage = {
        id: uuidv4(),
        role: "assistant",
        content: replyText || t("errorMsg"),
        createdAt: Date.now(),
      };
      onNewMessage(convoId, assistantMessage);
    } catch (err) {
      const assistantMessage: ChatMessage = {
        id: uuidv4(),
        role: "assistant",
        content: `⚠️ ${t("errorMsg")}`,
        createdAt: Date.now(),
      };
      onNewMessage(convoId, assistantMessage);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-screen flex-1 min-w-0">
      {/* Topbar (mobile) */}
      <div
        className="flex md:hidden items-center justify-between px-4 py-3 border-b sticky top-0 z-20 shrink-0"
        style={{ borderColor: "var(--border-color)", backgroundColor: "var(--bg-primary)" }}
      >
        <button onClick={onOpenSidebar} className="p-1.5">
          <Menu size={20} />
        </button>
        <Logo size={22} />
        <button onClick={onOpenSettings} className="p-1.5">
          <Settings size={20} />
        </button>
      </div>

      {/* Message area */}
      <div className="flex-1 overflow-y-auto">
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
          <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
            {conversation.messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
            {loading && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-accent/15 flex items-center justify-center shrink-0">
                  <Logo size={18} withText={false} />
                </div>
                <div
                  className="rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1"
                  style={{ backgroundColor: "var(--bg-secondary)" }}
                >
                  <span className="typing-dot w-1.5 h-1.5 rounded-full bg-accent inline-block" />
                  <span className="typing-dot w-1.5 h-1.5 rounded-full bg-accent inline-block" />
                  <span className="typing-dot w-1.5 h-1.5 rounded-full bg-accent inline-block" />
                </div>
              </div>
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

          <div
            className="flex items-end gap-2 rounded-2xl border px-3 py-2"
            style={{ borderColor: "var(--border-color)", backgroundColor: "var(--bg-secondary)" }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
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

            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={t("placeholder")}
              rows={1}
              className="flex-1 resize-none bg-transparent outline-none text-sm py-1.5 max-h-32"
            />
            <button
              onClick={() => handleSend()}
              disabled={loading || (!input.trim() && !pendingImage)}
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
