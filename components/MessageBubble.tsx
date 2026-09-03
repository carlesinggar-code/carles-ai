"use client";

import { useSession } from "next-auth/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Logo from "./Logo";
import { ChatMessage } from "@/lib/useChatHistory";

export default function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const { data: session } = useSession();

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      {isUser ? (
        session?.user?.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={session.user.image}
            alt={session.user.name ?? "User"}
            className="w-8 h-8 rounded-full shrink-0"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center shrink-0 text-white text-xs font-medium">
            {session?.user?.name?.[0] ?? "U"}
          </div>
        )
      ) : (
        <div className="w-8 h-8 rounded-full bg-accent/15 flex items-center justify-center shrink-0">
          <Logo size={18} withText={false} />
        </div>
      )}

      <div
        className={`max-w-[80%] md:max-w-[70%] min-w-0 rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser ? "bg-accent text-white rounded-tr-sm" : "rounded-tl-sm"
        }`}
        style={!isUser ? { backgroundColor: "var(--bg-secondary)" } : undefined}
      >
        {message.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={message.image}
            alt="Lampiran"
            className="rounded-lg mb-2 max-h-64 object-cover"
          />
        )}

        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="markdown-body">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                // Tabel GFM defaultnya nggak respect max-width parent dan
                // bikin layout jebol di mobile. Bungkus dengan scroll horizontal
                // sendiri, bukan ikut ndorong lebar seluruh chat bubble.
                table: ({ children, ...props }) => (
                  <div className="overflow-x-auto max-w-full my-2 -mx-1">
                    <table {...props} className="text-xs">
                      {children}
                    </table>
                  </div>
                ),
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
