"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { v4 as uuidv4 } from "uuid";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  image?: string;
  imageExpired?: boolean;
  imageNotes?: string;
  file?: {
    name: string;
    mimeType: string;
  };
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
}

interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapDbMessage(row: any): ChatMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    image: row.image_expired ? undefined : (row.image_url ?? undefined),
    imageExpired: !!row.image_expired,
    imageNotes: row.image_notes ?? undefined,
    file: row.file_name ? { name: row.file_name, mimeType: row.file_mime_type } : undefined,
    createdAt: new Date(row.created_at).getTime(),
  };
}

export function useChatHistory() {
  const { status } = useSession();
  const [conversationsList, setConversationsList] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  // Semua pesan disimpan PER PERCAKAPAN (id -> daftar pesan). Dengan begini:
  //  - klik riwayat yang pernah dibuka langsung tampil (tanpa nunggu server),
  //  - jawaban AI yang selesai saat kamu sudah pindah percakapan masuk ke
  //    percakapan yang BENAR, bukan nyasar ke percakapan yang sedang dibuka.
  const [messagesById, setMessagesById] = useState<Record<string, ChatMessage[]>>({});
  const [loadingList, setLoadingList] = useState(true);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const fetchTokenRef = useRef(0);
  const messagesRef = useRef<Record<string, ChatMessage[]>>({});
  // Jumlah pesan yang sedang disimpan ke server per percakapan. Selama ada,
  // hasil unduhan dari server TIDAK boleh menimpa data lokal (bisa belum lengkap).
  const pendingSavesRef = useRef<Record<string, number>>({});
  // Penghitung "ada pesan baru" per percakapan: kalau berubah selama unduhan
  // berjalan, hasil unduhan dibuang (sudah usang).
  const saveEpochRef = useRef<Record<string, number>>({});

  const setMessages = useCallback(
    (convoId: string, updater: (prev: ChatMessage[]) => ChatMessage[]) => {
      setMessagesById((all) => {
        const next = { ...all, [convoId]: updater(all[convoId] ?? []) };
        messagesRef.current = next;
        return next;
      });
    },
    []
  );

  const refreshList = useCallback(async () => {
    if (status !== "authenticated") {
      setLoadingList(false);
      return;
    }
    setLoadingList(true);
    try {
      const res = await fetch("/api/conversations");
      if (!res.ok) return;
      const data = await res.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setConversationsList(
        (data.conversations ?? []).map((c: any) => ({
          id: c.id,
          title: c.title,
          updatedAt: new Date(c.updated_at).getTime(),
        }))
      );
    } catch {
      // biarin list kosong kalau gagal, jangan crash app
    } finally {
      setLoadingList(false);
    }
  }, [status]);

  useEffect(() => {
    refreshList();
  }, [refreshList, status]);

  const setActiveId = useCallback(
    (id: string | null) => {
      setActiveIdState(id);
      if (!id || id.startsWith("local-")) return;

      const token = ++fetchTokenRef.current;
      const hasCache = messagesRef.current[id] !== undefined;
      // Sudah pernah dibuka → tampil langsung, lalu diam-diam disegarkan.
      setLoadingId(hasCache ? null : id);
      const epochAtStart = saveEpochRef.current[id] ?? 0;

      fetch(`/api/conversations/${id}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!data) return;
          if ((pendingSavesRef.current[id] ?? 0) > 0) return; // ada pesan yang belum tersimpan
          if ((saveEpochRef.current[id] ?? 0) !== epochAtStart) return; // ada pesan baru, data ini usang
          const fresh: ChatMessage[] = (data.messages ?? []).map(mapDbMessage);
          setMessages(id, () => fresh);
        })
        .catch(() => {})
        .finally(() => {
          if (token === fetchTokenRef.current) setLoadingId(null);
        });
    },
    [setMessages]
  );

  const createConversation = useCallback(async (): Promise<string> => {
    if (status !== "authenticated") {
      const newId = `local-${uuidv4()}`;
      setConversationsList((prev) => [{ id: newId, title: "Percakapan Baru", updatedAt: Date.now() }, ...prev]);
      setMessages(newId, () => []);
      setActiveIdState(newId);
      return newId;
    }

    try {
      // Coba sekali lagi kalau gagal (sinyal HP sering putus-nyambung) sebelum
      // menyerah ke percakapan "(Local)".
      let res: Response;
      try {
        res = await fetch("/api/conversations", { method: "POST" });
      } catch {
        await new Promise((r) => setTimeout(r, 800));
        res = await fetch("/api/conversations", { method: "POST" });
      }
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const convo = data.conversation;
      setConversationsList((prev) => [
        { id: convo.id, title: convo.title, updatedAt: new Date(convo.updated_at).getTime() },
        ...prev,
      ]);
      setMessages(convo.id, () => []);
      setActiveIdState(convo.id);
      return convo.id as string;
    } catch (err) {
      console.error("Gagal membuat percakapan di server:", err);
      // Fallback ke lokal jika API gagal
      const newId = `local-${uuidv4()}`;
      setConversationsList((prev) => [{ id: newId, title: "Percakapan Baru (Local)", updatedAt: Date.now() }, ...prev]);
      setMessages(newId, () => []);
      setActiveIdState(newId);
      return newId;
    }
  }, [status, setMessages]);

  const goToNewChat = useCallback(() => {
    fetchTokenRef.current++;
    setLoadingId(null);
    setActiveIdState(null);
  }, []);

  const deleteConversation = useCallback(
    async (id: string) => {
      setConversationsList((prev) => prev.filter((c) => c.id !== id));
      setMessagesById((all) => {
        const next = { ...all };
        delete next[id];
        messagesRef.current = next;
        return next;
      });
      setActiveIdState((cur) => (cur === id ? null : cur));

      if (!id.startsWith("local-")) {
        try {
          const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
          // Gagal dihapus di server → muat ulang daftar supaya tidak berbohong
          // (percakapan yang masih ada di server muncul lagi).
          if (!res.ok) refreshList();
        } catch {
          refreshList();
        }
      }
    },
    [refreshList]
  );

  const addMessage = useCallback(
    async (conversationId: string, message: ChatMessage) => {
      saveEpochRef.current[conversationId] = (saveEpochRef.current[conversationId] ?? 0) + 1;
      setMessages(conversationId, (prev) => {
        const next = [...prev, message];
        if (message.role === "assistant" && message.imageNotes) {
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].role === "user") {
              next[i] = { ...prev[i], imageNotes: message.imageNotes };
              break;
            }
          }
        }
        return next;
      });

      if (!conversationId.startsWith("local-")) {
        pendingSavesRef.current[conversationId] = (pendingSavesRef.current[conversationId] ?? 0) + 1;
        try {
          const res = await fetch(`/api/conversations/${conversationId}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              role: message.role,
              content: message.content,
              imageUrl: message.image,
              fileName: message.file?.name,
              fileMimeType: message.file?.mimeType,
              imageNotes: message.imageNotes,
            }),
          });
          const data = await res.json();
          const expiredIds: string[] = data.expiredMessageIds ?? [];
          if (data.message || expiredIds.length > 0 || data.notesAttachedTo) {
            setMessages(conversationId, (prev) =>
              prev.map((m) => {
                let next = m;
                if (data.message && m.id === message.id) next = mapDbMessage(data.message);
                if (expiredIds.includes(next.id)) {
                  next = { ...next, image: undefined, imageExpired: true };
                }
                if (data.notesAttachedTo && next.id === data.notesAttachedTo && message.imageNotes) {
                  next = { ...next, imageNotes: message.imageNotes };
                }
                return next;
              })
            );
          }
        } catch {
          // ignore
        } finally {
          pendingSavesRef.current[conversationId] = Math.max(
            0,
            (pendingSavesRef.current[conversationId] ?? 1) - 1
          );
        }
      }

      setConversationsList((prev) => {
        const idx = prev.findIndex((c) => c.id === conversationId);
        if (idx === -1) return prev;
        const updated = { ...prev[idx], updatedAt: Date.now() };
        if (prev[idx].title === "Percakapan Baru" && message.role === "user") {
          updated.title = message.content.slice(0, 40) + (message.content.length > 40 ? "..." : "");
        }
        const rest = prev.filter((_, i) => i !== idx);
        return [updated, ...rest];
      });
    },
    [setMessages]
  );

  const updateMessage = useCallback(
    async (conversationId: string, messageId: string, content: string) => {
      setMessages(conversationId, (prev) => prev.map((m) => (m.id === messageId ? { ...m, content } : m)));
      if (!conversationId.startsWith("local-")) {
        try {
          await fetch(`/api/messages/${messageId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content }),
          });
        } catch {
          // ignore
        }
      }
    },
    [setMessages]
  );

  const activeMessages = activeId ? messagesById[activeId] ?? [] : [];

  const activeConversation: Conversation | null = activeId
    ? {
        id: activeId,
        title: conversationsList.find((c) => c.id === activeId)?.title ?? "Percakapan Baru",
        messages: activeMessages,
        updatedAt: Date.now(),
      }
    : null;

  const conversations: Conversation[] = conversationsList.map((c) => ({
    id: c.id,
    title: c.title,
    messages: c.id === activeId ? activeMessages : [],
    updatedAt: c.updatedAt,
  }));

  return {
    conversations,
    activeConversation,
    activeId,
    setActiveId,
    createConversation,
    goToNewChat,
    deleteConversation,
    addMessage,
    updateMessage,
    loadingList,
    loadingMessages: loadingId !== null && loadingId === activeId,
  };
}
