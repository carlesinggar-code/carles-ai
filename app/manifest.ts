import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Carles.ai — Asisten AI Serba Bisa",
    short_name: "Carles.ai",
    description: "Asisten AI serba bisa: tanya jawab, bantu tugas dari gambar, dan info real-time.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#16181c",
    theme_color: "#16181c",
    orientation: "portrait",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
