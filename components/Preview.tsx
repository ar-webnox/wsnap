"use client";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Download, Expand, Loader2, Maximize2, Minimize2, RefreshCw, ZoomIn, ZoomOut } from "lucide-react";
import type { ImageFormat } from "@/lib/types";
import { buildFilename, convertBlob, formatBytes } from "@/lib/export";
import { btnGhost, btnPrimary } from "./ui";

export interface Result {
  blob: Blob; src: string; width: number; height: number; format: ImageFormat; ms: number | null;
  notes: string[]; url: string; title: string; mode: "full" | "viewport"; scale: number; zoom: number; scheme: "auto" | "light" | "dark"; quality: number; onRegenerate: (() => void) | null;
  info?: { finalUrl?: string; title?: string; status?: number; pageHeight?: number };
}
const STEPS = [10, 25, 50, 75, 100, 150, 200, 300, 400];
const ico = "grid size-10 place-items-center rounded-lg border border-line bg-panel text-muted transition hover:bg-soft hover:text-fg disabled:opacity-40";

function PreviewImpl({ r, onError }: { r: Result; onError: (m: string) => void }) {
  const [zoom, setZoom] = useState<"fit" | number>("fit");
  const [full, setFull] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<ImageFormat | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const canCopy = typeof window !== "undefined" && "ClipboardItem" in window;

  const pct = zoom === "fit" ? null : zoom;
  const step = useCallback((dir: 1 | -1) => setZoom((z) => {
    const cur = z === "fit" ? Math.min(100, Math.floor((boxRef.current?.clientWidth ?? r.width) / r.width * 100)) : z;
    const next = dir > 0 ? STEPS.find((s) => s > cur) : [...STEPS].reverse().find((s) => s < cur);
    return next ?? cur;
  }), [r.width]);

  const toggleFull = useCallback(() => {
    const el = boxRef.current?.parentElement;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen(); else el.requestFullscreen?.().catch(() => onError("Fullscreen isn't available in this browser."));
  }, [onError]);
  useEffect(() => {
    const h = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, []);

  const save = (b: Blob, f: ImageFormat) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = buildFilename(r.url || r.title, r.width, r.height, r.mode, f);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  const exportAs = async (f: ImageFormat) => {
    setBusy(f);
    try { save(await convertBlob(r.blob, f, r.quality), f); } catch (e) { onError((e as Error).message); }
    setBusy(null);
  };
  const copy = async () => {
    try {
      const png = r.format === "png" ? r.blob : await convertBlob(r.blob, "png", 100);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      setCopied(true); setTimeout(() => setCopied(false), 1800);
    } catch { onError("Couldn't copy this image to the clipboard (it may be too large or blocked by the browser)."); }
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable) return;
      if (e.key === "+" || e.key === "=") step(1);
      else if (e.key === "-") step(-1);
      else if (e.key === "0") setZoom("fit");
      else if (e.key === "1") setZoom(100);
      else if (e.key.toLowerCase() === "f") toggleFull();
      else if (e.key.toLowerCase() === "d") save(r.blob, r.format);
      else return;
      e.preventDefault();
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });

  const label = r.format === "jpeg" ? "JPEG" : r.format.toUpperCase();
  return (
    <div className="rise bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-3 sm:px-4">
        <div className="min-w-0 text-[13px]">
          <p className="truncate font-medium" title={r.title}>{r.title}</p>
          <p className="text-muted">{r.width} × {r.height}px · {formatBytes(r.blob.size)} · {label}{r.ms ? ` · ${(r.ms / 1000).toFixed(1)}s` : ""}</p>
        </div>
        <div className="flex items-center gap-1.5" role="toolbar" aria-label="Zoom">
          <button className={ico} onClick={() => step(-1)} title="Zoom out (−)" aria-label="Zoom out"><ZoomOut className="size-4" /></button>
          <span className="w-12 text-center text-[13px] tabular-nums text-muted">{pct ? `${pct}%` : "Fit"}</span>
          <button className={ico} onClick={() => step(1)} title="Zoom in (+)" aria-label="Zoom in"><ZoomIn className="size-4" /></button>
          <button className={ico} onClick={() => setZoom(zoom === "fit" ? 100 : "fit")} title={zoom === "fit" ? "Actual size (1)" : "Fit to width (0)"} aria-label="Toggle fit or actual size">
            {zoom === "fit" ? <Maximize2 className="size-4" /> : <Minimize2 className="size-4" />}
          </button>
          <button className={ico} onClick={toggleFull} title="Fullscreen (F)" aria-label="Fullscreen preview"><Expand className="size-4" /></button>
        </div>
      </div>
      <div ref={boxRef} className={`checker overflow-auto overscroll-contain p-3 sm:p-5 ${full ? "h-[calc(100dvh-8rem)]" : "max-h-[72vh] min-h-[16rem]"}`} style={{ contain: "content" }} tabIndex={0} aria-label="Screenshot preview, scrollable">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={r.src} alt={`Screenshot of ${r.title}`} width={r.width} height={r.height} decoding="async"
          className="mx-auto block h-auto max-w-none rounded-sm bg-white shadow-lg ring-1 ring-line"
          style={zoom === "fit" ? { width: "100%", maxWidth: r.width } : { width: (r.width * zoom) / 100, imageRendering: zoom > 100 ? "pixelated" : "auto" }} />
      </div>
      <details className="group border-t border-line text-[13px]">
        <summary className="flex h-11 cursor-pointer list-none items-center justify-between px-3 font-medium sm:px-4">Capture details<span className="text-muted transition group-open:rotate-45">+</span></summary>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 px-3 pb-3 sm:px-4">
          {([
            r.info?.finalUrl && ["Captured URL", r.info.finalUrl], r.info?.title && ["Page title", r.info.title],
            r.info?.status && ["HTTP status", String(r.info.status)], r.info?.pageHeight && ["Page height", `${r.info.pageHeight.toLocaleString()} CSS px`],
            ["Mode", r.mode === "full" ? "Full page" : "Viewport"], ["Image size", `${r.width} × ${r.height} px`],
            ["Device scale", `${r.scale}×`], ["Browser zoom", `${r.zoom}%`], ["Color scheme", { auto: "Auto (matches device)", light: "Light", dark: "Dark" }[r.scheme]],
          ].filter(Boolean) as [string, string][]).map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="break-words">{v}</dd></div>)}
        </dl>
      </details>
      {r.notes.length > 0 && <ul className="space-y-1 border-t border-line bg-amber-500/10 px-4 py-3 text-[13px]">{r.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      <div className="flex flex-wrap gap-2 border-t border-line p-3 sm:px-4">
        <button className={`${btnPrimary} h-10`} onClick={() => save(r.blob, r.format)} title="Download the original file (D)"><Download className="size-4" />Download {label}</button>
        {r.format === "png" && (["jpeg", "webp"] as ImageFormat[]).map((f) => (
          <button key={f} className={btnGhost} disabled={!!busy} onClick={() => exportAs(f)} title={`Convert this PNG to ${f.toUpperCase()}`}>
            {busy === f ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}{f === "jpeg" ? "JPEG" : "WebP"}
          </button>
        ))}
        {canCopy && <button className={btnGhost} onClick={copy} title="Copy image to clipboard">{copied ? <Check className="size-4" /> : <Copy className="size-4" />}{copied ? "Copied" : "Copy"}</button>}
        {r.onRegenerate && <button className={`${btnGhost} sm:ml-auto`} onClick={r.onRegenerate} title="Capture again with the same settings"><RefreshCw className="size-4" />Generate again</button>}
      </div>
    </div>
  );
}
export const Preview = memo(PreviewImpl);
