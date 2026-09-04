import { GoogleGenAI } from "@google/genai";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// Model Gemini yang dipakai: cepat & akurat, cocok buat chat harian.
// Juga termasuk keluarga model yang dapat kuota gratis Google Search
// grounding (cek SETUP-GEMINI.md untuk detail kuota/biaya).
const GEMINI_MODEL = "gemini-2.5-flash";

export async function callGemini(
  systemPrompt: string,
  messages: ChatMessage[]
): Promise<string> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY belum diset di server.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // Gemini pakai role "user" / "model" (bukan "assistant" seperti OpenAI/Groq)
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents,
    config: {
      systemInstruction: systemPrompt,
      maxOutputTokens: 3000,
      // Google Search grounding: model bisa cari info terkini (harga,
      // berita, jadwal, dll) lewat Google Search sebelum jawab, bukan
      // cuma mengandalkan data training yang sudah lewat cutoff.
      tools: [{ googleSearch: {} }],
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("Gemini tidak mengembalikan jawaban.");
  }

  // Kalau grounding kepakai, tempelin sumbernya di bawah jawaban biar
  // kelihatan kredibel & bisa diverifikasi (nilai tambah buat portofolio).
  // Dibungkus try/catch + typing longgar karena bentuk response persis bisa
  // beda antar versi SDK — kalau gagal dibaca, cukup skip, jangan sampai
  // bikin chat error gara-gara ini.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const candidate = (response as any).candidates?.[0];
    const groundingChunks: Array<{ web?: { uri?: string; title?: string } }> =
      candidate?.groundingMetadata?.groundingChunks ?? [];
    const sources = groundingChunks
      .map((c) =>
        c.web?.uri && c.web?.title ? { title: c.web.title, uri: c.web.uri } : null
      )
      .filter((s): s is { title: string; uri: string } => s !== null);

    if (sources.length > 0) {
      const uniqueSources = Array.from(
        new Map(sources.map((s) => [s.uri, s])).values()
      ).slice(0, 4);
      const sourceList = uniqueSources.map((s) => `- [${s.title}](${s.uri})`).join("\n");
      return `${text}\n\n---\n**Sumber:**\n${sourceList}`;
    }
  } catch {
    // abaikan, tampilkan teks jawaban biasa aja
  }

  return text;
}
