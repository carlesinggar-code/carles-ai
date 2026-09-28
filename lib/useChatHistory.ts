"use client";

import { useEffect, useState, useCallback, useRef } from "react";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  image?: string; // URL (dari Supabase Storage) setelah tersimpan
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
    image: row.image_url ?? undefined,
    file: row.file_name ? { name: row.file_name, mimeType: row.file_mime_type } : undefined,
    createdAt: new Date(row.created_at).getTime(),
  };
}

export function useChatHistory() {
  const [conversationsList, setConversationsList] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [activeMessages, setActiveMessages] = useState<ChatMessage[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const fetchTokenRef = useRef(0);

  const refreshList = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  const setActiveId = useCallback((id: string | null) => {
    setActiveIdState(id);
    setActiveMessages([]);
    if (!id) return;

    const token = ++fetchTokenRef.current;
    setLoadingMessages(true);
    fetch(`/api/conversations/${id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (token !== fetchTokenRef.current || !data) return;
        setActiveMessages((data.messages ?? []).map(mapDbMessage));
      })
      .catch(() => {})
      .finally(() => {
        if (token === fetchTokenRef.current) setLoadingMessages(false);
      });
  }, []);

  const createConversation = useCallback((): Promise<string> => {
    return fetch("/api/conversations", { method: "POST" })
      .then((res) => res.json())
      .then((data) => {
        const convo = data.conversation;
        setConversationsList((prev) => [
          { id: convo.id, title: convo.title, updatedAt: new Date(convo.updated_at).getTime() },
          ...prev,
        ]);
        setActiveIdState(convo.id);
        setActiveMessages([]);
        return convo.id as string;
      });
  }, []);

  const goToNewChat = useCallback(() => {
    setActiveIdState(null);
    setActiveMessages([]);
  }, []);

  const deleteConversation = useCallback(
    async (id: string) => {
      setConversationsList((prev) => prev.filter((c) => c.id !== id));
      if (activeId === id) {
        setActiveIdState(null);
        setActiveMessages([]);
      }
      await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    },
    [activeId]
  );

  const addMessage = useCallback(async (conversationId: string, message: ChatMessage) => {
    setActiveMessages((prev) => [...prev, message]);

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
        }),
      });
      const data = await res.json();
      if (data.message) {
        setActiveMessages((prev) =>
          prev.map((m) => (m.id === message.id ? mapDbMessage(data.message) : m))
        );
      }
    } catch {
      // kalau gagal simpen ke server, pesannya tetep kelihatan di sesi ini
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
  }, []);

  const updateMessage = useCallback(
    async (conversationId: string, messageId: string, content: string) => {
      setActiveMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, content } : m)));
      try {
        await fetch(`/api/messages/${messageId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        });
      } catch {
        // biarin, minimal UI udah keupdate buat sesi ini
      }
    },
    []
  );

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
    loadingMessages,
  };
}
