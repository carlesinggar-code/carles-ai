import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildSystemPrompt } from "@/lib/systemPrompt";
import { Lang } from "@/lib/translations";
import {
  streamGemini,
  generateImage,
  classifyGeminiError,
  GeminiMessage,
  InlineImage,
} from "@/lib/gemini";
import { extractTextFromFile } from "@/lib/fileExtract";
import { IMAGE_BUCKET } from "@/lib/imageStorage";
import {
  consumeQuota,
  refundQuota,
  quotaMessage,
  resetTimeWIB,
  QuotaKind,
} from "@/lib/quota";
import { NotesFilter } from "@/lib/notesFilter";

export const runtime = "nodejs";
// 60 detik = batas maksimal di plan Vercel Hobby. Pencarian web + membuat
// gambar bisa makan waktu belasan detik, jadi jangan diturunkan.
export const maxDuration = 60;

interface IncomingMessage {
  role: "user" | "assistant";
  content: string;
  image?: string; // URL publik di Supabase Storage
  imageData?: string; // data URL gambar BARU (hanya pesan terakhir) — dipakai langsung, tanpa unduh ulang
  imageNotes?: string; // catatan isi gambar (dipakai kalau file gambarnya sudah dihapus)
  imageExpired?: boolean;
  file?: { name: string; mimeType: string; data?: string };
}

const MAX_HISTORY_MESSAGES = 40; // riwayat lebih lama dari ini dipotong (hemat token)
const MAX_IMAGES_TO_READ = 3; // maksimal gambar yang "dilihat ulang" per permintaan
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_PROMPT_CHARS = 1500;
const MAX_NOTES_CHARS = 3000;
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];

// ---------------------------------------------------------------------
// Keamanan: server ini mengunduh gambar dari URL yang dikirim browser.
// Supaya tidak bisa disalahgunakan untuk mengakses alamat lain (SSRF),
// HANYA URL dari bucket Supabase milik kita yang boleh diambil.
// ---------------------------------------------------------------------
function isAllowedImageUrl(url: string): boolean {
  const base = process.env.SUPABASE_URL;
  if (!base) return false;
  const prefix = `${base.replace(/\/$/, "")}/storage/v1/object/public/${IMAGE_BUCKET}/`;
  return url.startsWith(prefix);
}

async function fetchImageAsInline(url: string): Promise<InlineImage | null> {
  if (!isAllowedImageUrl(url)) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) return null;
    const mimeType = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
    if (!mimeType.startsWith("image/")) return null;
    return { mimeType, data: buf.toString("base64") };
  } catch (err) {
    console.error("Gagal mengambil gambar:", url, err);
    return null;
  }
}

// Gambar yang baru dipilih user dikirim browser LANGSUNG (data URL), jadi
// tidak bergantung pada unduhan dari Supabase — ini yang bikin baca gambar
// tetap jalan walaupun upload/penyimpanan lagi bermasalah.
function parseDataUrl(dataUrl: unknown): InlineImage | null {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) return null;
  const sep = dataUrl.indexOf(";base64,");
  if (sep < 0) return null;
  const mimeType = dataUrl.slice(5, sep);
  const data = dataUrl.slice(sep + 8);
  if (!ALLOWED_MIME.includes(mimeType) || data.length === 0 || data.length > MAX_IMAGE_BYTES * 1.4) {
    return null;
  }
  return { mimeType, data };
}

async function saveGeneratedImage(email: string, image: InlineImage): Promise<string> {
  const ext = image.mimeType.split("/")[1]?.replace("jpeg", "jpg") || "png";
  const path = `${email}/gen-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.storage
    .from(IMAGE_BUCKET)
    .upload(path, Buffer.from(image.data, "base64"), {
      contentType: image.mimeType,
      upsert: false,
    });
  if (error) throw new Error(`Gambar berhasil dibuat tapi gagal disimpan: ${error.message}`);
  return supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}

// Teks status yang dikirim ke browser (bahasa mengikuti pengaturan user).
const STATUS_TEXT = {
  id: {
    file: "Membaca file…",
    image: "Membaca gambar…",
    search: (q: string) => `Mencari di web: ${q}`,
    draw: "Membuat gambar…",
    caption: "Ini gambarnya 👇",
    sources: "Sumber",
  },
  en: {
    file: "Reading the file…",
    image: "Looking at the image…",
    search: (q: string) => `Searching the web: ${q}`,
    draw: "Creating the image…",
    caption: "Here's your image 👇",
    sources: "Sources",
  },
} as const;

// Error mentah dari Google berupa JSON panjang — ubah ke kalimat yang
// bisa dipahami. Detail aslinya tetap tercatat di log server (console.error).
function friendlyError(err: unknown, lang: Lang): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const id = lang !== "en";
  switch (classifyGeminiError(err)) {
    case "quota":
      return id
        ? `Jatah AI hari ini sedang habis di semua model. Coba lagi nanti, reset sekitar jam ${resetTimeWIB()}.`
        : `Today's AI quota is used up on every model. Try again later — it resets around ${resetTimeWIB()}.`;
    case "missing":
      return id
        ? "Model Gemini yang dipakai sudah tidak tersedia. Ganti GEMINI_MODELS / GEMINI_IMAGE_MODELS di pengaturan server."
        : "The Gemini models in use are no longer available. Update GEMINI_MODELS / GEMINI_IMAGE_MODELS on the server.";
    case "overloaded":
      return id
        ? "Server Gemini sedang penuh. Coba lagi sebentar lagi."
        : "Gemini is busy right now. Please try again in a moment.";
    case "auth":
      return id
        ? "API key Gemini ditolak. Periksa GEMINI_API_KEY di server."
        : "The Gemini API key was rejected. Check GEMINI_API_KEY on the server.";
    default:
      // Pesan yang memang sengaja kita tulis sendiri (pendek, bukan JSON mentah)
      if (raw && raw.length < 250 && !raw.includes("{")) return raw;
      return id
        ? "Terjadi kesalahan saat memproses permintaan."
        : "Something went wrong while processing the request.";
  }
}

export async function POST(req: NextRequest) {
  // Ambil IP untuk pembatasan guest
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || "127.0.0.1";
  const session = await getServerSession(authOptions);
  const email = session?.user?.email || null;

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }

  const allMessages: IncomingMessage[] = Array.isArray(body.messages) ? body.messages : [];
  const lang: Lang = body.lang === "en" ? "en" : "id";
  const mode: "text" | "image" = body.mode === "image" ? "image" : "text";

  if (allMessages.length === 0) {
    return NextResponse.json({ error: "Pesan tidak boleh kosong." }, { status: 400 });
  }

  // Proteksi Fitur Lanjutan: Image/Vision wajib login
  const hasImage = allMessages.some((m) => m.imageData || m.image);
  if ((mode === "image" || hasImage) && !email) {
    return NextResponse.json(
      {
        error:
          lang === "en"
            ? "This feature (Image/Vision) requires signing in with Google."
            : "Fitur ini (Gambar/Vision) memerlukan login dengan Google.",
      },
      { status: 401 }
    );
  }

  const messages = allMessages.slice(-MAX_HISTORY_MESSAGES);
  const last = messages[messages.length - 1];
  const S = STATUS_TEXT[lang];

  // Validasi dulu SEBELUM mengambil jatah, supaya permintaan yang tidak valid tidak memotong kuota.
  const imagePrompt = (last.content ?? "").trim().slice(0, MAX_IMAGE_PROMPT_CHARS);
  if (mode === "image" && (!imagePrompt || imagePrompt === "(gambar terlampir)")) {
    return NextResponse.json(
      {
        error:
          lang === "en"
            ? "Describe the image you want first."
            : "Tulis dulu deskripsi gambar yang kamu mau.",
      },
      { status: 400 }
    );
  }

  // ---- Jatah harian ----
  const kind: QuotaKind = mode === "image" ? "image" : "chat";
  const quota = await consumeQuota(email, kind, ip);
  if (!quota.ok) {
    return NextResponse.json(
      { error: quotaMessage(kind, quota.reason, lang) },
      { status: 429 }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };
      let delivered = false; // sudah ada hasil yang sampai ke user?

      try {
        // ------------------------------------------------------------
        // Mode BUAT GAMBAR
        // ------------------------------------------------------------
        if (mode === "image") {
          if (!email) throw new Error("Login diperlukan untuk membuat gambar.");
          // Sumber gambar untuk diedit: gambar yang baru dilampirkan, atau
          // gambar terdekat di 4 pesan terakhir — jadi user bisa lanjut
          // bilang "ubah jadi warna biru" ke gambar tadi.
          const inputImages: InlineImage[] = [];
          const fresh = parseDataUrl(last.imageData);
          if (fresh) {
            inputImages.push(fresh);
          } else {
            const sourceUrl =
              last.image ??
              messages
                .slice(-4, -1)
                .reverse()
                .find((m) => !!m.image)?.image;
            if (sourceUrl) {
              send({ t: "status", kind: "image", text: S.image });
              const img = await fetchImageAsInline(sourceUrl);
              if (img) inputImages.push(img);
            }
          }

          send({ t: "status", kind: "draw", text: S.draw });
          const { image, text } = await generateImage(imagePrompt, inputImages);
          const url = await saveGeneratedImage(email, image);

          delivered = true;
          send({ t: "delta", text: text || S.caption });
          send({ t: "image", url });
          send({ t: "done" });
          return;
        }

        // ------------------------------------------------------------
        // Mode CHAT (teks + baca gambar + baca file)
        // ------------------------------------------------------------

        // File dokumen (PDF/Word/Excel/CSV/TXT): ekstrak teksnya dulu,
        // gabungkan ke isi pesan. PDF scan dibaca langsung oleh Gemini.
        const fileMessage = messages.find((m) => m.file?.data);
        if (fileMessage?.file?.data) {
          send({ t: "status", kind: "file", text: S.file });
          const extracted = await extractTextFromFile(
            fileMessage.file.mimeType,
            fileMessage.file.data,
            fileMessage.file.name
          );
          fileMessage.content = `${fileMessage.content}\n\n[Isi lampiran "${fileMessage.file.name}"]:\n${extracted}`;
        }

        // Gambar BARU di pesan terakhir: dipakai langsung dari kiriman browser.
        const lastIndex = messages.length - 1;
        const freshImage = last.role === "user" ? parseDataUrl(last.imageData) : null;

        // Gambar lama: ambil sampai 3 gambar TERBARU milik user dari riwayat
        // (yang file-nya masih ada), supaya pertanyaan lanjutan tetap nyambung.
        const withImageIdx = messages
          .map((m, i) => (m.role === "user" && m.image && !(i === lastIndex && freshImage) ? i : -1))
          .filter((i) => i >= 0)
          .slice(-(MAX_IMAGES_TO_READ - (freshImage ? 1 : 0)));

        if (freshImage || withImageIdx.length > 0) send({ t: "status", kind: "image", text: S.image });

        const imagesByIndex = new Map<number, InlineImage>();
        if (freshImage) imagesByIndex.set(lastIndex, freshImage);
        await Promise.all(
          withImageIdx.map(async (i) => {
            const img = await fetchImageAsInline(messages[i].image as string);
            if (img) imagesByIndex.set(i, img);
          })
        );

        const geminiMessages: GeminiMessage[] = messages.map((m, i) => {
          let content = m.content;
          const img = imagesByIndex.get(i);
          // Gambar tidak tersedia (sudah dihapus / gagal diunduh) tapi ada
          // catatan isinya → AI tetap "ingat" lewat catatan itu.
          if (m.role === "user" && !img && m.imageNotes) {
            content += `\n\n[Catatan isi gambar yang dikirim sebelumnya${
              m.imageExpired ? " (file gambarnya sudah dihapus)" : ""
            }: ${String(m.imageNotes).slice(0, MAX_NOTES_CHARS)}]`;
          }
          return { role: m.role, content, images: img ? [img] : undefined };
        });

        // Minta catatan isi gambar HANYA untuk gambar yang baru dikirim.
        const wantNotes = !!freshImage;
        const filter = wantNotes ? new NotesFilter() : null;
        const systemPrompt = buildSystemPrompt(lang, { imageNotes: wantNotes });

        for await (const ev of streamGemini(systemPrompt, geminiMessages, S.sources)) {
          if (ev.type === "search") {
            send({ t: "status", kind: "search", text: S.search(ev.queries[0]) });
          } else if (ev.type === "delta") {
            const out = filter ? filter.push(ev.text) : ev.text;
            if (out) {
              delivered = true;
              send({ t: "delta", text: out });
            }
          } else if (ev.type === "sources") {
            delivered = true;
            send({ t: "delta", text: ev.markdown });
          }
        }

        if (filter) {
          const { tail, notes } = filter.finish();
          if (tail) {
            delivered = true;
            send({ t: "delta", text: tail });
          }
          if (notes) send({ t: "notes", text: notes.slice(0, MAX_NOTES_CHARS) });
        }

        if (!delivered) throw new Error("Gemini tidak mengembalikan jawaban.");
        send({ t: "done" });
      } catch (err) {
        console.error("Chat API error:", err);
        // Gagal sebelum user menerima apa pun = bukan salah user → jatah dikembalikan.
        if (!delivered) await refundQuota(email || `guest:${ip}`, kind, quota.day);
        send({ t: "error", message: friendlyError(err, lang) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
