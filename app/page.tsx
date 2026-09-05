"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { X, Loader2 } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import ChatWindow from "@/components/ChatWindow";
import SettingsModal from "@/components/SettingsModal";
import LoginPage from "@/app/login/page";
import { useChatHistory } from "@/lib/useChatHistory";

export default function Home() {
  const { data: session, status } = useSession();

  const {
    conversations,
    activeConversation,
    activeId,
    setActiveId,
    createConversation,
    goToNewChat,
    deleteConversation,
    addMessage,
    updateMessage,
  } = useChatHistory();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-accent" size={28} />
      </div>
    );
  }

  if (status === "unauthenticated" || !session) {
    return <LoginPage />;
  }

  function handleEnsureConversation() {
    if (activeConversation) return activeConversation.id;
    return createConversation();
  }

  return (
    <main className="flex h-dvh overflow-hidden">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={(id) => {
          setActiveId(id);
          setMobileSidebarOpen(false);
        }}
        onNewChat={() => {
          goToNewChat();
          setMobileSidebarOpen(false);
        }}
        onDelete={deleteConversation}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div className="w-72 h-full" style={{ backgroundColor: "var(--bg-sidebar)" }}>
            <div className="flex justify-end p-3">
              <button onClick={() => setMobileSidebarOpen(false)}>
                <X size={20} />
              </button>
            </div>
            <Sidebar
              variant="mobile"
              conversations={conversations}
              activeId={activeId}
              onSelect={(id) => {
                setActiveId(id);
                setMobileSidebarOpen(false);
              }}
              onNewChat={() => {
                goToNewChat();
                setMobileSidebarOpen(false);
              }}
              onDelete={deleteConversation}
              onOpenSettings={() => {
                setSettingsOpen(true);
                setMobileSidebarOpen(false);
              }}
            />
          </div>
          <div className="flex-1 bg-black/40" onClick={() => setMobileSidebarOpen(false)} />
        </div>
      )}

      <ChatWindow
        conversation={activeConversation}
        onNewMessage={addMessage}
        onUpdateMessage={updateMessage}
        onEnsureConversation={handleEnsureConversation}
        onNewChat={() => goToNewChat()}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenSidebar={() => setMobileSidebarOpen(true)}
      />

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </main>
  );
}
