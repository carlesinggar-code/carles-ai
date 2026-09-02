import Groq from "groq-sdk";
import { NextRequest, NextResponse } from "next/server";
import { buildSystemPrompt } from "@/lib/systemPrompt";
import { Lang } from "@/lib/translations";

export const runtime = "nodejs";

interface IncomingMessage {
  role: "user" | "assistant";
  content: string;
  image?: string;
}

// Model teks biasa: cepat & murah, dipakai kalau tidak ada gambar.
const TEXT_MODEL = "openai/gpt-oss-120b";
// Model vision: dipakai otomatis kalau ada pesan user yang melampirkan gambar.
const VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const messages: IncomingMessage[] = body.messages ?? [];
    const lang: Lang = body.lang === "en" ? "en" : "id";

    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json(
        { error: "GROQ_API_KEY belum diset di server (.env.local)." },
        { status: 500 }
      );
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: "Pesan tidak boleh kosong." }, { status: 400 });
    }

    const hasImage = messages.some((m) => !!m.image);
    const model = hasImage ? VISION_MODEL : TEXT_MODEL;

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    // Bangun format pesan: kalau ada gambar, konten jadi array
    // [{type:"text"...}, {type:"image_url"...}] sesuai spesifikasi
    // OpenAI-compatible vision API yang dipakai Groq.
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
      model,
      messages: [
        { role: "system", content: buildSystemPrompt(lang) },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(formattedMessages as any),
      ],
      max_tokens: 1500,
    });

    const reply = completion.choices[0]?.message?.content ?? "";

    return NextResponse.json({ reply });
  } catch (err) {
    console.error("Chat API error:", err);
    return NextResponse.json(
      { error: "Terjadi kesalahan saat memproses permintaan." },
      { status: 500 }
    );
  }
}
