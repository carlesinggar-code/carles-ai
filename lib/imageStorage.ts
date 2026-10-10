import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// =====================================================================
// Semua urusan file gambar di Supabase Storage: hapus saat percakapan /
// pesan dihapus, kedaluwarsa otomatis, dan pembersihan gambar kiriman user
// (isinya sudah dicatat sebagai teks, jadi file-nya tidak perlu disimpan).
//
//   IMAGE_MAX_AGE_DAYS     (default 30)  umur maksimal file gambar
//   UPLOAD_KEEP_MESSAGES   (default 3)   gambar kiriman user dihapus setelah
//                                        sekian pesan user berikutnya
// =====================================================================

export const IMAGE_BUCKET = "chat-images";
const PUBLIC_MARKER = `/storage/v1/object/public/${IMAGE_BUCKET}/`;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export const IMAGE_MAX_AGE_DAYS = envInt("IMAGE_MAX_AGE_DAYS", 30);
export const UPLOAD_KEEP_MESSAGES = envInt("UPLOAD_KEEP_MESSAGES", 3);

/** URL publik Supabase -> path file di dalam bucket (atau null kalau bukan URL kita). */
export function storagePathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const i = url.indexOf(PUBLIC_MARKER);
  if (i < 0) return null;
  try {
    return decodeURIComponent(url.slice(i + PUBLIC_MARKER.length).split("?")[0]);
  } catch {
    return null;
  }
}

export async function removeImagesByUrls(urls: Array<string | null | undefined>): Promise<void> {
  const paths = Array.from(
    new Set(urls.map(storagePathFromUrl).filter((p): p is string => !!p))
  );
  if (paths.length === 0) return;
  const supabase = getSupabaseAdmin();
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await supabase.storage.from(IMAGE_BUCKET).remove(paths.slice(i, i + 100));
    if (error) console.error("[storage] gagal menghapus file gambar:", error.message);
  }
}

/** Hapus SEMUA file gambar milik percakapan-percakapan ini (dipanggil sebelum baris DB dihapus). */
export async function removeImagesOfConversations(conversationIds: string[]): Promise<void> {
  if (conversationIds.length === 0) return;
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("messages")
      .select("image_url")
      .in("conversation_id", conversationIds)
      .not("image_url", "is", null);
    if (error) throw new Error(error.message);
    await removeImagesByUrls((data ?? []).map((r) => r.image_url));
  } catch (err) {
    console.error("[storage] gagal membersihkan gambar percakapan:", err);
  }
}

/**
 * Gambar KIRIMAN USER dihapus setelah `keep` pesan user berikutnya — tapi
 * HANYA kalau catatan isi gambarnya (image_notes) sudah tersimpan, supaya AI
 * tetap bisa menjawab pertanyaan lanjutan. Mengembalikan id pesan yang dihapus gambarnya.
 */
export async function expireUploadedImagesInConversation(
  conversationId: string,
  keep: number = UPLOAD_KEEP_MESSAGES
): Promise<string[]> {
  const supabase = getSupabaseAdmin();
  const { data: rows, error } = await supabase
    .from("messages")
    .select("id, role, image_url, image_notes, image_expired, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error || !rows) return [];

  const userRows = rows.filter((r) => r.role === "user");
  const toExpire = userRows.filter(
    (r, i) => r.image_url && !r.image_expired && r.image_notes && userRows.length - 1 - i >= keep
  );
  if (toExpire.length === 0) return [];

  await removeImagesByUrls(toExpire.map((r) => r.image_url));
  const ids = toExpire.map((r) => r.id as string);
  await supabase.from("messages").update({ image_url: null, image_expired: true }).in("id", ids);
  return ids;
}

/** Hapus file gambar yang umurnya lewat batas (gambar buatan AI & sisa kiriman user). Teks pesannya tetap ada. */
export async function expireOldImages(
  maxAgeDays: number = IMAGE_MAX_AGE_DAYS,
  limit = 50
): Promise<number> {
  try {
    const supabase = getSupabaseAdmin();
    const cutoff = new Date(Date.now() - maxAgeDays * 86_400_000).toISOString();
    const { data, error } = await supabase
      .from("messages")
      .select("id, image_url")
      .not("image_url", "is", null)
      .eq("image_expired", false)
      .lt("created_at", cutoff)
      .limit(limit);
    if (error || !data || data.length === 0) return 0;

    await removeImagesByUrls(data.map((r) => r.image_url));
    await supabase
      .from("messages")
      .update({ image_url: null, image_expired: true })
      .in("id", data.map((r) => r.id));
    return data.length;
  } catch (err) {
    console.error("[storage] gagal membersihkan gambar kedaluwarsa:", err);
    return 0;
  }
}
