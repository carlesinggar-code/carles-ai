import { GoogleGenAI, ThinkingLevel } from "@google/genai";

// =====================================================================
// Carles.ai — semua fitur AI lewat Gemini.
//
// FALLBACK ANTAR MODEL: jatah gratis Google dihitung PER MODEL. Jadi kalau
// model terbaik kena batas (429) / sudah dimatikan (404) / sedang penuh
// (503), otomatis turun ke model berikutnya di daftar — bukan langsung error.
//
// Urutan bisa diganti tanpa ubah kode lewat Environment Variables
// (pisahkan dengan koma, model terbaik di depan):
//   GEMINI_MODELS        -> teks + baca gambar + pencarian web
//   GEMINI_IMAGE_MODELS  -> pembuat gambar
// (GEMINI_MODEL / GEMINI_IMAGE_MODEL versi tunggal juga masih dikenali.)
// Nama model yang salah/sudah mati aman: langsung dilewati ke berikutnya.
//
// ANTI "MODEL SUDAH TIDAK TERSEDIA": Google rutin mematikan model lama
// (gemini-1.5-* sudah dimatikan). Karena itu:
//   1. Default memakai alias "-latest" yang otomatis menunjuk ke model terbaru.
//   2. Isi GEMINI_MODELS di .env / Vercel TETAP dipakai paling depan, tapi daftar
//      default selalu ditambahkan di belakangnya — jadi walau env berisi model
//      lama yang sudah mati, request tetap jatuh ke model yang masih hidup.
//   3. Kalau semua model di daftar ternyata 404, server menanyakan langsung ke
//      Google model apa saja yang tersedia untuk API key ini, lalu mencobanya.
// =====================================================================

const DEFAULT_TEXT_MODELS = ["gemini-flash-latest", "gemini-flash-lite-latest"];
const DEFAULT_IMAGE_MODELS = [
  "gemini-2.5-flash-image",
  "gemini-2.5-flash-image-preview",
  "gemini-3-pro-image-preview",
];

function parseModelList(list: string | undefined, single: string | undefined, defaults: string[]): string[] {
  const fromList = (list ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const first = (single ?? "").trim();
  // Pilihan di env didahulukan, default SELALU ikut sebagai cadangan.
  return Array.from(new Set([...fromList, ...(first ? [first] : []), ...defaults]));
}

export const GEMINI_TEXT_MODELS = parseModelList(
  process.env.GEMINI_MODELS,
  process.env.GEMINI_MODEL,
  DEFAULT_TEXT_MODELS
);
export const GEMINI_IMAGE_MODELS = parseModelList(
  process.env.GEMINI_IMAGE_MODELS,
  process.env.GEMINI_IMAGE_MODEL,
  DEFAULT_IMAGE_MODELS
);

export interface InlineImage {
  mimeType: string;
  /** base64 TANPA prefix "data:...;base64," */
  data: string;
}

export interface GeminiMessage {
  role: "user" | "assistant";
  content: string;
  /** Gambar yang menempel di pesan ini (sudah dalam bentuk base64). */
  images?: InlineImage[];
}

export type GeminiStreamEvent =
  | { type: "search"; queries: string[] }
  | { type: "delta"; text: string }
  | { type: "sources"; markdown: string };

// ---------------------------------------------------------------------
// Klasifikasi error — menentukan apakah layak coba model lain.
// ---------------------------------------------------------------------
export type GeminiErrorKind =
  | "quota" // 429: jatah model ini habis
  | "missing" // 404: model sudah dimatikan / namanya salah
  | "overloaded" // 500/503: server Google lagi penuh
  | "badtool" // 400 gara-gara fitur search tidak didukung model ini
  | "auth" // API key salah / ditolak
  | "other";

export function classifyGeminiError(err: unknown): GeminiErrorKind {
  const e = err as { status?: number; code?: number; message?: string } | undefined;
  const status = e?.status ?? e?.code;
  const msg = String(e?.message ?? err ?? "");
  if (status === 429 || /RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(msg)) return "quota";
  if (status === 404 || /NOT_FOUND|no longer available|is not found/i.test(msg)) return "missing";
  if (status === 500 || status === 503 || /UNAVAILABLE|overloaded|high demand/i.test(msg)) return "overloaded";
  if (status === 400 && /tool|search|grounding/i.test(msg)) return "badtool";
  if (status === 401 || status === 403 || /API key|API_KEY|PERMISSION_DENIED/i.test(msg)) return "auth";
  return "other";
}

const SKIPPABLE: GeminiErrorKind[] = ["quota", "missing", "overloaded"];

// Model yang baru saja gagal "diistirahatkan" sebentar supaya request
// berikutnya nggak buang waktu mencobanya lagi. (Ingatan per-instance server,
// jadi sifatnya bantuan — bukan jaminan.)
const cooldown = new Map<string, number>();

function markCooldown(model: string, kind: GeminiErrorKind) {
  const ms = kind === "missing" ? 30 * 60_000 : kind === "quota" ? 5 * 60_000 : 20_000;
  cooldown.set(model, Date.now() + ms);
}

function orderModels(models: string[]): string[] {
  const now = Date.now();
  const ready = models.filter((m) => (cooldown.get(m) ?? 0) <= now);
  // Kalau semua sedang diistirahatkan, tetap coba semuanya (jangan menyerah).
  return ready.length > 0 ? ready : models;
}

let clientOverride: GoogleGenAI | null = null;
/** Hanya untuk pengujian otomatis. */
export function __setClientForTests(client: GoogleGenAI | null) {
  clientOverride = client;
  cooldown.clear();
}

function getClient(): GoogleGenAI {
  if (clientOverride) return clientOverride;
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY belum diset di server.");
  }
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

// ---------------------------------------------------------------------
// Penemuan model otomatis — dipakai kalau SEMUA model di daftar sudah mati.
// Menanyakan ke Google model apa yang benar-benar tersedia untuk API key ini.
// ---------------------------------------------------------------------
type ModelKind = "text" | "image";
const discoveryCache: Partial<Record<ModelKind, { at: number; models: string[] }>> = {};

function modelRank(name: string): [number, number, number] {
  const preview = /preview|exp/.test(name) ? 1 : 0; // yang stabil dulu
  const tier = /flash-lite/.test(name) ? 1 : /flash/.test(name) ? 0 : /pro/.test(name) ? 2 : 3;
  const ver = parseFloat(name.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? "0");
  return [preview, tier, -ver];
}

async function discoverModels(kind: ModelKind): Promise<string[]> {
  const cached = discoveryCache[kind];
  if (cached && Date.now() - cached.at < 30 * 60_000) return cached.models;

  const found: string[] = [];
  try {
    const pager = await getClient().models.list({ config: { pageSize: 100 } });
    for await (const m of pager) {
      const name = (m.name ?? "").replace(/^models\//, "");
      if (!name.startsWith("gemini")) continue;
      if (m.supportedActions && !m.supportedActions.includes("generateContent")) continue;
      if (/tts|embed|live|audio|imagen|veo|robotics|computer-use|learnlm|gemma|aqa/.test(name)) continue;
      const isImage = /image/.test(name);
      if ((kind === "image") !== isImage) continue;
      found.push(name);
    }
  } catch (err) {
    console.warn("[gemini] gagal menanyakan daftar model ke Google:", err);
  }

  found.sort((a, b) => {
    const ra = modelRank(a);
    const rb = modelRank(b);
    return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2];
  });
  const models = found.slice(0, 6);
  discoveryCache[kind] = { at: Date.now(), models };
  return models;
}

/**
 * Antrian model: daftar tetap dulu. Penemuan otomatis HANYA dijalankan kalau
 * semua kegagalan sebelumnya karena model sudah mati (404). Kalau kegagalannya
 * kuota (429) itu masalah API key/project, bukan nama model — mencoba lebih
 * banyak model cuma membuang kuota.
 */
function createModelQueue(base: string[], kind: ModelKind) {
  const list = [...orderModels(base)];
  let i = 0;
  let discovered = false;
  let onlyMissing = true;
  return {
    fail(k: GeminiErrorKind) {
      if (k !== "missing") onlyMissing = false;
    },
    async next(): Promise<string | null> {
      if (i >= list.length && !discovered && onlyMissing) {
        discovered = true;
        for (const m of await discoverModels(kind)) if (!list.includes(m)) list.push(m);
      }
      return i < list.length ? list[i++] : null;
    },
  };
}

// Gemini pakai role "user" / "model" (bukan "assistant"). Gambar ditaruh
// SEBELUM teks di dalam pesan yang sama, sesuai anjuran dokumentasi Google.
function toContents(messages: GeminiMessage[]) {
  return messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [
      ...(m.images ?? []).map((img) => ({
        inlineData: { mimeType: img.mimeType, data: img.data },
      })),
      { text: m.content && m.content.trim() ? m.content : "(lampiran)" },
    ],
  }));
}

// Pesan sapaan/pendek tidak butuh Google Search — search menambah beberapa
// detik per jawaban, jadi dilewati untuk pesan yang jelas tidak butuh data terbaru.
function needsSearch(messages: GeminiMessage[]): boolean {
  const last = [...messages].reverse().find((m) => m.role === "user");
  const text = (last?.content ?? "").trim();
  if (last?.images?.length) return false;
  if (text.length < 8 && !text.includes("?")) return false;
  return !/^(hai+|halo+|hi+|hello|hey|tes+t?|test|p|ping|makasih|terima kasih|thanks?( you)?|ok(e|ay)?|siap)\W*$/i.test(text);
}

// Model terbaru (Gemini 3.x) "berpikir" lama secara default — sapaan "hai" bisa
// makan 30–60 detik. Tingkat berpikir dibuat rendah supaya cepat. Kalau sebuah
// model menolak pengaturan ini (400), otomatis dicoba lagi tanpa pengaturan itu.
let thinkingTuningOk = true;

/**
 * Chat teks (+ baca gambar kalau ada di `messages`) dengan Google Search
 * grounding, dikirim sebagai stream. Kalau sebuah model gagal SEBELUM ada
 * teks yang keluar, otomatis pindah ke model berikutnya.
 */
export async function* streamGemini(
  systemPrompt: string,
  messages: GeminiMessage[],
  sourcesLabel = "Sumber"
): AsyncGenerator<GeminiStreamEvent> {
  const ai = getClient();
  const contents = toContents(messages);
  let lastErr: unknown;

  const queue = createModelQueue(GEMINI_TEXT_MODELS, "text");
  let model: string | null;
  while ((model = await queue.next())) {
    const variants = needsSearch(messages) ? [true, false] : [false];
    for (let vi = 0; vi < variants.length; vi++) {
      const useSearch = variants[vi];
      const startedAt = Date.now();
      let gotText = false;
      try {
        const stream = await ai.models.generateContentStream({
          model,
          contents,
          config: {
            systemInstruction: systemPrompt,
            // Model terbaru kadang "berpikir" dulu dan token berpikir ikut
            // dihitung ke batas ini — makanya dilonggarkan.
            maxOutputTokens: 8192,
            ...(thinkingTuningOk ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
            ...(useSearch ? { tools: [{ googleSearch: {} }] } : {}),
          },
        });

        const announced = new Set<string>();
        const sources = new Map<string, string>(); // uri -> title

        for await (const chunk of stream) {
          const grounding = chunk.candidates?.[0]?.groundingMetadata;

          // "Lagi cari apa" — hanya dikirim kalau Gemini benar-benar
          // melaporkan query pencariannya, jadi bukan tulisan pura-pura.
          const queries = (grounding?.webSearchQueries ?? []).filter(
            (q) => q && !announced.has(q)
          );
          if (queries.length > 0 && !gotText) {
            queries.forEach((q) => announced.add(q));
            yield { type: "search", queries };
          }

          for (const c of grounding?.groundingChunks ?? []) {
            if (c.web?.uri && c.web?.title) sources.set(c.web.uri, c.web.title);
          }

          const text = chunk.text;
          if (text) {
            if (!gotText) console.info(`[gemini] ${model} teks pertama keluar setelah ${Date.now() - startedAt}ms`);
            gotText = true;
            yield { type: "delta", text };
          }
        }

        if (!gotText) {
          throw new Error(
            "Gemini tidak mengembalikan jawaban (mungkin diblokir filter keamanan). Coba ubah pertanyaannya."
          );
        }

        if (sources.size > 0) {
          const list = Array.from(sources.entries())
            .slice(0, 4)
            .map(([uri, title]) => `- [${title}](${uri})`)
            .join("\n");
          yield { type: "sources", markdown: `\n\n---\n**${sourcesLabel}:**\n${list}` };
        }
        console.info(`[gemini] dijawab oleh ${model}${useSearch ? " (+search)" : ""}`);
        return;
      } catch (err) {
        lastErr = err;
        // Teks sudah sebagian terkirim ke user → nggak bisa ganti model di tengah jalan.
        if (gotText) throw err;

        const kind = classifyGeminiError(err);
        const errStatus = (err as { status?: number } | undefined)?.status;
        if (thinkingTuningOk && errStatus === 400 && /think/i.test(String((err as Error)?.message ?? ""))) {
          console.warn(`[gemini] ${model} menolak pengaturan berpikir, coba lagi tanpa itu`);
          thinkingTuningOk = false;
          vi--; // ulangi varian yang sama
          continue;
        }
        // Model sama, tanpa search. Kuota "Google Search grounding" dihitung
        // terpisah dari kuota teks biasa, jadi 429 di sini belum tentu berarti
        // model-nya habis — coba dulu tanpa search sebelum pindah model.
        if ((kind === "badtool" || kind === "quota") && useSearch) continue;
        if (SKIPPABLE.includes(kind)) {
          console.warn(`[gemini] ${model} gagal (${kind}), coba model berikutnya`);
          markCooldown(model, kind);
          queue.fail(kind);
          break; // lanjut ke model berikutnya
        }
        throw err;
      }
    }
  }

  throw lastErr ?? new Error("Semua model Gemini gagal.");
}

/**
 * Buat gambar menggunakan Pollinations.ai (Gratis & Cepat).
 * Dipakai sebagai fallback atau opsi utama pembuat gambar gratis.
 */
async function generateImagePollinations(prompt: string): Promise<InlineImage> {
  const seed = Math.floor(Math.random() * 1000000);
  const encodedPrompt = encodeURIComponent(prompt);
  // Gunakan model 'flux' atau default di pollinations untuk hasil bagus
  const url = `https://pollinations.ai/p/${encodedPrompt}?width=1024&height=1024&seed=${seed}&model=flux&nologo=true`;
  
  const res = await fetch(url);
  if (!res.ok) throw new Error("Gagal mengambil gambar dari Pollinations.ai");
  
  const buffer = await res.arrayBuffer();
  return {
    mimeType: "image/jpeg",
    data: Buffer.from(buffer).toString("base64"),
  };
}

/**
 * Buat gambar dari deskripsi teks. Mencoba Gemini dulu, jika gagal atau
 * model tidak tersedia, gunakan Pollinations.ai sebagai fallback gratis.
 */
export async function generateImage(
  prompt: string,
  inputImages: InlineImage[] = []
): Promise<{ image: InlineImage; text: string }> {
  // Jika ada input gambar (mode edit), WAJIB pakai Gemini karena Pollinations
  // hanya mendukung text-to-image murni lewat URL.
  const isEditing = inputImages.length > 0;

  if (!isEditing) {
    // Coba gunakan Pollinations dulu jika dikonfigurasi sebagai utama,
    // atau jika ingin menghemat kuota Gemini. Di sini kita jadikan opsi utama
    // untuk memenuhi permintaan "Integrasi API pembuat gambar gratis".
    try {
      console.info("[image] Menggunakan Pollinations.ai");
      const image = await generateImagePollinations(prompt);
      return { image, text: "" };
    } catch (err) {
      console.warn("[image] Pollinations gagal, mencoba Gemini...", err);
    }
  }

  const ai = getClient();
  let lastErr: unknown;

  const queue = createModelQueue(GEMINI_IMAGE_MODELS, "image");
  let model: string | null;
  while ((model = await queue.next())) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [
              ...inputImages.map((img) => ({
                inlineData: { mimeType: img.mimeType, data: img.data },
              })),
              { text: prompt },
            ],
          },
        ],
        config: { responseModalities: ["TEXT", "IMAGE"] },
      });

      let image: InlineImage | null = null;
      let text = "";
      for (const part of response.candidates?.[0]?.content?.parts ?? []) {
        if (part.inlineData?.data) {
          image = {
            mimeType: part.inlineData.mimeType || "image/png",
            data: part.inlineData.data,
          };
        } else if (part.text) {
          text += part.text;
        }
      }

      if (!image) {
        // Biasanya karena permintaan ditolak filter keamanan. Kalau model
        // ngasih alasan dalam teks, tampilkan itu ke user.
        throw new Error(
          text.trim() ||
            "Gambar tidak berhasil dibuat (mungkin permintaannya ditolak filter keamanan). Coba ubah deskripsinya."
        );
      }
      console.info(`[gemini] gambar dibuat oleh ${model}`);
      return { image, text: text.trim() };
    } catch (err) {
      lastErr = err;
      const kind = classifyGeminiError(err);
      if (SKIPPABLE.includes(kind)) {
        console.warn(`[gemini] ${model} gagal (${kind}), coba model gambar berikutnya`);
        markCooldown(model, kind);
        queue.fail(kind);
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error("Semua model gambar Gemini gagal.");
}

/**
 * Baca/transkrip file (gambar atau PDF hasil scan) langsung dengan Gemini.
 * Dipakai untuk OCR PDF scan — Gemini bisa membaca PDF utuh sekaligus.
 */
export async function transcribeWithGemini(
  file: InlineImage,
  instruction: string
): Promise<string> {
  const ai = getClient();
  let lastErr: unknown;

  const queue = createModelQueue(GEMINI_TEXT_MODELS, "text");
  let model: string | null;
  while ((model = await queue.next())) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: file.mimeType, data: file.data } },
              { text: instruction },
            ],
          },
        ],
        config: { maxOutputTokens: 8192 },
      });
      return (response.text ?? "").trim();
    } catch (err) {
      lastErr = err;
      const kind = classifyGeminiError(err);
      if (SKIPPABLE.includes(kind)) {
        markCooldown(model, kind);
        queue.fail(kind);
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error("Semua model Gemini gagal.");
}
