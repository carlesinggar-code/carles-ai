// =====================================================================
// Saat user mengirim gambar, AI diminta menutup jawabannya dengan blok
//   <catatan_gambar> ...ringkasan isi gambar... </catatan_gambar>
// Blok itu DISIMPAN (supaya gambar bisa dihapus tapi isinya tetap diingat)
// dan TIDAK ditampilkan ke user. Filter ini memisahkannya dari stream jawaban.
// =====================================================================
const OPEN = "<catatan_gambar>";
const CLOSE = "</catatan_gambar>";

export class NotesFilter {
  private raw = "";
  private emitted = 0;
  private openAt = -1;

  /** Masukkan potongan teks baru; mengembalikan bagian yang AMAN ditampilkan ke user. */
  push(chunk: string): string {
    this.raw += chunk;
    if (this.openAt < 0) {
      const idx = this.raw.indexOf(OPEN);
      if (idx >= 0) this.openAt = idx;
    }
    const safeEnd = this.openAt >= 0 ? this.openAt : this.raw.length - this.holdBack();
    if (safeEnd <= this.emitted) return "";
    const out = this.raw.slice(this.emitted, safeEnd);
    this.emitted = safeEnd;
    return out;
  }

  // Ekor teks yang bisa jadi awal dari penanda — ditahan dulu sampai jelas.
  private holdBack(): number {
    const max = Math.min(OPEN.length - 1, this.raw.length);
    for (let n = max; n > 0; n--) {
      if (OPEN.startsWith(this.raw.slice(this.raw.length - n))) return n;
    }
    return 0;
  }

  /** Panggil saat stream selesai: sisa teks yang tertahan + catatan gambar (kosong kalau AI tidak menulisnya). */
  finish(): { tail: string; notes: string } {
    if (this.openAt < 0) {
      const tail = this.raw.slice(this.emitted);
      this.emitted = this.raw.length;
      return { tail, notes: "" };
    }
    let notes = this.raw.slice(this.openAt + OPEN.length);
    const closeIdx = notes.indexOf(CLOSE);
    if (closeIdx >= 0) notes = notes.slice(0, closeIdx);
    return { tail: "", notes: notes.trim() };
  }
}
