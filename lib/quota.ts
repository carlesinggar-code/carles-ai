import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { Lang } from "@/lib/translations";

// =====================================================================
// Jatah pemakaian harian per user + batas global gambar.
// Semua angka bisa diganti lewat Environment Variables (tanpa ubah kode):
//   CHAT_LIMIT_PER_DAY          (default 30)  jumlah pesan chat / user / hari
//   IMAGE_LIMIT_PER_DAY         (default 3)   gambar yang DIBUATKAN AI / user / hari
//   UPLOAD_LIMIT_PER_DAY        (default 10)  gambar yang DIKIRIM user untuk dibaca / hari
//   GLOBAL_IMAGE_LIMIT_PER_DAY  (default 40)  total gambar buatan AI / hari, semua user
//   ADMIN_EMAILS                email admin (pisahkan koma) — tanpa batas
//
// "Hari" mengikuti hari Google (tengah malam waktu Pasifik), supaya reset
// jatah kita sejalan dengan reset kuota Gemini (sekitar 14.00–15.00 WIB).
// =====================================================================

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export const LIMITS = {
  chat: envInt("CHAT_LIMIT_PER_DAY", 30),
  image: envInt("IMAGE_LIMIT_PER_DAY", 3),
  upload: envInt("UPLOAD_LIMIT_PER_DAY", 10),
  globalImage: envInt("GLOBAL_IMAGE_LIMIT_PER_DAY", 40),
};

export type QuotaKind = "chat" | "image" | "upload";
export type QuotaResult =
  | { ok: true; day: string }
  | { ok: false; reason: "user_limit" | "global_limit" };

export function isAdmin(email: string): boolean {
  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email.toLowerCase());
}

/** Tanggal (YYYY-MM-DD) menurut waktu Pasifik — sama dengan reset kuota Google. */
export function quotaDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Jam reset dalam WIB: tengah malam Pasifik = 14.00 WIB (musim panas AS) / 15.00 WIB (musim dingin). */
export function resetTimeWIB(now: Date = new Date()): string {
  const tz = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    timeZoneName: "short",
  }).format(now);
  return /PDT/.test(tz) ? "14.00 WIB" : "15.00 WIB";
}

export async function consumeQuota(
  email: string | null,
  kind: QuotaKind,
  ip?: string
): Promise<QuotaResult> {
  const day = quotaDay();
  const identifier = email?.toLowerCase() || `guest:${ip || "unknown"}`;

  if (email && isAdmin(email)) return { ok: true, day };

  // Batasan khusus untuk tamu (GUEST)
  const isGuest = !email;
  const userLimit = isGuest
    ? kind === "chat"
      ? 5 // Guest cuma boleh 5 chat
      : 0 // Guest TIDAK BOLEH image/upload
    : LIMITS[kind];

  try {
    const { data, error } = await getSupabaseAdmin().rpc("consume_quota", {
      p_email: identifier,
      p_day: day,
      p_kind: kind,
      p_user_limit: userLimit,
      p_global_limit: LIMITS.globalImage,
    });
    if (error) throw new Error(error.message);
    if (data === "ok") return { ok: true, day };
    if (data === "global_limit") return { ok: false, reason: "global_limit" };
    if (data === "user_limit") return { ok: false, reason: "user_limit" };
    throw new Error(`Hasil kuota tidak dikenal: ${String(data)}`);
  } catch (err) {
    console.error("[quota] GAGAL memeriksa kuota, dilewati:", err);
    return { ok: true, day };
  }
}

/** Kembalikan jatah kalau permintaannya ternyata gagal (bukan salah user). */
export async function refundQuota(email: string, kind: QuotaKind, day: string): Promise<void> {
  if (isAdmin(email)) return;
  try {
    const { error } = await getSupabaseAdmin().rpc("refund_quota", {
      p_email: email.toLowerCase(),
      p_day: day,
      p_kind: kind,
    });
    if (error) throw new Error(error.message);
  } catch (err) {
    console.error("[quota] gagal mengembalikan jatah:", err);
  }
}

export function quotaMessage(
  kind: QuotaKind,
  reason: "user_limit" | "global_limit",
  lang: Lang
): string {
  const reset = resetTimeWIB();
  if (lang === "en") {
    if (reason === "global_limit")
      return `Today's image quota is used up. It resets around ${reset}.`;
    if (kind === "image")
      return `You've used your ${LIMITS.image} image creations for today. It resets around ${reset}.`;
    if (kind === "upload")
      return `You've reached today's limit of ${LIMITS.upload} images sent. It resets around ${reset}.`;
    return `You've reached today's limit of ${LIMITS.chat} messages. It resets around ${reset}.`;
  }
  if (reason === "global_limit")
    return `Jatah gambar hari ini habis, reset sekitar jam ${reset}.`;
  if (kind === "image")
    return `Jatah bikin gambar harianmu (${LIMITS.image}) sudah habis. Reset sekitar jam ${reset}.`;
  if (kind === "upload")
    return `Jatah kirim gambar harianmu (${LIMITS.upload}) sudah habis. Reset sekitar jam ${reset}.`;
  return `Jatah chat harianmu (${LIMITS.chat} pesan) sudah habis. Reset sekitar jam ${reset}.`;
}
