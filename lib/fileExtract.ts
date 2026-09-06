import mammoth from "mammoth";
import * as XLSX from "xlsx";
import Groq from "groq-sdk";
import { getDocumentProxy, extractText, renderPageAsImage } from "unpdf";

// Batas panjang teks hasil ekstraksi yang dikirim ke AI. Dokumen yang
// kepanjangan bisa bikin boros token / kena limit max_tokens, jadi kita
// potong dan kasih tau kalau ada bagian yang terpotong.
const MAX_CHARS = 20000;
// PDF hasil scan/foto (nggak ada teks asli) di-OCR pakai model vision yang
// sama dipakai buat fitur baca gambar. Dibatasin sekian halaman biar nggak
// kelamaan/timeout & nggak boros.
const MAX_OCR_PAGES = 5;
const VISION_MODEL = "qwen/qwen3.6-27b";

function truncate(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_CHARS) return trimmed;
  return (
    trimmed.slice(0, MAX_CHARS) +
    "\n\n[...isi dokumen dipotong karena terlalu panjang...]"
  );
}

function stripThinkingTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

async function ocrImageBuffer(imageBuffer: ArrayBuffer): Promise<string> {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY belum diset di server.");
  }
  const base64 = Buffer.from(imageBuffer).toString("base64");
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const completion = await groq.chat.completions.create({
    model: VISION_MODEL,
    messages: [
      {
        role: "user",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        content: [
          {
            type: "text",
            text: "Tuliskan ulang PERSIS semua teks yang terlihat di gambar ini (hasil scan dokumen). Jangan menambah komentar, penjelasan, atau opini apapun — cuma transkrip teksnya saja apa adanya.",
          },
          { type: "image_url", image_url: { url: `data:image/png;base64,${base64}` } },
        ] as any,
      },
    ],
    max_tokens: 2000,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    reasoning_format: "hidden",
  } as any);
  return stripThinkingTags(completion.choices[0]?.message?.content ?? "");
}

async function ocrPdf(buffer: Buffer, totalPages: number): Promise<string> {
  const pagesToProcess = Math.min(totalPages, MAX_OCR_PAGES);
  const results: string[] = [];

  for (let pageNum = 1; pageNum <= pagesToProcess; pageNum++) {
    try {
      const imageBuffer = await renderPageAsImage(new Uint8Array(buffer), pageNum, {
        // unpdf: opsi ini secara RUNTIME namanya "canvasImport" (sudah
        // divalidasi jalan), tapi file tipe TypeScript versi ini masih
        // nulis "canvas" — ketidakcocokan bug di package-nya sendiri.
        // "as any" di sini cuma buat lewatin type-check, perilaku aslinya
        // tetap benar.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        canvasImport: () => import("@napi-rs/canvas"),
        scale: 1.5,
      } as any);
      const pageText = await ocrImageBuffer(imageBuffer);
      results.push(`--- Halaman ${pageNum} ---\n${pageText}`);
    } catch (err) {
      console.error(`OCR gagal di halaman ${pageNum}:`, err);
      results.push(`--- Halaman ${pageNum} ---\n[gagal dibaca]`);
    }
  }

  const note =
    totalPages > MAX_OCR_PAGES
      ? `\n\n[Dokumen ini punya ${totalPages} halaman, hanya ${MAX_OCR_PAGES} halaman pertama yang diproses (hasil scan/gambar butuh proses lebih berat per halaman).]`
      : "";

  return truncate(results.join("\n\n") + note);
}

/**
 * Ekstrak teks dari file yang di-upload user, berdasarkan mime type-nya.
 * base64Data: base64 TANPA prefix "data:...;base64,".
 */
export async function extractTextFromFile(
  mimeType: string,
  base64Data: string,
  filename: string
): Promise<string> {
  const buffer = Buffer.from(base64Data, "base64");

  try {
    if (mimeType === "application/pdf" || filename.toLowerCase().endsWith(".pdf")) {
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { text, totalPages } = await extractText(pdf, { mergePages: true });

      // Kalau teks yang kebaca dikit banget, kemungkinan besar ini PDF hasil
      // scan/foto (isinya gambar, bukan teks asli) — coba OCR sebagai fallback.
      if (text.trim().length < 30) {
        return await ocrPdf(buffer, totalPages);
      }
      return truncate(text);
    }

    if (
      mimeType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      filename.toLowerCase().endsWith(".docx")
    ) {
      const result = await mammoth.extractRawText({ buffer });
      return truncate(result.value);
    }

    if (
      mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      mimeType === "application/vnd.ms-excel" ||
      mimeType === "text/csv" ||
      filename.toLowerCase().endsWith(".xlsx") ||
      filename.toLowerCase().endsWith(".xls") ||
      filename.toLowerCase().endsWith(".csv")
    ) {
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const parts: string[] = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        parts.push(`--- Sheet: ${sheetName} ---\n${csv}`);
      }
      return truncate(parts.join("\n\n"));
    }

    if (mimeType.startsWith("text/") || filename.toLowerCase().endsWith(".txt")) {
      return truncate(buffer.toString("utf-8"));
    }

    throw new Error(`Format file "${filename}" belum didukung.`);
  } catch (err) {
    console.error("Gagal ekstrak file:", err);
    if (err instanceof Error && err.message.startsWith("Format file")) throw err;
    throw new Error(
      `Gagal membaca isi file "${filename}". Pastikan file tidak rusak dan formatnya didukung (PDF, Word, Excel, CSV, TXT).`
    );
  }
}
