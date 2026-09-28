import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Belum login." }, { status: 401 });
  }

  const body = await req.json();
  const { role, content, imageUrl, fileName, fileMimeType } = body;

  if (!role || typeof content !== "string") {
    return NextResponse.json({ error: "Data pesan tidak lengkap." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  const { data: convo, error: convoErr } = await supabase
    .from("conversations")
    .select("id, title")
    .eq("id", params.id)
    .eq("user_email", session.user.email)
    .single();

  if (convoErr || !convo) {
    return NextResponse.json({ error: "Percakapan tidak ditemukan." }, { status: 404 });
  }

  const { data: message, error: msgErr } = await supabase
    .from("messages")
    .insert({
      conversation_id: params.id,
      role,
      content,
      image_url: imageUrl ?? null,
      file_name: fileName ?? null,
      file_mime_type: fileMimeType ?? null,
    })
    .select()
    .single();

  if (msgErr) {
    return NextResponse.json({ error: msgErr.message }, { status: 500 });
  }

  const isDefaultTitle = convo.title === "Percakapan Baru";
  const newTitle =
    role === "user" && isDefaultTitle
      ? content.slice(0, 40) + (content.length > 40 ? "..." : "")
      : convo.title;

  await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString(), title: newTitle })
    .eq("id", params.id);

  return NextResponse.json({ message });
}
