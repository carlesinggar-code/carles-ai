const CACHE_NAME = "carles-ai-shell-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Cuma tangani GET biasa. Semua endpoint /api/* (chat, apk-info, dst)
  // SENGAJA dilewatin (nggak dicache) — itu harus selalu coba live ke
  // server, nggak boleh kejawab pakai data basi pas offline.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Simpan salinan sukses ke cache buat jaga-jaga kalau nanti offline
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() =>
        // Gagal (kemungkinan offline) → coba ambil dari cache. Kalau request
        // ini sendiri belum pernah kesimpen, fallback ke halaman utama yang
        // udah kecache (biar app shell tetap kebuka, bukan blank/error).
        caches.match(request).then((cached) => cached || caches.match("/"))
      )
  );
});
