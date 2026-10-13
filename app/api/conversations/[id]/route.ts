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

  // Dua query jalan BERSAMAAN (dulu berurutan = 2x lebih lama). Kepemilikan
  // tetap dicek: kalau percakapan bukan milik akun ini, pesan tidak dikirim.
  const [convoRes, msgRes] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, title, created_at, updated_at")
      .eq("id", params.id)
      .eq("user_email", session.user.email)
      .maybeSingle(),
    supabase
      .from("messages")
      .select("id, role, content, image_url, image_expired, image_notes, file_name, file_mime_type, created_at")
      .eq("conversation_id", params.id)
      .order("created_at", { ascending: true }),
  ]);

  const convo = convoRes.data;
  if (convoRes.error || !convo) {
    return NextResponse.json({ error: "Percakapan tidak ditemukan." }, { status: 404 });
  }
  if (msgRes.error) {
    return NextResponse.json({ error: msgRes.error.message }, { status: 500 });
  }
  const messages = msgRes.data;

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
