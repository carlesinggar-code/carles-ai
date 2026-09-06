import Groq from "groq-sdk";
import { NextRequest, NextResponse } from "next/server";
import { buildSystemPrompt } from "@/lib/systemPrompt";
import { Lang } from "@/lib/translations";
import { callGemini } from "@/lib/gemini";
import { extractTextFromFile } from "@/lib/fileExtract";

export const runtime = "nodejs";
// OCR PDF hasil scan bisa proses beberapa halaman berurutan (tiap halaman
// = 1 pemanggilan model vision) — kasih waktu lebih lega dari default,
// 60 detik ini juga batas maksimal di plan Vercel Hobby.
export const maxDuration = 60;

interface IncomingMessage {
  role: "user" | "assistant";
  content: string;
  image?: string;
  file?: { name: string; mimeType: string; data?: string };
}

// Model teks biasa (Groq): cepat & murah, dipakai kalau tidak ada gambar
// ATAU sebagai fallback kalau Gemini gagal/timeout.
const TEXT_MODEL = "openai/gpt-oss-120b";
// Model vision: dipakai otomatis kalau ada pesan user yang melampirkan gambar.
// (meta-llama/llama-4-scout-17b-16e-instruct sudah di-deprecate Groq per 17 Jun 2026)
const VISION_MODEL = "qwen/qwen3.6-27b";
// Batas waktu tunggu Gemini sebelum kita fallback ke Groq (ms).
const GEMINI_TIMEOUT_MS = 7000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("Gemini timeout")), ms)
    ),
  ]);
}

// Jaring pengaman: beberapa model reasoning kadang masih nyelipin blok
// <think>...</think> walau parameter buat nyembunyiinnya udah diset.
// Ini buang blok itu sebelum dikirim ke user.
function stripThinkingTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

async function callGroqText(
  systemPrompt: string,
  messages: IncomingMessage[]
): Promise<string> {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY belum diset di server.");
  }
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const completion = await groq.chat.completions.create({
    model: TEXT_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
    max_tokens: 3000,
  });
  return completion.choices[0]?.message?.content ?? "";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const messages: IncomingMessage[] = body.messages ?? [];
    const lang: Lang = body.lang === "en" ? "en" : "id";

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: "Pesan tidak boleh kosong." }, { status: 400 });
    }

    const systemPrompt = buildSystemPrompt(lang);
    const hasImage = messages.some((m) => !!m.image);

    // --- Ada file dokumen (PDF/Word/Excel/CSV/TXT) dilampirkan: ekstrak
    // teksnya dulu di sini, gabungkan ke content pesannya. Setelah ini,
    // pesan tersebut jadi teks biasa — jalan lewat pipeline yang sama
    // persis kayak chat teks normal (Gemini→Groq fallback), nggak perlu
    // model/provider khusus buat file.
    const fileMessage = messages.find((m) => m.file?.data);
    if (fileMessage?.file?.data) {
      try {
        const extractedText = await extractTextFromFile(
          fileMessage.file.mimeType,
          fileMessage.file.data,
          fileMessage.file.name
        );
        fileMessage.content = `${fileMessage.content}\n\n[Isi lampiran "${fileMessage.file.name}"]:\n${extractedText}`;
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : "Gagal membaca file lampiran." },
          { status: 400 }
        );
      }
    }

    // --- Ada gambar: tetap lewat Groq vision model (Gemini belum di-hook di sini) ---
    if (hasImage) {
      if (!process.env.GROQ_API_KEY) {
        return NextResponse.json(
          { error: "GROQ_API_KEY belum diset di server (.env.local)." },
          { status: 500 }
        );
      }
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
      const formattedMessages = messages.map((m) => {
        if (m.image) {
          return {
            role: m.role,
            content: [
              { type: "text", text: m.content },
              { type: "image_url", image_url: { url: m.image } },
            ],
          };
        }
        return { role: m.role, content: m.content };
      });
      const completion = await groq.chat.completions.create({
        model: VISION_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...(formattedMessages as any),
        ],
        max_tokens: 3000,
        // qwen3.6-27b itu reasoning model, defaultnya nampilin proses
        // "<think>...</think>" di jawaban. "hidden" biar cuma jawaban
        // akhirnya aja yang balik.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        reasoning_format: "hidden",
      } as any);
      return NextResponse.json({
        reply: stripThinkingTags(completion.choices[0]?.message?.content ?? ""),
        provider: "groq-vision",
      });
    }

    // --- Teks biasa: coba Gemini dulu (lebih akurat), fallback otomatis ke Groq ---
    let reply = "";
    let usedProvider = "gemini";
    try {
      reply = await withTimeout(callGemini(systemPrompt, messages), GEMINI_TIMEOUT_MS);
    } catch (geminiErr) {
      console.error("Gemini gagal / timeout, fallback ke Groq:", geminiErr);
      usedProvider = "groq";
      reply = await callGroqText(systemPrompt, messages);
    }

    return NextResponse.json({ reply, provider: usedProvider });
  } catch (err) {
    console.error("Chat API error:", err);
    return NextResponse.json(
      { error: "Terjadi kesalahan saat memproses permintaan." },
      { status: 500 }
    );
  }
}
