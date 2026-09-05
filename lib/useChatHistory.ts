"use client";

import { useEffect, useState, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  image?: string; // base64 data URL, kalau user melampirkan gambar
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
}

const STORAGE_KEY = "trip-assistant-conversations";

export function useChatHistory() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Load dari localStorage saat mount
  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
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
    }
  }, []);

  // Simpan setiap kali berubah
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  }, [conversations]);

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
