"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";
const Ctx = createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({ theme: "dark", setTheme: () => {} });
export const useTheme = () => useContext(Ctx);

function apply(t: Theme) {
  const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, set] = useState<Theme>("dark");
  useEffect(() => { try { set((localStorage.getItem("wsnap:theme") as Theme) || "dark"); } catch {} }, []);
  const setTheme = useCallback((t: Theme) => {
    set(t); apply(t);
    try { localStorage.setItem("wsnap:theme", t); } catch {}
  }, []);
  return <Ctx.Provider value={{ theme, setTheme }}>{children}</Ctx.Provider>;
}
