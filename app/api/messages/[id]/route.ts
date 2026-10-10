import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { removeImagesByUrls } from "@/lib/imageStorage";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Belum login." }, { status: 401 });
  }

  const { content } = await req.json();
  if (typeof content !== "string") {
    return NextResponse.json({ error: "Content tidak valid." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  const { data: message, error: findErr } = await supabase
    .from("messages")
    .select("id, conversation_id")
    .eq("id", params.id)
    .single();

  if (findErr || !message) {
    return NextResponse.json({ error: "Pesan tidak ditemukan." }, { status: 404 });
  }

  const { data: convo } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", message.conversation_id)
    .eq("user_email", session.user.email)
    .single();

  if (!convo) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  const { error } = await supabase.from("messages").update({ content }).eq("id", params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// Hapus satu pesan — sekaligus file gambar yang menempel padanya.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Belum login." }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();

  const { data: message, error: findErr } = await supabase
    .from("messages")
    .select("id, conversation_id, image_url")
    .eq("id", params.id)
    .single();

  if (findErr || !message) {
    return NextResponse.json({ error: "Pesan tidak ditemukan." }, { status: 404 });
  }

  const { data: convo } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", message.conversation_id)
    .eq("user_email", session.user.email)
    .single();

  if (!convo) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  await removeImagesByUrls([message.image_url]);

  const { error } = await supabase.from("messages").delete().eq("id", params.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
