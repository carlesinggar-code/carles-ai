import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { removeImagesOfConversations } from "@/lib/imageStorage";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Belum login." }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();

  // Pastiin percakapan ini emang punya akun yang lagi login (bukan punya
  // orang lain) — penyaringan "punya siapa" dilakuin di sini, di server.
  const { data: convo, error: convoErr } = await supabase
    .from("conversations")
    .select("*")
    .eq("id", params.id)
    .eq("user_email", session.user.email)
    .single();

  if (convoErr || !convo) {
    return NextResponse.json({ error: "Percakapan tidak ditemukan." }, { status: 404 });
  }

  const { data: messages, error: msgErr } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", params.id)
    .order("created_at", { ascending: true });

  if (msgErr) {
    return NextResponse.json({ error: msgErr.message }, { status: 500 });
  }

  return NextResponse.json({ conversation: convo, messages });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Belum login." }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();

  // Pastikan percakapan ini milik akun yang login SEBELUM menghapus file apa pun.
  const { data: owned } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", params.id)
    .eq("user_email", session.user.email)
    .maybeSingle();
  if (!owned) {
    return NextResponse.json({ error: "Percakapan tidak ditemukan." }, { status: 404 });
  }

  // Hapus file gambar di Storage dulu, baru baris databasenya.
  await removeImagesOfConversations([params.id]);

  const { error } = await supabase
    .from("conversations")
    .delete()
    .eq("id", params.id)
    .eq("user_email", session.user.email);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
