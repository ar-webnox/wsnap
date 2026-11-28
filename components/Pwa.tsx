"use client";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Share, WifiOff, X } from "lucide-react";

interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> }
declare global { interface Window { __wsnapInstall?: InstallEvent | null } }

const isStandalone = () =>
  typeof window !== "undefined" &&
  (matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: window-controls-overlay)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

/** Registers the service worker (production only) and keeps the install prompt + offline notice. Renders only the offline notice. */
export function PwaRegister() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    // Capture the install prompt as early as possible; the Install button may mount later.
    const onPrompt = (e: Event) => { e.preventDefault(); window.__wsnapInstall = e as InstallEvent; window.dispatchEvent(new Event("wsnap:install-ready")); };
    const onInstalled = () => { window.__wsnapInstall = null; window.dispatchEvent(new Event("wsnap:installed")); };
    addEventListener("beforeinstallprompt", onPrompt); addEventListener("appinstalled", onInstalled);
    const up = () => setOffline(!navigator.onLine);
    up(); addEventListener("online", up); addEventListener("offline", up);
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      const reg = () => navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
      if (document.readyState === "complete") reg(); else addEventListener("load", reg, { once: true });
    }
    return () => { removeEventListener("beforeinstallprompt", onPrompt); removeEventListener("appinstalled", onInstalled); removeEventListener("online", up); removeEventListener("offline", up); };
  }, []);
  if (!offline) return null;
  return (
    <div role="status" className="rise pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <p className="pointer-events-auto flex max-w-md items-start gap-2.5 rounded-xl border border-line bg-panel px-4 py-3 text-[13px] shadow-xl">
        <WifiOff className="mt-0.5 size-4 shrink-0 text-muted" />
        <span>You're offline. Saved captures are still available; new screenshots need a connection.</span>
      </p>
    </div>
  );
}

type Mode = "prompt" | "ios" | "safari-mac" | null;
function detectManual(): Mode {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ios) return "ios";
  if (/Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox|CriOS|FxiOS/.test(ua)) return "safari-mac";
  return null;
}

/** "Install" button for the nav: native prompt where the browser supports it, instructions on iOS and macOS Safari. */
export function InstallButton() {
  const [mode, setMode] = useState<Mode>(null);
  const [help, setHelp] = useState(false);
  const refresh = useCallback(() => {
    if (isStandalone()) return setMode(null);
    setMode(window.__wsnapInstall ? "prompt" : detectManual());
  }, []);
  useEffect(() => {
    refresh();
    const evs = ["wsnap:install-ready", "wsnap:installed"];
    evs.forEach((e) => addEventListener(e, refresh));
    const mq = matchMedia("(display-mode: standalone)"); mq.addEventListener?.("change", refresh);
    return () => { evs.forEach((e) => removeEventListener(e, refresh)); mq.removeEventListener?.("change", refresh); };
  }, [refresh]);
  useEffect(() => {
    if (!help) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setHelp(false);
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  }, [help]);

  if (!mode) return null;
  const click = async () => {
    if (mode === "prompt" && window.__wsnapInstall) {
      const ev = window.__wsnapInstall; window.__wsnapInstall = null;
      try { await ev.prompt(); await ev.userChoice; } catch {}
      refresh();
    } else setHelp(true);
  };
  return (
    <>
      <button type="button" onClick={click} title="Install WSNAP as an app" aria-label="Install WSNAP app"
        className="inline-flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-muted transition hover:bg-soft hover:text-fg">
        <Download className="size-[17px]" /><span className="hidden min-[400px]:inline">Install</span>
      </button>
      {/* Portaled to <body>: the nav uses backdrop-blur, which would otherwise trap fixed-position overlays inside the header. */}
      {help && createPortal(
        <div className="fixed inset-0 z-40 grid place-items-end bg-black/50 p-0 sm:place-items-center sm:p-4" onClick={() => setHelp(false)}>
          <div role="dialog" aria-modal="true" aria-label="Install WSNAP" onClick={(e) => e.stopPropagation()} className="rise w-full max-w-md rounded-t-2xl border border-line bg-panel p-5 shadow-2xl sm:rounded-2xl">
            <div className="mb-3 flex items-center gap-3">
              <img src="/icons/icon-96.png" alt="" width={44} height={44} className="size-11 rounded-xl" />
              <div className="min-w-0 flex-1"><h2 className="text-base font-semibold">Install WSNAP</h2><p className="text-xs text-muted">Opens like an app, with its own window and icon.</p></div>
              <button aria-label="Close" className="grid size-9 place-items-center rounded-lg hover:bg-soft" onClick={() => setHelp(false)}><X className="size-4" /></button>
            </div>
            {mode === "ios" ? (
              <ol className="space-y-2.5 text-sm">
                <li className="flex gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-soft text-xs font-medium">1</span><span>Tap the <Share className="mx-0.5 inline size-4 align-text-bottom" /> <b>Share</b> button in Safari's toolbar (or the browser menu).</span></li>
                <li className="flex gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-soft text-xs font-medium">2</span><span>Scroll down and choose <b>Add to Home Screen</b>.</span></li>
                <li className="flex gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-soft text-xs font-medium">3</span><span>Tap <b>Add</b>. WSNAP now appears on your Home Screen.</span></li>
              </ol>
            ) : (
              <ol className="space-y-2.5 text-sm">
                <li className="flex gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-soft text-xs font-medium">1</span><span>In Safari's menu bar choose <b>File → Add to Dock…</b></span></li>
                <li className="flex gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-soft text-xs font-medium">2</span><span>Confirm the name <b>WSNAP</b> and click <b>Add</b>.</span></li>
              </ol>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
