"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { Copy, Check, RotateCcw, Share2, Volume2, Square, Loader2 } from "lucide-react";
import Logo from "./Logo";
import { ChatMessage } from "@/lib/useChatHistory";

interface MessageBubbleProps {
  message: ChatMessage;
  onRegenerate?: (messageId: string) => void;
  isRegenerating?: boolean;
}

// Buang syntax markdown/tabel biar enak didengar pas dibacain (TTS) — nggak
// kebaca literal "bintang", "garis vertikal" (karakter "|" tabel), dsb.
// Cuma sisain huruf, angka, dan tanda baca penting buat jeda kalimat.
function stripMarkdownForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[([^\]]*)\]\(.*?\)/g, "$1")
    .replace(/<br\s*\/?>/gi, ". ")
    .replace(/<\/?[a-z][^>]*>/gi, "") // tag HTML lain
    .split("\n")
    .filter((line) => !/^\s*\|?[\s:|-]+\|?\s*$/.test(line)) // baris separator tabel "|---|---|"
    .map((line) => line.replace(/\|/g, ", ")) // sel tabel jadi jeda koma, bukan dibaca "garis vertikal"
    .join("\n")
    .replace(/[*_#>`~]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export default function MessageBubble({
  message,
  onRegenerate,
  isRegenerating,
}: MessageBubbleProps) {
  const isUser = message.role === "user";
  const { data: session } = useSession();
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  async function handleShare() {
    if (navigator.share) {
      try {
        await navigator.share({ text: message.content });
      } catch {
        // user batal share, biarin aja
      }
    } else {
      handleCopy();
    }
  }

  function handleSpeak() {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    window.speechSynthesis.cancel();

    const fullText = stripMarkdownForSpeech(message.content);

    // Chrome (termasuk di Android/WebView) punya bug lama: utterance yang
    // kepanjangan suka berhenti sendiri di tengah atau gagal total diam-diam.
    // Solusinya: pecah jadi potongan per kalimat, dibacain berurutan
    // (nyambung otomatis pakai onend), bukan 1 utterance raksasa.
    const sentences = fullText.match(/[^.!?\n]+[.!?\n]*/g) ?? [fullText];
    const chunks: string[] = [];
    let current = "";
    for (const sentence of sentences) {
      if ((current + sentence).length > 180 && current) {
        chunks.push(current.trim());
        current = sentence;
      } else {
        current += sentence;
      }
    }
    if (current.trim()) chunks.push(current.trim());

    let index = 0;
    function speakNext() {
      if (index >= chunks.length) {
        setSpeaking(false);
        return;
      }
      const utterance = new SpeechSynthesisUtterance(chunks[index]);
      utterance.lang = "id-ID";
      utterance.onend = () => {
        index += 1;
        speakNext();
      };
      utterance.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(utterance);
    }

    setSpeaking(true);
    speakNext();
  }

  return (
    <div className={`flex gap-3 min-w-0 ${isUser ? "flex-row-reverse" : ""}`}>
      {isUser ? (
        session?.user?.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={session.user.image}
            alt={session.user.name ?? "User"}
            className="w-8 h-8 rounded-full shrink-0"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center shrink-0 text-white text-xs font-medium">
            {session?.user?.name?.[0] ?? "U"}
          </div>
        )
      ) : (
        <div className="w-8 h-8 rounded-full bg-accent/15 flex items-center justify-center shrink-0">
          <Logo size={18} withText={false} />
        </div>
      )}

      <div className={`flex flex-col ${isUser ? "items-end" : "items-start"} min-w-0 max-w-[80%] md:max-w-[70%]`}>
        <div
          className={`min-w-0 rounded-2xl px-4 py-3 text-sm leading-relaxed ${
            isUser ? "bg-accent text-white rounded-tr-sm" : "rounded-tl-sm"
          }`}
          style={!isUser ? { backgroundColor: "var(--bg-secondary)" } : undefined}
        >
          {message.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={message.image}
              alt="Lampiran"
              className="rounded-lg mb-2 max-h-64 object-cover"
            />
          )}

          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <div className="markdown-body min-w-0">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw, rehypeSanitize]}
                components={{
                  // Tabel GFM defaultnya nggak respect max-width parent dan
                  // bikin layout jebol di mobile. Bungkus dengan scroll horizontal
                  // sendiri, bukan ikut ndorong lebar seluruh chat bubble.
                  table: ({ children, ...props }) => (
                    <div className="overflow-x-auto max-w-full my-2 -mx-1">
                      <table {...props} className="text-xs">
                        {children}
                      </table>
                    </div>
                  ),
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          )}
        </div>

        {/* Toolbar aksi — cuma buat jawaban AI */}
        {!isUser && (
          <div className="flex items-center gap-1 mt-1 px-1">
            <button
              onClick={handleCopy}
              className="p-1.5 rounded-lg hover:bg-black/5 transition-colors"
              style={{ color: "var(--text-secondary)" }}
              aria-label="Salin"
              title="Salin"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>

            {onRegenerate && (
              <button
                onClick={() => onRegenerate(message.id)}
                disabled={isRegenerating}
                className="p-1.5 rounded-lg hover:bg-black/5 transition-colors disabled:opacity-40"
                style={{ color: "var(--text-secondary)" }}
                aria-label="Ulangi"
                title="Ulangi"
              >
                {isRegenerating ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RotateCcw size={14} />
                )}
              </button>
            )}

            <button
              onClick={handleShare}
              className="p-1.5 rounded-lg hover:bg-black/5 transition-colors"
              style={{ color: "var(--text-secondary)" }}
              aria-label="Bagikan"
              title="Bagikan"
            >
              <Share2 size={14} />
            </button>

            <button
              onClick={handleSpeak}
              className="p-1.5 rounded-lg hover:bg-black/5 transition-colors"
              style={{ color: "var(--text-secondary)" }}
              aria-label={speaking ? "Berhenti" : "Dengarkan"}
              title={speaking ? "Berhenti" : "Dengarkan"}
            >
              {speaking ? <Square size={14} /> : <Volume2 size={14} />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
