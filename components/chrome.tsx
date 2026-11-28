"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Moon, Settings, Sun, Trash2, X, Monitor } from "lucide-react";
import { useTheme, type Theme } from "./theme";
import { Seg, btnGhost } from "./ui";
import { InstallButton } from "./Pwa";

function Logo() {
  return (
    <a href="#top" className="flex items-center gap-2.5" aria-label="WSNAP home">
      <img src="/icon.svg" alt="" width={28} height={28} className="size-7 rounded-md" />
      <span className="text-[15px] font-semibold tracking-tight">WSNAP</span>
    </a>
  );
}

export function Nav() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [open]);
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo />
        <nav className="flex items-center gap-1 text-sm">
          <a href="#studio" className="hidden h-10 items-center rounded-lg px-3 text-muted hover:text-fg sm:flex">Studio</a>
          <a href="#recent" className="hidden h-10 items-center rounded-lg px-3 text-muted hover:text-fg sm:flex">Recent</a>
          <InstallButton />
          <button className="grid size-10 place-items-center rounded-lg text-muted hover:bg-soft hover:text-fg" aria-label="Toggle theme"
            onClick={() => setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark")}>
            <Sun className="hidden size-[18px] dark:block" /><Moon className="size-[18px] dark:hidden" />
          </button>
          <button className="grid size-10 place-items-center rounded-lg text-muted hover:bg-soft hover:text-fg" aria-label="Settings" onClick={() => setOpen(true)}>
            <Settings className="size-[18px]" />
          </button>
        </nav>
      </div>
      {open && createPortal(
        <div className="fixed inset-0 z-40 grid place-items-end bg-black/50 p-0 sm:place-items-center sm:p-4" onClick={() => setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label="Settings" onClick={(e) => e.stopPropagation()}
            className="rise w-full max-w-md rounded-t-2xl border border-line bg-panel p-5 shadow-2xl sm:rounded-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold">Settings</h2>
              <button aria-label="Close" className="grid size-9 place-items-center rounded-lg hover:bg-soft" onClick={() => setOpen(false)}><X className="size-4" /></button>
            </div>
            <p className="mb-2 text-[13px] font-medium">Appearance</p>
            <Seg<Theme> label="Theme" value={theme} onChange={setTheme} options={[
              { v: "light", label: "Light", icon: <Sun className="size-3.5" /> },
              { v: "dark", label: "Dark", icon: <Moon className="size-3.5" /> },
              { v: "system", label: "System", icon: <Monitor className="size-3.5" /> },
            ]} />
            <p className="mb-2 mt-5 text-[13px] font-medium">Keyboard shortcuts</p>
            <dl className="mb-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
              {[["Ctrl/⌘ + Enter", "Generate screenshot"], ["/", "Focus the URL field"], ["+  /  −", "Zoom preview"], ["0  /  1", "Fit / actual size"], ["F", "Fullscreen preview"], ["D", "Download current screenshot"], ["Esc", "Close dialogs"]].map(([k, v]) => (
                <div key={k} className="contents"><dt className="font-mono text-muted">{k}</dt><dd>{v}</dd></div>))}
            </dl>
            <p className="mb-2 mt-5 text-[13px] font-medium">Recent captures</p>
            <p className="mb-3 text-xs text-muted">Captures and settings are stored only in this browser (IndexedDB). Nothing is saved on our servers.</p>
            <button className={btnGhost} onClick={() => { window.dispatchEvent(new Event("wsnap:clear-history")); setOpen(false); }}>
              <Trash2 className="size-4" />Clear history
            </button>
          </div>
        </div>,
        document.body,
      )}
    </header>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <span>© {new Date().getFullYear()} WSNAP. Screenshots are rendered live in a real Chromium browser and never stored.</span>
        <span>Public pages only · Private networks are blocked</span>
      </div>
    </footer>
  );
}
