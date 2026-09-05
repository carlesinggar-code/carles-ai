import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Taruh file APK-nya di public/carles-ai.apk — route ini otomatis
// ngecek ada/nggaknya + ukurannya, jadi tombol "Unduh App" di Settings
// nggak perlu diutak-atik manual tiap kali file APK-nya diganti/di-update.
export async function GET() {
  const apkPath = path.join(process.cwd(), "public", "carles-ai.apk");

  try {
    const stat = fs.statSync(apkPath);
    const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);
    return NextResponse.json({ available: true, sizeMB });
  } catch {
    return NextResponse.json({ available: false });
  }
}
