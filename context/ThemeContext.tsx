"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";

export type ColorTheme = "blue" | "purple";
export type Mode = "light" | "dark";

interface ThemeContextValue {
  colorTheme: ColorTheme;
  mode: Mode;
  setColorTheme: (t: ColorTheme) => void;
  setMode: (m: Mode) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [colorTheme, setColorThemeState] = useState<ColorTheme>("blue");
  const [mode, setModeState] = useState<Mode>("light");

  // Load preferensi tersimpan saat pertama kali mount
  useEffect(() => {
    const savedColor = localStorage.getItem("colorTheme") as ColorTheme | null;
    const savedMode = localStorage.getItem("mode") as Mode | null;
    if (savedColor) setColorThemeState(savedColor);
    if (savedMode) setModeState(savedMode);
    else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setModeState("dark");
    }
  }, []);

  // Terapkan ke <html> setiap kali berubah + update warna status bar (theme-color)
  // biar nyambung sama tampilan light/dark, bukan cuma warna tetap.
  useEffect(() => {
    document.documentElement.setAttribute("data-color-theme", colorTheme);
    document.documentElement.setAttribute("data-mode", mode);

    const themeColorValue = mode === "dark" ? "#16181c" : "#ffffff";
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "theme-color");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", themeColorValue);
  }, [colorTheme, mode]);

  const setColorTheme = (t: ColorTheme) => {
    setColorThemeState(t);
    localStorage.setItem("colorTheme", t);
  };

  const setMode = (m: Mode) => {
    setModeState(m);
    localStorage.setItem("mode", m);
  };

  return (
    <ThemeContext.Provider value={{ colorTheme, mode, setColorTheme, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme harus dipakai di dalam ThemeProvider");
  return ctx;
}
