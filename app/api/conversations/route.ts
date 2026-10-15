import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { hardDeleteConversations, expireOldImages } from "@/lib/imageStorage";

export const runtime = "nodejs";

// Batas jumlah percakapan per akun. Lewat ini, percakapan PALING LAMA
// (berdasarkan updated_at) otomatis dihapus — biar nggak numpuk selamanya
// dan nggak pernah mepetin limit 500MB Supabase.
const MAX_CONVERSATIONS_PER_USER = 150;

async function evictOldestIfNeeded(userEmail: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("conversations")
    .select("id")
    .eq("user_email", userEmail)
    .order("updated_at", { ascending: false });

  if (error || !data) return;

  if (data.length > MAX_CONVERSATIONS_PER_USER) {
    const idsToDelete = data.slice(MAX_CONVERSATIONS_PER_USER).map((c) => c.id);
    // Hapus permanen: file gambar + pesan + percakapan.
    const failure = await hardDeleteConversations(idsToDelete, userEmail);
    if (failure) console.error("[conversations] gagal menghapus percakapan lama:", failure);
  }
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Belum login." }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("conversations")
    .select("id, title, created_at, updated_at")
    .eq("user_email", session.user.email)
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ conversations: data });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Belum login." }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("conversations")
    .insert({ user_email: session.user.email, title: "Percakapan Baru" })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await evictOldestIfNeeded(session.user.email);

  // Pembersihan cadangan: hapus file gambar yang sudah lewat 30 hari. Tugas
  // utamanya dikerjakan cron harian (vercel.json), ini jaring pengaman kalau
  // cron belum aktif.
  // Cukup sesekali (±1 dari 10 permintaan): dulu dijalankan SETIAP kali sehingga
  // membuat percakapan baru lambat di HP dan kadang gagal (jadi "(Local)").
  if (Math.random() < 0.1) {
    try {
      await expireOldImages(undefined, 25);
    } catch (err) {
      console.error("[storage] pembersihan cadangan gagal:", err);
    }
  }

  return NextResponse.json({ conversation: data });
}
