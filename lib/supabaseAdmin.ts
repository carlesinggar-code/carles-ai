import { createClient } from "@supabase/supabase-js";

// PENTING: file ini CUMA boleh dipakai di server (API routes), NGGAK PERNAH
// di komponen client — Service Role Key itu "kunci master" yang bisa baca/
// tulis SEMUA data tanpa batasan, jangan sampai ke-expose ke browser.
export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diset di server.");
  }
  return createClient(url, key);
}
