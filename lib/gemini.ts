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

/** Sebuah percobaan tidak mengeluarkan teks sama sekali dalam batas waktunya (macet/lambat). */
export class AttemptTimeoutError extends Error {
  code = "GEMINI_TIMEOUT";
  constructor(model: string, ms: number) {
    super(`Model ${model} tidak menjawab dalam ${Math.round(ms / 1000)} detik.`);
  }
}

// Batas waktu (dalam milidetik). Kalau sebuah percobaan belum mengeluarkan teks
// pertama dalam waktu ini, dibatalkan lalu pindah ke model/kunci berikutnya —
// supaya satu panggilan yang macet tidak menghabiskan seluruh jatah waktu 54 dtk.
// Semua angka bisa dikalikan lewat GEMINI_TIMEOUT_SCALE (mis. 2 kalau koneksi
// server lambat, 0.1 untuk pengujian otomatis).
const FIRST_CHUNK_SEARCH_MS = 13_000;
const FIRST_CHUNK_PLAIN_MS = 10_000;
const STREAM_BUDGET_MS = 50_000;
const MIN_ATTEMPT_MS = 3_500;
// Setelah jawaban mulai mengalir: kalau tidak ada potongan baru selama ini, anggap macet.
const IDLE_CHUNK_MS = 20_000;
function timeScale(): number {
  const n = Number(process.env.GEMINI_TIMEOUT_SCALE);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function classifyGeminiError(err: unknown): GeminiErrorKind {
  if ((err as { code?: string } | null)?.code === "GEMINI_TIMEOUT") return "overloaded";
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
// jadi sifatnya bantuan — bukan jaminan.) Dicatat per KUNCI + model, karena
// kuota Google dihitung per project.
const cooldown = new Map<string, number>();

function markCooldown(slotId: string, model: string, kind: GeminiErrorKind) {
  const ms = kind === "missing" ? 30 * 60_000 : kind === "quota" ? 5 * 60_000 : 20_000;
  cooldown.set(`${slotId}|${model}`, Date.now() + ms);
}

function orderModels(models: string[], slotId: string): string[] {
  const now = Date.now();
  const ready = models.filter((m) => (cooldown.get(`${slotId}|${m}`) ?? 0) <= now);
  // Kalau semua sedang diistirahatkan, tetap coba semuanya (jangan menyerah).
  return ready.length > 0 ? ready : models;
}

// ---------------------------------------------------------------------
// Beberapa API key (cadangan). Isi di env, pilih salah satu cara:
//   GEMINI_API_KEYS=key1,key2        (pisahkan dengan koma)
//   atau GEMINI_API_KEY + GEMINI_API_KEY_2 (+ GEMINI_API_KEY_3)
// Key pertama dipakai lebih dulu. Key berikutnya HANYA dipakai kalau key
// sebelumnya kena batas kuota (429) atau ditolak. Kuota Google dihitung per
// PROJECT, jadi key cadangan harus dari project yang berbeda.
// ---------------------------------------------------------------------
interface KeySlot {
  id: string;
  ai: GoogleGenAI;
}

let slotPool: KeySlot[] | null = null;
const keyCooldown = new Map<string, number>();

function getKeySlots(): KeySlot[] {
  if (clientOverride) return clientOverride.map((ai, i) => ({ id: `t${i + 1}`, ai }));
  if (!slotPool) {
    const raw = [
      ...(process.env.GEMINI_API_KEYS ?? "").split(","),
      process.env.GEMINI_API_KEY,
      process.env.GEMINI_API_KEY_2,
      process.env.GEMINI_API_KEY_3,
    ]
      .map((k) => (k ?? "").trim())
      .filter(Boolean);
    const unique = Array.from(new Set(raw));
    if (unique.length === 0) {
      console.error("[gemini] GEMINI_API_KEY / GEMINI_API_KEYS belum diset di server.");
      throw new Error("Carles.ai sedang mengalami gangguan. Coba lagi nanti.");
    }
    slotPool = unique.map((apiKey, i) => ({ id: `k${i + 1}`, ai: new GoogleGenAI({ apiKey }) }));
  }
  return slotPool;
}

/** Urutan key yang dicoba: yang tidak sedang diistirahatkan dulu; kalau semua istirahat, coba semuanya. */
function orderedSlots(): KeySlot[] {
  const slots = getKeySlots();
  const now = Date.now();
  const ready = slots.filter((k) => (keyCooldown.get(k.id) ?? 0) <= now);
  return ready.length > 0 ? ready : slots;
}

function markKeyCooldown(slot: KeySlot, kind: GeminiErrorKind) {
  // auth: lama. quota: sedang. macet/lambat: sebentar saja (mungkin cuma sesaat).
  const ms = kind === "auth" ? 30 * 60_000 : kind === "quota" ? 5 * 60_000 : 45_000;
  keyCooldown.set(slot.id, Date.now() + ms);
  const total = getKeySlots().length;
  console.warn(
    `[gemini] kunci #${slot.id.slice(1)} dari ${total} gagal (${kind})${total > 1 ? ", pindah ke kunci cadangan" : ""}`
  );
}

let clientOverride: GoogleGenAI[] | null = null;
/** Hanya untuk pengujian otomatis (boleh beberapa klien = beberapa kunci). */
export function __setClientForTests(client: GoogleGenAI | GoogleGenAI[] | null) {
  clientOverride = client ? (Array.isArray(client) ? client : [client]) : null;
  slotPool = null;
  cooldown.clear();
  keyCooldown.clear();
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

async function discoverModels(kind: ModelKind, ai: GoogleGenAI): Promise<string[]> {
  const cached = discoveryCache[kind];
  if (cached && Date.now() - cached.at < 30 * 60_000) return cached.models;

  const found: string[] = [];
  try {
    const pager = await ai.models.list({ config: { pageSize: 100 } });
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
function createModelQueue(base: string[], kind: ModelKind, slot: KeySlot) {
  const list = [...orderModels(base, slot.id)];
  let i = 0;
  let discovered = false;
  let onlyMissing = true;
  return {
    fail(k: GeminiErrorKind, model: string) {
      markCooldown(slot.id, model, k);
      if (k !== "missing") onlyMissing = false;
    },
    async next(): Promise<string | null> {
      if (i >= list.length && !discovered && onlyMissing) {
        discovered = true;
        for (const m of await discoverModels(kind, slot.ai)) if (!list.includes(m)) list.push(m);
      }
      return i < list.length ? list[i++] : null;
    },
  };
}

// Gemini pakai role "user" / "model" (bukan "assistant"). Gambar ditaruh
// SEBELUM teks di dalam pesan yang sama, sesuai anjuran dokumentasi Google.
function toContents(messages: GeminiMessage[]) {
  const out: { role: string; parts: Array<Record<string, unknown>> }[] = [];
  for (const m of messages) {
    const role = m.role === "assistant" ? "model" : "user";
    const parts: Array<Record<string, unknown>> = [
      ...(m.images ?? []).map((img) => ({
        inlineData: { mimeType: img.mimeType, data: img.data },
      })),
      { text: m.content && m.content.trim() ? m.content : "(lampiran)" },
    ];
    // Dua pesan se-peran berurutan (mis. jawaban gagal yang disaring) digabung,
    // supaya urutan user/model tetap bergantian seperti yang diminta AI.
    const prev = out[out.length - 1];
    if (prev && prev.role === role) prev.parts.push(...parts);
    else out.push({ role, parts });
  }
  return out;
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
  let lastErr: unknown;
  let delivered = false;
  const deadline = Date.now() + STREAM_BUDGET_MS * timeScale();
  const slots = orderedSlots();
  for (let si = 0; si < slots.length; si++) {
    const slot = slots[si];
    if (si > 0 && deadline - Date.now() < MIN_ATTEMPT_MS * timeScale()) break;
    try {
      for await (const ev of streamWithSlot(slot, systemPrompt, messages, sourcesLabel, deadline, si < slots.length - 1)) {
        if (ev.type === "delta") delivered = true;
        yield ev;
      }
      return;
    } catch (err) {
      lastErr = err;
      const kind = classifyGeminiError(err);
      // Belum ada teks yang terkirim + kunci ini bermasalah (kuota habis, ditolak,
      // server penuh, atau macet) → coba kunci cadangan.
      if (!delivered && (kind === "quota" || kind === "auth" || kind === "overloaded")) {
        markKeyCooldown(slot, kind);
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error("Carles.ai sedang bermasalah. Coba lagi nanti.");
}

async function* streamWithSlot(
  slot: KeySlot,
  systemPrompt: string,
  messages: GeminiMessage[],
  sourcesLabel: string,
  deadline: number,
  hasBackupKey: boolean
): AsyncGenerator<GeminiStreamEvent> {
  const ai = slot.ai;
  const contents = toContents(messages);
  let lastErr: unknown;
  // Permintaan "berat" (ada gambar / teks panjang) wajar butuh waktu lebih lama.
  const heavy =
    messages.some((m) => m.images?.length) ||
    messages.reduce((n, m) => n + m.content.length, 0) > 8000;
  const scale = timeScale() * (heavy ? 1.5 : 1);

  const queue = createModelQueue(GEMINI_TEXT_MODELS, "text", slot);
  let model: string | null;
  while ((model = await queue.next())) {
    const variants = needsSearch(messages) ? [true, false] : [false];
    for (let vi = 0; vi < variants.length; vi++) {
      const useSearch = variants[vi];
      const startedAt = Date.now();
      let gotText = false;

      const remaining = deadline - startedAt;
      if (remaining < MIN_ATTEMPT_MS * timeScale()) {
        throw lastErr ?? new AttemptTimeoutError(model, 0);
      }
      const limit = Math.min((useSearch ? FIRST_CHUNK_SEARCH_MS : FIRST_CHUNK_PLAIN_MS) * scale, remaining);
      const ctrl = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        ctrl.abort();
      }, limit);
      // Penjaga "macet di tengah jalan": diperbarui setiap ada potongan baru.
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const armIdle = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          timedOut = true;
          ctrl.abort();
        }, IDLE_CHUNK_MS * scale);
      };

      try {
        const stream = await ai.models.generateContentStream({
          model,
          contents,
          config: {
            abortSignal: ctrl.signal,
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

        let firstChunk = true;
        for await (const chunk of stream) {
          // Chunk pertama tiba = Gemini hidup. Batas waktu awal dilepas, diganti
          // penjaga "macet antar potongan" yang diperbarui tiap potongan baru.
          if (firstChunk) {
            clearTimeout(timer);
            firstChunk = false;
          }
          armIdle();
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
            "Carles.ai tidak bisa menjawab ini (mungkin diblokir filter keamanan). Coba ubah pertanyaannya."
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
      } catch (rawErr) {
        // Dibatalkan oleh batas waktu kita (bukan error dari Google)?
        const timeoutHit = timedOut && !gotText;
        const err = timeoutHit ? new AttemptTimeoutError(model, limit) : rawErr;
        lastErr = err;
        // Teks sudah sebagian terkirim ke user → nggak bisa ganti model di tengah jalan.
        if (gotText) throw err;

        if (timeoutHit) {
          console.warn(
            `[gemini] ${model}${useSearch ? " (+search)" : ""} tidak mengeluarkan teks dalam ${Math.round(limit)}ms, dibatalkan`
          );
          // Mungkin Google Search yang lambat → sekali lagi tanpa search di model yang sama.
          if (useSearch) continue;
          queue.fail("overloaded", model);
          // Ada kunci cadangan → pindah kunci SEKARANG, jangan habiskan waktu di sini.
          if (hasBackupKey) throw err;
          break; // satu kunci saja → coba model berikutnya
        }

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
          queue.fail(kind, model);
          break; // lanjut ke model berikutnya
        }
        throw err;
      } finally {
        clearTimeout(timer);
        clearTimeout(idleTimer);
      }
    }
  }

  throw lastErr ?? new Error("Carles.ai sedang bermasalah. Coba lagi nanti.");
}

/**
 * Buat gambar menggunakan Pollinations.ai (Gratis & Cepat).
 * Dipakai sebagai fallback atau opsi utama pembuat gambar gratis.
 */
/** Kenali jenis gambar dari isi file-nya (bukan dari header server, yang bisa bohong). */
function sniffImageMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buf.subarray(0, 3).toString("ascii") === "GIF") return "image/gif";
  return null;
}

/** Batas waktu total pembuatan gambar. Vercel Hobby mematikan fungsi di 60 detik —
 *  kalau terlewat, jatah sudah terpotong tapi tidak dikembalikan. Jadi harus selesai
 *  (atau gagal dengan rapi) sebelum itu. */
export const IMAGE_BUDGET_MS = 48_000;

export class ImageTimeoutError extends Error {
  code = "IMAGE_TIMEOUT";
  constructor() {
    super("Pembuatan gambar terlalu lama.");
  }
}

async function generateImagePollinations(prompt: string, deadline: number): Promise<InlineImage> {
  const seed = Math.floor(Math.random() * 1000000);
  const encodedPrompt = encodeURIComponent(prompt);
  const query = `width=1024&height=1024&seed=${seed}&model=flux&nologo=true`;
  // Dua alamat yang dikenal; kalau satu berubah/ditutup, coba yang lain.
  const urls = [
    `https://image.pollinations.ai/prompt/${encodedPrompt}?${query}`,
    `https://pollinations.ai/p/${encodedPrompt}?${query}`,
  ];

  let lastErr: unknown;
  for (const url of urls) {
    const remaining = deadline - Date.now();
    if (remaining < 3_000) break;
    try {
      // Alamat pertama maksimal 28 detik supaya alamat cadangan masih sempat dicoba.
      const res = await fetch(url, { signal: AbortSignal.timeout(Math.min(remaining, 28_000)) });
      if (!res.ok) throw new Error(`Pollinations membalas HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      // PENTING: server ini kadang membalas 200 tapi isinya halaman error/JSON
      // (mis. batas pemakaian atau butuh API key). Kalau itu disimpan apa adanya,
      // hasilnya "gambar rusak". Jadi isi file diperiksa dulu.
      const mimeType = sniffImageMime(buffer);
      if (!mimeType) {
        const preview = buffer.subarray(0, 120).toString("utf8").replace(/\s+/g, " ");
        throw new Error(`Pollinations tidak mengirim gambar (isi: "${preview}")`);
      }
      return { mimeType, data: buffer.toString("base64") };
    } catch (err) {
      lastErr = err;
      console.warn(`[image] Pollinations gagal di ${new URL(url).host}:`, err instanceof Error ? err.message : err);
    }
  }
  throw lastErr ?? new Error("Gagal mengambil gambar dari Pollinations.ai");
}

// ---------------------------------------------------------------------
// Cloudflare Workers AI — pembuat gambar gratis (10.000 "neurons"/hari untuk
// seluruh akun, tanpa kartu kredit, tanpa watermark). Env yang dibutuhkan:
//   CLOUDFLARE_ACCOUNT_ID   CLOUDFLARE_API_TOKEN  (izin: Workers AI)
//   CLOUDFLARE_IMAGE_MODELS (opsional, pisahkan koma, yang terbaik di depan)
// ---------------------------------------------------------------------
const CF_DEFAULT_MODELS = [
  "@cf/black-forest-labs/flux-1-schnell",
  "@cf/bytedance/stable-diffusion-xl-lightning",
  "@cf/stabilityai/stable-diffusion-xl-base-1.0",
];

function cloudflareConfigured(): boolean {
  return !!(process.env.CLOUDFLARE_ACCOUNT_ID?.trim() && process.env.CLOUDFLARE_API_TOKEN?.trim());
}

/**
 * Model gambar bekerja jauh lebih akurat dengan prompt bahasa Inggris yang
 * deskriptif. Prompt user (biasanya bahasa Indonesia) diterjemahkan/dirapikan
 * dulu oleh Gemini. Kalau gagal/lambat, pakai prompt asli — jangan sampai
 * menghambat pembuatan gambar.
 */
async function toEnglishImagePrompt(prompt: string): Promise<string> {
  try {
    const slot = orderedSlots()[0];
    const model = GEMINI_TEXT_MODELS[0];
    const response = await slot.ai.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                "Rewrite the user's image request as ONE clear, detailed English prompt for a text-to-image model. " +
                "Keep every object, color, count, style and setting the user asked for. Do not add text or watermarks. " +
                "Output ONLY the prompt, no quotes, no explanation.\n\nUser request: " +
                prompt,
            },
          ],
        },
      ],
      config: {
        maxOutputTokens: 400,
        abortSignal: AbortSignal.timeout(9_000),
        ...(thinkingTuningOk ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
      },
    });
    const out = (response.text ?? "").trim().replace(/^["']|["']$/g, "");
    return out.length >= 3 && out.length <= 1500 ? out : prompt;
  } catch (err) {
    console.warn("[image] gagal merapikan prompt, pakai prompt asli:", err instanceof Error ? err.message : err);
    return prompt;
  }
}

async function generateImageCloudflare(prompt: string, deadline: number): Promise<InlineImage> {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID!.trim();
  const token = process.env.CLOUDFLARE_API_TOKEN!.trim();
  const models = (process.env.CLOUDFLARE_IMAGE_MODELS ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  const list = models.length > 0 ? models : CF_DEFAULT_MODELS;

  const englishPrompt = await toEnglishImagePrompt(prompt);
  let lastErr: unknown;

  for (const model of list) {
    const remaining = deadline - Date.now();
    if (remaining < 4_000) break;
    try {
      const isFlux = /flux/i.test(model);
      const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(
          isFlux
            ? { prompt: englishPrompt, steps: 6 }
            : { prompt: englishPrompt, num_steps: 20, width: 1024, height: 1024 }
        ),
        signal: AbortSignal.timeout(Math.min(remaining, 30_000)),
      });

      const type = res.headers.get("content-type") ?? "";
      let buffer: Buffer;
      if (type.includes("application/json")) {
        // FLUX membalas JSON: { result: { image: "<base64>" }, success, errors }
        const json = (await res.json()) as {
          success?: boolean;
          result?: { image?: string };
          errors?: { message?: string }[];
        };
        if (!res.ok || json.success === false || !json.result?.image) {
          const msg = json.errors?.map((e) => e.message).filter(Boolean).join("; ") || `HTTP ${res.status}`;
          throw Object.assign(new Error(`Cloudflare menolak: ${msg}`), { status: res.status });
        }
        buffer = Buffer.from(json.result.image, "base64");
      } else {
        // Model Stable Diffusion membalas langsung berupa file gambar.
        if (!res.ok) throw Object.assign(new Error(`Cloudflare HTTP ${res.status}`), { status: res.status });
        buffer = Buffer.from(await res.arrayBuffer());
      }

      const mimeType = sniffImageMime(buffer);
      if (!mimeType) throw new Error("Cloudflare tidak mengirim gambar yang valid.");
      console.info(`[image] dibuat oleh Cloudflare ${model}`);
      return { mimeType, data: buffer.toString("base64") };
    } catch (err) {
      lastErr = err;
      console.warn(`[image] Cloudflare ${model} gagal:`, err instanceof Error ? err.message : err);
      const status = (err as { status?: number } | undefined)?.status;
      // 401/403: token/ID salah — model lain pun akan gagal, hentikan.
      if (status === 401 || status === 403) break;
    }
  }
  throw lastErr ?? new Error("Cloudflare gagal membuat gambar.");
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
  const deadline = Date.now() + IMAGE_BUDGET_MS;

  if (!isEditing) {
    // 1) Cloudflare Workers AI (gratis, tanpa watermark) kalau sudah dikonfigurasi.
    if (cloudflareConfigured()) {
      try {
        const image = await generateImageCloudflare(prompt, deadline);
        return { image, text: "" };
      } catch (err) {
        console.warn("[image] Cloudflare gagal, mencoba cadangan...", err instanceof Error ? err.message : err);
      }
    }
    // 2) Pollinations sebagai cadangan (bisa ada watermark). Matikan dengan
    //    POLLINATIONS_ENABLED=false kalau tidak mau memakainya sama sekali.
    if (process.env.POLLINATIONS_ENABLED !== "false") {
      try {
        console.info("[image] Menggunakan Pollinations.ai");
        const image = await generateImagePollinations(prompt, deadline);
        return { image, text: "" };
      } catch (err) {
        console.warn("[image] Pollinations gagal, mencoba Gemini...", err);
      }
    }
  }

  // Model gambar Gemini hanya jalan di akun berbayar, jadi cukup kunci utama.
  const slot = getKeySlots()[0];
  const ai = slot.ai;
  let lastErr: unknown;

  const queue = createModelQueue(GEMINI_IMAGE_MODELS, "image", slot);
  let model: string | null;
  while ((model = await queue.next())) {
    const remaining = deadline - Date.now();
    if (remaining < 6_000) throw new ImageTimeoutError();
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
        config: { responseModalities: ["TEXT", "IMAGE"], abortSignal: AbortSignal.timeout(remaining) },
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
        queue.fail(kind, model);
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error("Pembuatan gambar gagal. Coba lagi nanti.");
}

/**
 * Baca/transkrip file (gambar atau PDF hasil scan) langsung dengan Gemini.
 * Dipakai untuk OCR PDF scan — Gemini bisa membaca PDF utuh sekaligus.
 */
export async function transcribeWithGemini(
  file: InlineImage,
  instruction: string
): Promise<string> {
  let lastErr: unknown;
  for (const slot of orderedSlots()) {
    try {
      return await transcribeWithSlot(slot, file, instruction);
    } catch (err) {
      lastErr = err;
      const kind = classifyGeminiError(err);
      if (kind === "quota" || kind === "auth") {
        markKeyCooldown(slot, kind);
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error("Carles.ai sedang bermasalah. Coba lagi nanti.");
}

async function transcribeWithSlot(
  slot: KeySlot,
  file: InlineImage,
  instruction: string
): Promise<string> {
  const ai = slot.ai;
  let lastErr: unknown;

  const queue = createModelQueue(GEMINI_TEXT_MODELS, "text", slot);
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
        queue.fail(kind, model);
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error("Carles.ai sedang bermasalah. Coba lagi nanti.");
}
