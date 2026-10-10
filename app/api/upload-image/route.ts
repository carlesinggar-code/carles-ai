import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { IMAGE_BUCKET } from "@/lib/imageStorage";
import { consumeQuota, refundQuota, quotaMessage } from "@/lib/quota";

export const runtime = "nodejs";

const MAX_BASE64_CHARS = 8 * 1024 * 1024; // ~6 MB gambar asli
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Belum login." }, { status: 401 });
  }
  const email = session.user.email;

  let dataUrl: unknown;
  let lang: unknown;
  try {
    ({ dataUrl, lang } = await req.json());
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    return NextResponse.json({ error: "Format gambar tidak valid." }, { status: 400 });
  }

  const sep = dataUrl.indexOf(";base64,");
  if (sep < 0) {
    return NextResponse.json({ error: "Format gambar tidak valid." }, { status: 400 });
  }
  const mimeType = dataUrl.slice(5, sep);
  const base64 = dataUrl.slice(sep + 8);
  if (!ALLOWED_MIME.includes(mimeType) || base64.length === 0 || base64.length > MAX_BASE64_CHARS) {
    return NextResponse.json(
      { error: "Gambar tidak valid atau terlalu besar (maks ±6 MB)." },
      { status: 400 }
    );
  }

  // Batas jumlah gambar yang boleh dikirim per hari (melindungi storage).
  const quota = await consumeQuota(email, "upload");
  if (!quota.ok) {
    return NextResponse.json(
      { error: quotaMessage("upload", quota.reason, lang === "en" ? "en" : "id") },
      { status: 429 }
    );
  }

  const ext = mimeType.split("/")[1].replace("jpeg", "jpg");
  const buffer = Buffer.from(base64, "base64");

  const supabase = getSupabaseAdmin();
  const filePath = `${email}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from(IMAGE_BUCKET)
    .upload(filePath, buffer, { contentType: mimeType, upsert: false });

  if (uploadErr) {
    await refundQuota(email, "upload", quota.day);
    return NextResponse.json({ error: uploadErr.message }, { status: 500 });
  }

  const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(filePath);
  return NextResponse.json({ url: data.publicUrl });
}
