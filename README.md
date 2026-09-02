# ✨ Carles.ai

Asisten AI serba bisa dengan login Google, dibangun sebagai proyek
portofolio full-stack.

## ✨ Fitur

- **Chat AI serba bisa** — jawab pertanyaan umum, bantu nulis, coding,
  brainstorming, konsultasi, dll. Ditenagai model open-source lewat Groq
  (gratis, permanen, sangat cepat).
- **Login dengan Google** — pakai NextAuth.js, foto profil & nama Google
  otomatis tampil di setiap pesan yang kamu kirim.
- **Upload gambar** — lampirkan foto, AI otomatis pakai model vision
  untuk "melihat" dan menjawab soal gambar tersebut.
- **UI ala ChatGPT/Claude** — sidebar New Chat & Chat History, jawaban
  AI dirender rapi (list, tabel, bold, code block, dll via markdown).
- **Pengaturan tema** — warna aksen (Biru/Ungu) × mode (Terang/Gelap).
- **Dwibahasa** — toggle Bahasa Indonesia / English.

## 🏗️ Tech Stack

| Bagian     | Teknologi                                                |
| ---------- | --------------------------------------------------------- |
| Framework  | Next.js 14 (App Router) + TypeScript                      |
| Styling    | Tailwind CSS + CSS variables untuk theming                |
| Autentikasi| NextAuth.js + Google OAuth                                 |
| AI Backend | Route Handler `app/api/chat/route.ts` → Groq API (teks: `openai/gpt-oss-120b`, vision: `meta-llama/llama-4-scout-17b-16e-instruct`) |
| Markdown   | react-markdown + remark-gfm (render tabel, list, dll)      |
| Persistensi| `localStorage` untuk riwayat chat & preferensi             |
| Icons      | lucide-react                                               |

```
carles-ai/
├── app/
│   ├── api/auth/[...nextauth]/route.ts   # Handler login Google
│   ├── api/chat/route.ts                 # Endpoint AI (teks + vision)
│   ├── login/page.tsx                    # Halaman login
│   ├── globals.css
│   ├── layout.tsx                        # Root layout + Providers
│   └── page.tsx                          # Halaman utama (cek auth)
├── components/
│   ├── Logo.tsx           # Logo minimalis Carles.ai
│   ├── Providers.tsx      # Bungkus Session/Theme/Language context
│   ├── Sidebar.tsx        # New Chat + History + profil user
│   ├── ChatWindow.tsx     # Area chat + upload gambar
│   ├── MessageBubble.tsx  # Bubble chat + markdown + avatar Google
│   └── SettingsModal.tsx
├── context/
│   ├── ThemeContext.tsx
│   └── LanguageContext.tsx
├── lib/
│   ├── authOptions.ts     # Konfigurasi NextAuth
│   ├── systemPrompt.ts    # Kepribadian AI
│   ├── translations.ts
│   └── useChatHistory.ts
├── types/next-auth.d.ts   # Tipe TypeScript tambahan untuk session
└── .env.local.example
```

## 🚀 Cara Menjalankan

### 1. Prasyarat
- Node.js versi 18 ke atas
- Akun Google (untuk API key Groq & OAuth login)

### 2. Instalasi

```bash
cd carles-ai
npm install
```

### 3. Setup API Key Groq (untuk AI)

1. Buka [console.groq.com/keys](https://console.groq.com/keys), login,
   klik "Create API Key". Key diawali `gsk_...`.

### 4. Setup Login Google (OAuth)

Ini bagian yang agak banyak langkah, tapi sekali setting langsung jalan:

1. Buka [console.cloud.google.com](https://console.cloud.google.com/),
   buat project baru (atau pakai yang sudah ada).
2. Buka menu **APIs & Services > OAuth consent screen**. Pilih
   User Type "External", isi nama app (`Carles.ai`), email kamu di
   kolom yang diminta, lalu Save.
3. Buka menu **APIs & Services > Credentials** > **Create Credentials**
   > **OAuth Client ID**.
4. Pilih Application type: **Web application**.
5. Di bagian **Authorized redirect URIs**, tambahkan persis:
   ```
   http://localhost:3000/api/auth/callback/google
   ```
6. Klik Create. Copy **Client ID** dan **Client Secret** yang muncul.

### 5. Isi file environment

```bash
cp .env.local.example .env.local
```

Edit `.env.local`, isi semua nilainya:

```
GROQ_API_KEY=gsk_...
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
NEXTAUTH_SECRET=isi-string-acak-panjang-apa-saja
NEXTAUTH_URL=http://localhost:3000
```

> `NEXTAUTH_SECRET` bisa diisi string acak apa saja (semakin panjang &
> random semakin aman). Kalau punya terminal dengan `openssl`, jalankan
> `openssl rand -base64 32` untuk generate otomatis.

### 6. Jalankan

```bash
npm run dev
```

Buka [http://localhost:3000](http://localhost:3000) — kamu akan diarahkan
ke halaman login, klik "Masuk dengan Google", lalu masuk ke aplikasi.

## 🌐 Deploy ke Vercel (opsional)

1. Push repo ke GitHub, import di [vercel.com](https://vercel.com).
2. Tambahkan semua environment variable di atas ke dashboard Vercel
   (`GROQ_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `NEXTAUTH_SECRET`). Untuk `NEXTAUTH_URL`, isi dengan URL Vercel kamu
   (misal `https://carles-ai.vercel.app`).
3. **Penting:** balik lagi ke Google Cloud Console > Credentials, tambahkan
   redirect URI production:
   ```
   https://carles-ai.vercel.app/api/auth/callback/google
   ```
   (ganti sesuai domain Vercel kamu, dan jangan hapus yang localhost
   supaya development tetap jalan).
4. Deploy.

## 📄 Lisensi

Bebas digunakan untuk keperluan portofolio/pembelajaran.
