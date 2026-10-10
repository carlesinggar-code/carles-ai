import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { getDocumentProxy, extractText } from "unpdf";
import { transcribeWithGemini } from "@/lib/gemini";

// Batas panjang teks hasil ekstraksi yang dikirim ke AI. Dokumen yang
// kepanjangan bisa bikin boros token / kena limit, jadi kita potong dan
// kasih tau kalau ada bagian yang terpotong.
const MAX_CHARS = 20000;

function truncate(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_CHARS) return trimmed;
  return (
    trimmed.slice(0, MAX_CHARS) +
    "\n\n[...isi dokumen dipotong karena terlalu panjang...]"
  );
}

// PDF hasil scan/foto (nggak ada teks asli) dibaca LANGSUNG oleh Gemini.
// Gemini bisa menerima PDF utuh, jadi nggak perlu lagi render halaman
// satu per satu (cara lama pakai @napi-rs/canvas + Groq, dibatasi 5 halaman).
async function ocrPdf(buffer: Buffer): Promise<string> {
  const text = await transcribeWithGemini(
    { mimeType: "application/pdf", data: buffer.toString("base64") },
    "Ini adalah dokumen hasil scan. Tuliskan ulang PERSIS semua teks yang terlihat, halaman demi halaman (beri penanda '--- Halaman N ---'). Jangan menambah komentar, penjelasan, atau opini apapun — cuma transkrip teksnya saja apa adanya."
  );
  if (!text) {
    throw new Error("PDF ini tidak bisa dibaca (isinya kosong atau terlalu buram).");
  }
  return truncate(text);
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
      const { text } = await extractText(pdf, { mergePages: true });

      // Kalau teks yang kebaca dikit banget, kemungkinan besar ini PDF hasil
      // scan/foto (isinya gambar, bukan teks asli) — coba OCR sebagai fallback.
      if (text.trim().length < 30) {
        return await ocrPdf(buffer);
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
