"use client";

import { useEffect, useState, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  image?: string; // base64 data URL, kalau user melampirkan gambar
  file?: {
    name: string;
    mimeType: string;
    data?: string; // base64 (tanpa prefix data URL) — cuma disimpan buat pesan TERAKHIR, lihat catatan di ChatWindow
  };
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
}

const STORAGE_KEY_PREFIX = "trip-assistant-conversations";

// Riwayat chat sekarang di-scope per akun (pakai email user) — bukan satu
// kunci global — biar kalau ganti akun Google di device/browser yang sama,
// riwayatnya nggak kecampur.
export function useChatHistory(userEmail: string | null | undefined) {
  const storageKey = userEmail
    ? `${STORAGE_KEY_PREFIX}:${userEmail}`
    : STORAGE_KEY_PREFIX;

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Load dari localStorage saat mount ATAU saat akun (userEmail) berubah
  useEffect(() => {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      try {
        const parsed: Conversation[] = JSON.parse(raw);
        setConversations(parsed);
        // Sengaja TIDAK auto-select percakapan terakhir di sini — user selalu
        // mendarat di layar "chat baru" saat buka/reload app. Riwayat lama
        // tetap ada dan bisa diklik dari sidebar.
      } catch {
        // data korup, abaikan
      }
    } else {
      // Akun ini belum punya riwayat tersimpan — kosongkan (penting pas
      // ganti akun di sesi yang sama, biar nggak nyisa punya akun sebelumnya)
      setConversations([]);
    }
    setActiveId(null);
  }, [storageKey]);

  // Simpan setiap kali berubah
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(conversations));
  }, [conversations, storageKey]);

  const activeConversation =
    conversations.find((c) => c.id === activeId) ?? null;

  const createConversation = useCallback(() => {
    const newConvo: Conversation = {
      id: uuidv4(),
      title: "Percakapan Baru",
      messages: [],
      updatedAt: Date.now(),
    };
    setConversations((prev) => [newConvo, ...prev]);
    setActiveId(newConvo.id);
    return newConvo.id;
  }, []);

  // Dipakai tombol "Percakapan Baru": cuma reset TAMPILAN ke kosong, TANPA
  // bikin entri history baru. Entri history beneran baru dibuat pas pesan
  // pertama dikirim (lewat createConversation, dipanggil dari
  // handleEnsureConversation). Ini yang mencegah history numpuk banyak
  // "Percakapan Baru" kosong kalau tombolnya diklik berkali-kali.
  const goToNewChat = useCallback(() => {
    setActiveId(null);
  }, []);

  const deleteConversation = useCallback(
    (id: string) => {
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeId === id) setActiveId(null);
    },
    [activeId]
  );

  const addMessage = useCallback(
    (conversationId: string, message: ChatMessage) => {
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== conversationId) return c;
          const isFirstUserMsg = c.messages.length === 0 && message.role === "user";
          return {
            ...c,
            messages: [...c.messages, message],
            title: isFirstUserMsg
              ? message.content.slice(0, 40) +
                (message.content.length > 40 ? "..." : "")
              : c.title,
            updatedAt: Date.now(),
          };
        })
      );
    },
    []
  );

  // Dipakai buat fitur "Ulangi" — ganti isi satu pesan (assistant) di tempat,
  // tanpa nambah pesan baru.
  const updateMessage = useCallback(
    (conversationId: string, messageId: string, newContent: string) => {
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== conversationId) return c;
          return {
            ...c,
            messages: c.messages.map((m) =>
              m.id === messageId ? { ...m, content: newContent } : m
            ),
            updatedAt: Date.now(),
          };
        })
      );
    },
    []
  );

  return {
    conversations: conversations.sort((a, b) => b.updatedAt - a.updatedAt),
    activeConversation,
    activeId,
    setActiveId,
    createConversation,
    goToNewChat,
    deleteConversation,
    addMessage,
    updateMessage,
  };
}
