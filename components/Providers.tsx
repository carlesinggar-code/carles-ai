"use client";

import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "@/context/ThemeContext";
import { LanguageProvider } from "@/context/LanguageContext";
import { ReactNode } from "react";
import VersionBadge from "@/components/VersionBadge";

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider>
        <LanguageProvider>
          {children}
          <VersionBadge />
        </LanguageProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
