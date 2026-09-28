import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const BUCKET = "chat-images";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Belum login." }, { status: 401 });
  }

  const { dataUrl } = await req.json();
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    return NextResponse.json({ error: "Format gambar tidak valid." }, { status: 400 });
  }

  const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) {
    return NextResponse.json({ error: "Format gambar tidak valid." }, { status: 400 });
  }
  const [, mimeType, base64] = match;
  const ext = mimeType.split("/")[1] || "jpg";
  const buffer = Buffer.from(base64, "base64");

  const supabase = getSupabaseAdmin();
  const filePath = `${session.user.email}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(filePath, buffer, { contentType: mimeType, upsert: false });

  if (uploadErr) {
    return NextResponse.json({ error: uploadErr.message }, { status: 500 });
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(filePath);

  return NextResponse.json({ url: data.publicUrl });
}
