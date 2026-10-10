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
  const { data: session, status } = useSession();
  const [conversationsList, setConversationsList] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [activeMessages, setActiveMessages] = useState<ChatMessage[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const fetchTokenRef = useRef(0);

  // Simpanan lokal untuk GUEST
  const [localConversations, setLocalConversations] = useState<Record<string, ChatMessage[]>>({});

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

  const setActiveId = useCallback((id: string | null) => {
    setActiveIdState(id);
    setActiveMessages([]);
    if (!id) return;

    // Jika id adalah UUID lokal (untuk guest)
    if (id.startsWith("local-")) {
      setActiveMessages(localConversations[id] || []);
      return;
    }

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
  }, [localConversations]);

  const createConversation = useCallback(async (): Promise<string> => {
    if (status !== "authenticated") {
      const newId = `local-${uuidv4()}`;
      const newConvo = {
        id: newId,
        title: "Percakapan Baru",
        updatedAt: Date.now(),
      };
      setConversationsList((prev) => [newConvo, ...prev]);
      setLocalConversations((prev) => ({ ...prev, [newId]: [] }));
      setActiveIdState(newId);
      setActiveMessages([]);
      return newId;
    }

    try {
      const res = await fetch("/api/conversations", { method: "POST" });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const convo = data.conversation;
      setConversationsList((prev) => [
        { id: convo.id, title: convo.title, updatedAt: new Date(convo.updated_at).getTime() },
        ...prev,
      ]);
      setActiveIdState(convo.id);
      setActiveMessages([]);
      return convo.id as string;
    } catch (err) {
      console.error("Gagal membuat percakapan di server:", err);
      // Fallback ke lokal jika API gagal
      const newId = `local-${uuidv4()}`;
      setConversationsList((prev) => [{ id: newId, title: "Percakapan Baru (Local)", updatedAt: Date.now() }, ...prev]);
      setActiveIdState(newId);
      return newId;
    }
  }, [status]);

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

      if (id.startsWith("local-")) {
        setLocalConversations((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      } else {
        await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      }
    },
    [activeId]
  );

  const addMessage = useCallback(async (conversationId: string, message: ChatMessage) => {
    setActiveMessages((prev) => {
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

    if (conversationId.startsWith("local-")) {
      setLocalConversations((prev) => ({
        ...prev,
        [conversationId]: [...(prev[conversationId] || []), message],
      }));
    } else {
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
          setActiveMessages((prev) =>
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
  }, []);

  const updateMessage = useCallback(
    async (conversationId: string, messageId: string, content: string) => {
      setActiveMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, content } : m)));
      if (conversationId.startsWith("local-")) {
        setLocalConversations(prev => ({
          ...prev,
          [conversationId]: prev[conversationId]?.map(m => m.id === messageId ? { ...m, content } : m) || []
        }));
      } else {
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
