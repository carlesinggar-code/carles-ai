"use client";

import { signIn } from "next-auth/react";
import Logo from "@/components/Logo";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: "var(--bg-secondary)" }}>
      <div
        className="w-full max-w-sm rounded-2xl shadow-sm border p-8 text-center"
        style={{ backgroundColor: "var(--bg-primary)", borderColor: "var(--border-color)" }}
      >
        <div className="flex justify-center mb-6">
          <Logo size={40} withText={false} />
        </div>

        <h1 className="text-xl font-semibold mb-1">Selamat datang di Carles.ai</h1>
        <p className="text-sm mb-8" style={{ color: "var(--text-secondary)" }}>
          Asisten AI yang siap membantu apapun yang kamu butuhkan.
        </p>

        <button
          onClick={() => signIn("google", { callbackUrl: "/" })}
          className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl border font-medium text-sm hover:bg-black/5 transition-colors"
          style={{ borderColor: "var(--border-color)" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M23.52 12.27c0-.85-.08-1.67-.22-2.46H12v4.66h6.47c-.28 1.5-1.13 2.78-2.4 3.64v3.02h3.88c2.27-2.09 3.57-5.17 3.57-8.86z"
            />
            <path
              fill="#34A853"
              d="M12 24c3.24 0 5.96-1.08 7.95-2.91l-3.88-3.02c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.27v3.12C3.25 21.3 7.31 24 12 24z"
            />
            <path
              fill="#FBBC05"
              d="M5.27 14.26c-.24-.72-.38-1.49-.38-2.26s.14-1.54.38-2.26V6.62H1.27C.46 8.24 0 10.07 0 12s.46 3.76 1.27 5.38l4-3.12z"
            />
            <path
              fill="#EA4335"
              d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0 7.31 0 3.25 2.7 1.27 6.62l4 3.12C6.22 6.86 8.87 4.75 12 4.75z"
            />
          </svg>
          Masuk dengan Google
        </button>

        <p className="text-xs mt-6" style={{ color: "var(--text-secondary)" }}>
          Dengan masuk, kamu setuju foto profil & nama akun Google-mu
          ditampilkan di dalam percakapan.
        </p>
      </div>
    </div>
  );
}
