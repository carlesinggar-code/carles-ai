import { NextRequest, NextResponse } from "next/server";
import { expireOldImages } from "@/lib/imageStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Dipanggil otomatis tiap hari oleh Vercel Cron (lihat vercel.json).
// Vercel mengirim header "Authorization: Bearer <CRON_SECRET>" — kalau
// CRON_SECRET belum diset di Environment Variables, endpoint ini menolak semua.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 401 });
  }

  let total = 0;
  for (let round = 0; round < 10; round++) {
    const n = await expireOldImages(undefined, 100);
    total += n;
    if (n < 100) break;
  }
  return NextResponse.json({ expired: total });
}
