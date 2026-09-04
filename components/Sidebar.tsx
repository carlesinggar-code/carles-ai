"use client";

import { Plus, MessageSquare, Settings, Trash2, LogOut } from "lucide-react";
import { useSession, signOut } from "next-auth/react";
import Logo from "./Logo";
import { Conversation } from "@/lib/useChatHistory";
import { useLanguage } from "@/context/LanguageContext";

interface SidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onDelete: (id: string) => void;
  onOpenSettings: () => void;
  // "desktop" (default): hides itself below the md breakpoint, for the permanent
  // sidebar. "mobile": always visible, meant to be rendered inside the mobile
  // drawer overlay (which already handles its own open/close + backdrop).
  variant?: "desktop" | "mobile";
}

export default function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNewChat,
  onDelete,
  onOpenSettings,
  variant = "desktop",
}: SidebarProps) {
  const { t } = useLanguage();
  const { data: session } = useSession();

  return (
    <aside
      className={`${
        variant === "mobile" ? "flex w-72" : "hidden md:flex md:w-72"
      } flex-col h-dvh border-r shrink-0`}
      style={{
        backgroundColor: "var(--bg-sidebar)",
        borderColor: "var(--border-color)",
      }}
    >
      {/* Brand */}
      <div className="px-4 py-4">
        <Logo />
      </div>

      {/* New chat button */}
      <div className="px-3">
        <button
          onClick={onNewChat}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium
                     hover:bg-accent hover:text-white hover:border-accent transition-colors"
          style={{ borderColor: "var(--border-color)" }}
        >
          <Plus size={16} />
          {t("newChat")}
        </button>
      </div>

      {/* History */}
      <div className="flex-1 overflow-y-auto px-3 mt-4">
        <p
          className="text-xs font-medium px-2 mb-2 uppercase tracking-wide"
          style={{ color: "var(--text-secondary)" }}
        >
          {t("history")}
        </p>

        {conversations.length === 0 && (
          <p className="text-sm px-2" style={{ color: "var(--text-secondary)" }}>
            {t("noHistory")}
          </p>
        )}

        <ul className="space-y-1">
          {conversations.map((c) => (
            <li key={c.id} className="group relative">
              <button
                onClick={() => onSelect(c.id)}
                className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm text-left truncate transition-colors ${
                  activeId === c.id ? "bg-accent/10 text-accent" : "hover:bg-black/5"
                }`}
              >
                <MessageSquare size={15} className="shrink-0" />
                <span className="truncate">{c.title}</span>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(c.id);
                }}
                title="Hapus"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100
                           p-1 rounded-md hover:bg-red-500/10 hover:text-red-500 transition-opacity"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* User profile & Settings */}
      <div className="p-3 border-t space-y-1" style={{ borderColor: "var(--border-color)" }}>
        {session?.user && (
          <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg">
            {session.user.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={session.user.image}
                alt={session.user.name ?? "User"}
                className="w-8 h-8 rounded-full shrink-0"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center shrink-0 text-xs font-medium">
                {session.user.name?.[0] ?? "U"}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{session.user.name}</p>
              <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>
                {session.user.email}
              </p>
            </div>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              title="Keluar"
              className="p-1.5 rounded-md hover:bg-red-500/10 hover:text-red-500 transition-colors shrink-0"
            >
              <LogOut size={15} />
            </button>
          </div>
        )}

        <button
          onClick={onOpenSettings}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm hover:bg-black/5 transition-colors"
        >
          <Settings size={16} />
          {t("settings")}
        </button>
      </div>
    </aside>
  );
}
