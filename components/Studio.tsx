"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Bookmark, Camera, Globe, Layers, Loader2, Monitor, RotateCcw, Smartphone, Tablet, Upload, X } from "lucide-react";
import { LIMITS, ZOOM_PRESETS, type CaptureOptions, type Device } from "@/lib/types";
import { EXTRA_SIZES, MAX_URLS, planJobs, sizeKey, type ExtraDevice } from "@/lib/jobs";
import { PRESETS } from "@/lib/presets";
import { validateUrl } from "@/lib/validation";
import { makeThumb } from "@/lib/export";
import * as store from "@/lib/history";
import { Field, Group, Seg, Toggle, btnGhost, btnPrimary, inputCls } from "./ui";
import { Preview, type Result } from "./Preview";
import History from "./History";

type Settings = CaptureOptions;
const DEFAULTS: Settings = {
  url: "", mode: "full", device: "desktop", width: 1440, height: 900, scale: 1, format: "png", quality: 90,
  waitMs: 1000, waitUntil: "load", userAgent: "", lazyLoad: true, hideCookieBanners: true, transparent: false, fixed: "keep", colorScheme: "auto", zoom: 100,
};
const EXAMPLES = ["wikipedia.org", "github.com", "news.ycombinator.com"];
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const lsGet = <T,>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) || "") as T; } catch { return d; } };
const lsSet = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const SCHEME_LABEL = { auto: "Auto theme", light: "Light", dark: "Dark" } as const;
const describe = (s: Settings) => [`${s.width}×${s.height}`, s.mode === "full" ? "Full page" : "Viewport", s.format.toUpperCase(),
  ...(s.zoom !== 100 ? [`${s.zoom}% zoom`] : []), ...(s.scale > 1 ? [`${s.scale}×`] : []), ...(s.colorScheme !== "auto" ? [SCHEME_LABEL[s.colorScheme]] : [])].join(" · ");
type Saved = { name: string; s: Settings };
type Err = { code: string; message: string };

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((r, j) => {
  const t = setTimeout(r, ms);
  signal.addEventListener("abort", () => { clearTimeout(t); j(new DOMException("Aborted", "AbortError")); }, { once: true });
});

// The server renders one page at a time; if it is still finishing a previous job, wait and retry.
async function captureOne(payload: Settings, signal: AbortSignal, attempt = 0): Promise<Awaited<ReturnType<typeof captureOnce>>> {
  try { return await captureOnce(payload, signal); }
  catch (e) {
    if ((e as Err)?.code === "BUSY" && attempt < 4) { await sleep(2500, signal); return captureOne(payload, signal, attempt + 1); }
    throw e;
  }
}

async function captureOnce(payload: Settings, signal: AbortSignal) {
  const res = await fetch("/api/capture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal });
  if (!res.ok) {
    let j: { error?: Err } | null = null;
    try { j = await res.json(); } catch {}
    if (j?.error) throw j.error;
    throw { code: "TIMEOUT", message: res.status === 504 || res.status === 502
      ? "The server stopped waiting for this page (free-tier time limit). Try viewport mode or 'DOM ready' wait mode."
      : "The server couldn't complete the capture. Please try again." } satisfies Err;
  }
  const blob = await res.blob();
  const width = Number(res.headers.get("X-Image-Width")), height = Number(res.headers.get("X-Image-Height"));
  if (!blob.size || !width || !height) throw { code: "UNKNOWN", message: "The server returned an empty image, so nothing was saved." } satisfies Err;
  let notes: string[] = [];
  try { notes = JSON.parse(decodeURIComponent(res.headers.get("X-Notes") || "[]")); } catch {}
  const dec = (k: string) => { try { return decodeURIComponent(res.headers.get(k) || ""); } catch { return ""; } };
  const info = { finalUrl: dec("X-Final-Url"), title: dec("X-Page-Title"), status: Number(res.headers.get("X-Http-Status")) || undefined, pageHeight: Number(res.headers.get("X-Page-Height")) || undefined };
  return { blob, width, height, notes, ms: Number(res.headers.get("X-Capture-Ms")) || null, info };
}

export default function Studio() {
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [batch, setBatch] = useState(false);
  const [batchText, setBatchText] = useState("");
  const [extra, setExtra] = useState<ExtraDevice[]>([]);
  const [customZoom, setCustomZoom] = useState(false);
  const [jobStates, setJobStates] = useState<{ label: string; st: "wait" | "run" | "ok" | "fail" }[]>([]);
  const [failedJobs, setFailedJobs] = useState<Settings[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState<Err | null>(null);
  const [failures, setFailures] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ i: number; n: number; label: string } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [history, setHistory] = useState<store.Entry[]>([]);
  const [storageNote, setStorageNote] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useState(false);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [recent, setRecent] = useState<Saved[]>([]);
  const [presetName, setPresetName] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  const startedAt = useRef(0);
  const previewRef = useRef<HTMLElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const runRef = useRef<() => void>(() => {});
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((p) => ({ ...p, [k]: v }));
  const reportError = useCallback((message: string) => { setError({ code: "UNKNOWN", message }); setStatus("error"); }, []);

  const refresh = useCallback(() => store.listEntries().then(setHistory).catch(() => setStorageNote("Browser storage is unavailable, so history can't be saved in this session.")), []);
  useEffect(() => {
    refresh();
    navigator.storage?.persist?.().catch(() => {});
    const last = lsGet<Settings | null>("wsnap:last", null);
    if (last) setS({ ...DEFAULTS, ...last, url: "" });
    setSaved(lsGet("wsnap:presets", [])); setRecent(lsGet("wsnap:recent", []));
  }, [refresh]);
  useEffect(() => {
    const clear = () => store.clearEntries().then(() => { setStorageNote(null); refresh(); });
    addEventListener("wsnap:clear-history", clear);
    return () => removeEventListener("wsnap:clear-history", clear);
  }, [refresh]);
  useEffect(() => { lsSet("wsnap:last", { ...s, url: "" }); }, [s]);
  useEffect(() => {
    if (status !== "loading") return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 250);
    return () => clearInterval(id);
  }, [status]);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.src); }, [result]);

  const persist = useCallback(async (blob: Blob, meta: Omit<store.Entry, "id" | "at" | "thumb" | "bytes">) => {
    try {
      const entry: store.Entry = { ...meta, id: crypto.randomUUID(), at: Date.now(), bytes: blob.size, thumb: await makeThumb(blob) };
      const r = await store.saveEntry(entry, blob);
      setStorageNote(r.ok ? (r.evicted ? `Older captures were removed to stay within browser storage limits (${r.evicted}).` : null) : r.reason ?? null);
      await refresh();
    } catch { setStorageNote("This capture couldn't be added to history, but it's still available to download."); }
  }, [refresh]);

  const showBlob = useCallback((blob: Blob, p: Partial<Result> & Pick<Result, "width" | "height" | "format" | "url" | "title">) => {
    setResult({ blob, src: URL.createObjectURL(blob), ms: null, notes: [], mode: "full", scale: 1, zoom: 100, scheme: "auto", quality: 90, onRegenerate: null, ...p });
    setStatus("done");
  }, []);

  const run: (single?: Settings, retryJobs?: Settings[]) => Promise<void> = useCallback(async (single?: Settings, retryJobs?: Settings[]) => {
    if (runningRef.current) return;
    const cfg = single ?? s;
    const plan = planJobs(cfg, single || !batch ? [cfg.url] : batchText.split(/\r?\n/), single ? [] : extra);
    if (!retryJobs) {
      if (!plan.jobs.length) { setError({ code: "INVALID_URL", message: plan.invalid[0]?.replace(/^.*?: /, "") || "Enter a website address to capture." }); setStatus("error"); return; }
      if (plan.tooMany) { setError({ code: "INVALID_URL", message: plan.tooMany }); setStatus("error"); return; }
    }
    const sys = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    const bad = retryJobs ? [] : plan.invalid;
    const jobs = (retryJobs ?? plan.jobs).map((j) => ({ ...j, systemScheme: sys as "dark" | "light" }));

    runningRef.current = true; startedAt.current = Date.now();
    const ac = new AbortController(); abortRef.current = ac;
    setStatus("loading"); setError(null); setFailures(bad); setElapsed(0);
    if (!single && !retryJobs) { const r = [{ name: describe(cfg), s: { ...cfg, url: "" } }, ...recent.filter((x) => x.name !== describe(cfg))].slice(0, 5); setRecent(r); lsSet("wsnap:recent", r); }
    if (innerWidth < 1024) previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    let ok = 0; const fails = [...bad]; const failedList: Settings[] = [];
    const lab = (j: Settings) => `${host(j.url)} · ${j.width}×${j.height}`;
    const mark = (i: number, st: "wait" | "run" | "ok" | "fail") => setJobStates((a) => a.map((x, k) => (k === i ? { ...x, st } : x)));
    setJobStates(jobs.map((j) => ({ label: lab(j), st: "wait" }))); setFailedJobs([]);
    for (let i = 0; i < jobs.length; i++) {
      const j = jobs[i];
      setProgress({ i: i + 1, n: jobs.length, label: lab(j) }); mark(i, "run");
      try {
        const r = await captureOne(j, ac.signal);
        ok++;
        showBlob(r.blob, { width: r.width, height: r.height, format: j.format, url: j.url, title: host(j.url), mode: j.mode, scale: j.scale, quality: j.quality, notes: r.notes, ms: r.ms, info: r.info, zoom: j.zoom, scheme: j.colorScheme, onRegenerate: () => run(j) });
        mark(i, "ok");
        setStatus("loading");
        await persist(r.blob, { name: `${host(j.url)} · ${r.width}×${r.height}`, url: j.url, width: r.width, height: r.height, format: j.format, settings: j });
      } catch (e) {
        if ((e as Error)?.name === "AbortError") break;
        const k = e as Partial<Err>; mark(i, "fail"); failedList.push(j);
        fails.push(`${host(j.url)} (${j.width}×${j.height}): ${k.message && k.code ? k.message : "Couldn't reach the WSNAP server."}`);
        if (jobs.length === 1) setError(k.message && k.code ? (k as Err) : { code: "NETWORK", message: "Couldn't reach the WSNAP server. Check your connection and try again." });
      }
    }
    runningRef.current = false; abortRef.current = null; setProgress(null); setFailures(fails); setFailedJobs(failedList);
    setStatus(ok > 0 ? "done" : ac.signal.aborted ? "idle" : "error");
    if (!ok && !ac.signal.aborted && jobs.length > 1) setError({ code: "UNKNOWN", message: "None of the captures succeeded. See the details below." });
  }, [s, batch, batchText, extra, recent, persist, showBlob]);
  // Re-run only what failed, with the exact settings each job had.
  runRef.current = () => run();

  const open = useCallback(async (e: store.Entry) => {
    const blob = await store.getBlob(e.id);
    if (!blob) { reportError("That capture is no longer stored in this browser."); return; }
    const cfg = e.settings;
    showBlob(blob, { width: e.width, height: e.height, format: e.format, url: e.url, title: e.name, mode: cfg?.mode ?? "full", scale: cfg?.scale ?? 1, zoom: cfg?.zoom ?? 100, scheme: cfg?.colorScheme ?? "auto", quality: cfg?.quality ?? 90, onRegenerate: cfg ? () => run(cfg) : null });
    if (cfg) { setS({ ...DEFAULTS, ...cfg, userAgent: cfg.userAgent ?? "" }); setCustomZoom(false); }
    previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [run, showBlob, reportError]);

  const importFile = useCallback(async (f: File) => {
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { reportError("Only PNG, JPEG or WebP images can be imported."); return; }
    if (f.size > 25 * 1024 * 1024) { reportError("That image is larger than 25 MB."); return; }
    try {
      const b = await createImageBitmap(f); const { width, height } = b; b.close();
      const format = f.type === "image/png" ? "png" : f.type === "image/webp" ? "webp" : "jpeg";
      showBlob(f, { width, height, format, url: "", title: f.name });
      await persist(f, { name: f.name.slice(0, 80), url: "", width, height, format, settings: null });
    } catch { reportError("That image couldn't be read."); }
  }, [persist, showBlob, reportError]);

  useEffect(() => {
    let n = 0;
    const has = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
    const enter = (e: DragEvent) => { if (has(e)) { n++; setDragging(true); } };
    const leave = (e: DragEvent) => { if (has(e) && --n <= 0) { n = 0; setDragging(false); } };
    const over = (e: DragEvent) => has(e) && e.preventDefault();
    const drop = (e: DragEvent) => { if (!has(e)) return; e.preventDefault(); n = 0; setDragging(false); const f = e.dataTransfer?.files[0]; if (f) importFile(f); };
    addEventListener("dragenter", enter); addEventListener("dragleave", leave); addEventListener("dragover", over); addEventListener("drop", drop);
    return () => { removeEventListener("dragenter", enter); removeEventListener("dragleave", leave); removeEventListener("dragover", over); removeEventListener("drop", drop); };
  }, [importFile]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); runRef.current(); return; }
      const t = e.target as HTMLElement;
      if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(t.tagName)) { e.preventDefault(); urlRef.current?.focus(); }
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, []);

  const pickDevice = (d: Device) => d === "custom" ? set("device", "custom") : setS((x) => ({ ...x, device: d, width: PRESETS[d][0].w, height: PRESETS[d][0].h }));
  const loading = status === "loading";
  const presets = s.device === "custom" ? [] : PRESETS[s.device];
  const plan = useMemo(() => planJobs(s, batch ? batchText.split(/\r?\n/) : [s.url], extra), [s, batch, batchText, extra]);
  const nJobs = plan.count;
  const primaryKey = sizeKey(s);
  const isCustomZoom = customZoom || !(ZOOM_PRESETS as readonly number[]).includes(s.zoom);
  const full = s.mode === "full";
  const extraActive = extra.filter((d) => sizeKey({ ...EXTRA_SIZES[d], device: d }) !== primaryKey);
  const changed = [s.scale !== 1, s.zoom !== 100, s.colorScheme !== "auto", s.waitUntil !== "load", s.waitMs !== 1000, !!s.userAgent?.trim(), s.fixed !== "keep", !s.lazyLoad, !s.hideCookieBanners, s.transparent].filter(Boolean).length;
  const applyCfg = (c: Settings) => { setS({ ...DEFAULTS, ...c, url: s.url }); setCustomZoom(false); setMenu(false); };
  const savePreset = () => {
    const name = presetName.trim().slice(0, 40); if (!name) return;
    const n = [{ name, s: { ...s, url: "" } }, ...saved.filter((p) => p.name !== name)].slice(0, 12);
    setSaved(n); lsSet("wsnap:presets", n); setPresetName("");
  };
  const delPreset = (name: string) => { const n = saved.filter((p) => p.name !== name); setSaved(n); lsSet("wsnap:presets", n); };

  return (
    <main id="top" className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-6 sm:pt-14">
      {dragging && <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-bg/80 backdrop-blur-sm"><div className="rounded-2xl border-2 border-dashed border-accent bg-panel px-10 py-8 text-center"><Upload className="mx-auto size-6 text-accent" /><p className="mt-3 text-sm font-medium">Drop an image to preview it</p><p className="text-xs text-muted">PNG, JPEG or WebP · stays in your browser</p></div></div>}
      <div className="max-w-2xl">
        <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">Screenshot any website at the exact size you need.</h1>
        <p className="mt-3 text-pretty text-[15px] leading-relaxed text-muted">Rendered in a real browser at your chosen viewport, full page or just what's visible. Download as PNG, JPEG or WebP.</p>
      </div>

      <form id="studio" className="mt-7 flex scroll-mt-20 flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); run(); }}>
        <div className="relative flex-1">
          {batch ? (
            <textarea className={`${inputCls} h-32 resize-y py-3 text-[15px]`} placeholder={`One URL per line (up to ${MAX_URLS})\nexample.com\nwikipedia.org`} aria-label="Website URLs" spellCheck={false} autoCapitalize="none" value={batchText} onChange={(e) => setBatchText(e.target.value)} />
          ) : (<>
            <Globe className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input ref={urlRef} className={`${inputCls} h-12 pl-10 text-[15px]`} type="text" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              placeholder="example.com  ( / to focus )" aria-label="Website URL" value={s.url} onChange={(e) => { set("url", e.target.value); if (status === "error") setStatus(result ? "done" : "idle"); }} />
          </>)}
        </div>
        {loading
          ? <button type="button" className={`${btnPrimary} h-12 shrink-0 whitespace-nowrap sm:min-w-56`} onClick={() => { if (Date.now() - startedAt.current > 700) abortRef.current?.abort(); }} title="Cancel this capture"><X className="size-4" />Cancel</button>
          : <button type="submit" className={`${btnPrimary} h-12 shrink-0 whitespace-nowrap sm:min-w-56`} title="Ctrl/⌘ + Enter"><Camera className="size-4" />{`Generate ${nJobs} screenshot${nJobs > 1 ? "s" : ""}`}</button>}
      </form>
      <button type="button" className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-lg px-1 text-[13px] text-muted hover:text-fg" aria-pressed={batch} onClick={() => setBatch((b) => !b)}>
        <Layers className="size-3.5" />{batch ? "Back to single URL" : "Batch mode: capture several URLs"}
      </button>
      <p className={`mt-1 text-xs ${plan.tooMany ? "text-red-500" : "text-muted"}`} aria-live="polite" data-testid="summary">
        {plan.tooMany ?? <>{nJobs} screenshot{nJobs > 1 ? "s" : ""} · {describe(s)}{extraActive.length > 0 && <> · + {extraActive.join(", ")} size{extraActive.length > 1 ? "s" : ""}</>}</>}
      </p>

      <div className="mt-4 grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <section aria-label="Capture settings" className="h-fit space-y-5 rounded-xl border border-line bg-panel p-5">
          <div className="relative flex items-center justify-between">
            <h2 className="text-sm font-semibold">Capture settings</h2>
            <div className="flex gap-1">
              <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-muted hover:bg-soft hover:text-fg" aria-expanded={menu} onClick={() => setMenu((m) => !m)} title="Saved and recent configurations"><Bookmark className="size-3.5" />Presets</button>
              <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-muted hover:bg-soft hover:text-fg" onClick={() => { setS({ ...DEFAULTS, url: s.url }); setExtra([]); setCustomZoom(false); }} title="Reset all settings to defaults"><RotateCcw className="size-3.5" />Reset</button>
            </div>
            {menu && (
              <div className="rise absolute right-0 top-10 z-20 w-72 max-w-[calc(100vw-3rem)] rounded-xl border border-line bg-panel p-3 shadow-xl">
                <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); savePreset(); }}>
                  <input className={`${inputCls} h-10`} placeholder="Name current settings" aria-label="Preset name" maxLength={40} value={presetName} onChange={(e) => setPresetName(e.target.value)} />
                  <button className={`${btnGhost} shrink-0`} disabled={!presetName.trim()}>Save</button>
                </form>
                {saved.length > 0 && <p className="mb-1 mt-3 text-xs font-medium text-muted">Saved</p>}
                {saved.map((p) => (
                  <div key={p.name} className="flex items-center gap-1">
                    <button className="min-h-10 flex-1 truncate rounded-md px-2 text-left text-[13px] hover:bg-soft" onClick={() => applyCfg(p.s)}>{p.name}<span className="block truncate text-xs text-muted">{describe(p.s)}</span></button>
                    <button className="grid size-9 place-items-center rounded-md text-muted hover:bg-soft hover:text-red-500" aria-label={`Delete preset ${p.name}`} onClick={() => delPreset(p.name)}><X className="size-3.5" /></button>
                  </div>
                ))}
                {recent.length > 0 && <p className="mb-1 mt-3 text-xs font-medium text-muted">Recently used</p>}
                {recent.map((p) => <button key={p.name} className="block min-h-10 w-full truncate rounded-md px-2 text-left text-[13px] hover:bg-soft" onClick={() => applyCfg(p.s)}>{p.name}</button>)}
                {!saved.length && !recent.length && <p className="mt-3 text-xs text-muted">Settings you use appear here.</p>}
              </div>
            )}
          </div>
          <Seg<Settings["mode"]> label="Capture mode" value={s.mode} onChange={(v) => set("mode", v)} options={[{ v: "full", label: "Full page" }, { v: "viewport", label: "Viewport" }]} />
          <div>
            <p className="mb-1.5 text-[13px] font-medium">Device</p>
            <Seg<Device> label="Device" value={s.device} onChange={pickDevice} options={[
              { v: "desktop", label: "Desktop", icon: <Monitor className="size-3.5" /> }, { v: "tablet", label: "Tablet", icon: <Tablet className="size-3.5" /> },
              { v: "mobile", label: "Mobile", icon: <Smartphone className="size-3.5" /> }, { v: "custom", label: "Custom" }]} />
            {presets.length > 0 && (
              <div className="mt-2.5 grid grid-cols-2 gap-2">
                {presets.map((p) => {
                  const on = p.w === s.width && p.h === s.height;
                  return (
                    <button key={p.label} type="button" aria-pressed={on} onClick={() => setS((x) => ({ ...x, width: p.w, height: p.h }))}
                      className={`min-h-11 rounded-lg border px-2.5 py-1.5 text-left transition ${on ? "border-accent bg-accent/10" : "border-line hover:bg-soft"}`}>
                      <span className="block truncate text-[13px] font-medium">{p.label}</span><span className="block text-xs text-muted">{p.w} × {p.h}</span>
                    </button>);
                })}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Width" hint="px"><input className={inputCls} type="number" inputMode="numeric" min={LIMITS.minW} max={LIMITS.maxW} value={s.width || ""} onChange={(e) => setS((x) => ({ ...x, width: Number(e.target.value), device: "custom" }))} /></Field>
            <Field label="Height" hint="px"><input className={inputCls} type="number" inputMode="numeric" min={LIMITS.minH} max={LIMITS.maxH} value={s.height || ""} onChange={(e) => setS((x) => ({ ...x, height: Number(e.target.value), device: "custom" }))} /></Field>
          </div>
          <div>
            <p className="mb-1.5 flex items-baseline justify-between text-[13px] font-medium">Additional sizes<span className="font-normal text-muted">{extraActive.length ? `+${extraActive.length} per URL` : "none"}</span></p>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(EXTRA_SIZES) as ExtraDevice[]).map((d) => {
                const z = EXTRA_SIZES[d];
                const same = sizeKey({ ...z, device: d }) === primaryKey;
                const on = extra.includes(d) && !same;
                return <button key={d} type="button" aria-pressed={on} disabled={same}
                  title={same ? "Same as your main capture size" : `${on ? "Remove the extra" : "Add an extra"} ${d} capture at ${z.width} × ${z.height}`}
                  onClick={() => setExtra((x) => (x.includes(d) ? x.filter((y) => y !== d) : [...x, d]))}
                  className={`h-10 rounded-full border px-3.5 text-[13px] capitalize transition disabled:opacity-40 ${on ? "border-accent bg-accent/10" : "border-line hover:bg-soft"}`}>{d}<span className="ml-1.5 text-xs normal-case text-muted">{z.width}×{z.height}</span></button>;
              })}
            </div>
            <p className="mt-1.5 text-xs text-muted">Each selected size adds one more screenshot per URL.</p>
          </div>
          <div>
            <p className="mb-1.5 text-[13px] font-medium">Format</p>
            <Seg<Settings["format"]> label="Format" value={s.format} onChange={(v) => set("format", v)} options={[{ v: "png", label: "PNG" }, { v: "jpeg", label: "JPEG" }, { v: "webp", label: "WebP" }]} />
          </div>
          <Field label="Quality" hint={s.format === "png" ? "PNG is lossless" : `${s.quality}%`}>
            <input type="range" min={40} max={100} value={s.quality} disabled={s.format === "png"} onChange={(e) => set("quality", Number(e.target.value))} className="h-11 w-full accent-[var(--accent)] disabled:opacity-40" />
          </Field>
          <details className="group rounded-lg border border-line">
            <summary className="flex h-11 cursor-pointer list-none items-center justify-between px-3 text-[13px] font-medium"><span>Advanced options{changed > 0 && <span className="ml-2 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent">{changed} changed</span>}</span><span className="text-muted transition group-open:rotate-45">+</span></summary>
            <div className="space-y-5 border-t border-line p-3">
              <Group title="Rendering">
                <div>
                  <p className="mb-1.5 text-[13px] font-medium">Device scale factor</p>
                  <Seg<number> label="Scale factor" value={s.scale} onChange={(v) => set("scale", v)} options={[{ v: 1, label: "1×" }, { v: 2, label: "2×" }, { v: 3, label: "3×" }]} />
                  <p className="mt-1.5 text-xs text-muted">Pixel density only: sharper output, larger files. Layout is unchanged.</p>
                </div>
                <Field label="Browser zoom" hint={`${s.zoom}%`} title="Zooms like Ctrl +/− in a browser: the page lays out at width ÷ zoom CSS pixels. Viewport size and scale factor stay separate.">
                  <select className={inputCls} value={isCustomZoom ? "custom" : String(s.zoom)} onChange={(e) => { if (e.target.value === "custom") setCustomZoom(true); else { setCustomZoom(false); set("zoom", Number(e.target.value)); } }}>
                    {ZOOM_PRESETS.map((z) => <option key={z} value={z}>{z}%{z === 100 ? " (default)" : ""}</option>)}
                    <option value="custom">Custom…</option>
                  </select>
                  {isCustomZoom && <input className={`${inputCls} mt-2`} type="number" inputMode="numeric" min={LIMITS.minZoom} max={LIMITS.maxZoom} aria-label="Custom zoom percentage" aria-invalid={s.zoom < LIMITS.minZoom || s.zoom > LIMITS.maxZoom} placeholder={`${LIMITS.minZoom}–${LIMITS.maxZoom} %`} value={s.zoom || ""} onChange={(e) => set("zoom", Number(e.target.value))} />}
                </Field>
                <p className="-mt-1.5 text-xs text-muted">Browser-style zoom (emulated with the CSS viewport and pixel ratio, as Chromium does), so responsive layouts react as they would in a browser. Output stays {s.width * s.scale} px wide.</p>
                <div>
                  <p className="mb-1.5 text-[13px] font-medium">Website color scheme</p>
                  <Seg<Settings["colorScheme"]> label="Color scheme" value={s.colorScheme} onChange={(v) => set("colorScheme", v)} options={[{ v: "auto", label: "Auto" }, { v: "light", label: "Light" }, { v: "dark", label: "Dark" }]} />
                  <p className="mt-1.5 text-xs text-muted">{({ auto: "Matches your device's light/dark setting, like visiting the site yourself. Sites with a fixed theme keep it.", light: "Asks the site for its light theme (prefers-color-scheme: light).", dark: "Asks the site for its dark theme (prefers-color-scheme: dark). Sites without a dark theme stay light." })[s.colorScheme]}</p>
                </div>
                <Field label="Custom user-agent" hint="optional"><input className={inputCls} value={s.userAgent ?? ""} maxLength={300} placeholder="Default for the selected device" onChange={(e) => set("userAgent", e.target.value)} /></Field>
              </Group>
              <Group title="Loading">
                <Field label="Page load strategy"><select className={inputCls} value={s.waitUntil} onChange={(e) => set("waitUntil", e.target.value as Settings["waitUntil"])}>
                  <option value="domcontentloaded">DOM ready (fastest)</option><option value="load">Page loaded</option><option value="networkidle">Network idle (most complete)</option></select></Field>
                <Field label="Wait before capture" hint={s.waitMs === 0 ? "none" : `${(s.waitMs / 1000).toFixed(1)}s`}><input type="range" min={0} max={LIMITS.maxWaitMs} step={500} value={s.waitMs} onChange={(e) => set("waitMs", Number(e.target.value))} className="h-11 w-full accent-[var(--accent)]" /></Field>
                <div className="divide-y divide-line">
                  <Toggle checked={s.lazyLoad} onChange={(v) => set("lazyLoad", v)} disabled={!full} label="Load lazy content" hint="Scrolls the page and waits for images"
                    title={full ? undefined : "Only applies to Full page captures. Viewport captures show just the top of the page, which is already loaded."} />
                </div>
              </Group>
              <Group title="Page">
                <Field label="Sticky & fixed elements" title={full ? undefined : "Only applies to Full page captures. In Viewport mode fixed elements appear exactly where a visitor would see them."}>
                  <select className={inputCls} disabled={!full} value={s.fixed} onChange={(e) => set("fixed", e.target.value as Settings["fixed"])}>
                    <option value="keep">Keep as rendered</option><option value="static">Pin to page position</option><option value="hide">Hide them</option></select></Field>
                <div className="divide-y divide-line">
                  <Toggle checked={s.hideCookieBanners} onChange={(v) => set("hideCookieBanners", v)} label="Hide cookie banners" hint="Best effort" />
                  <Toggle checked={s.transparent} onChange={(v) => set("transparent", v)} disabled={s.format === "jpeg"} label="Transparent background" hint="Only where the page has no background color"
                    title={s.format === "jpeg" ? "JPEG can't store transparency. Choose PNG or WebP." : undefined} />
                </div>
              </Group>
            </div>
          </details>
        </section>

        <section ref={previewRef} aria-label="Screenshot preview" aria-live="polite" className="min-w-0 scroll-mt-20">
          <div className="overflow-hidden rounded-xl border border-line bg-panel">
            {status === "done" && result ? <Preview r={result} onError={reportError} />
            : loading ? (
              <div className="grid min-h-[22rem] place-items-center p-8 text-center"><div className="w-full max-w-xs">
                <Loader2 className="mx-auto size-6 animate-spin text-muted" />
                <p className="mt-4 text-sm font-medium">{progress && progress.n > 1 ? `Capturing ${progress.i} of ${progress.n}` : "Capturing"}</p>
                <p className="mt-1 truncate text-xs text-muted">{progress?.label}</p>
                <p className="mt-1 text-xs text-muted">{elapsed}s elapsed · most pages finish in 5–20s</p>
                {jobStates.length > 1 && <ul className="mt-4 space-y-1.5 text-left text-xs">{jobStates.map((j, i) => <li key={i} className="flex items-center gap-2"><span aria-hidden className={`size-1.5 shrink-0 rounded-full ${j.st === "ok" ? "bg-emerald-500" : j.st === "fail" ? "bg-red-500" : j.st === "run" ? "bg-accent" : "bg-line"}`} /><span className={`truncate ${j.st === "wait" ? "text-muted" : ""}`}>{j.label}</span><span className="sr-only">{j.st}</span></li>)}</ul>}
                <div className="mt-5 h-1 overflow-hidden rounded-full bg-soft"><div className="sweep h-full w-1/4 rounded-full bg-accent" /></div>
              </div></div>
            ) : status === "error" && error ? (
              <div role="alert" className="grid min-h-[22rem] place-items-center p-8 text-center"><div className="max-w-sm">
                <span className="mx-auto grid size-11 place-items-center rounded-full bg-red-500/10 text-red-500"><AlertTriangle className="size-5" /></span>
                <p className="mt-4 text-sm font-medium">No screenshot was captured</p>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{error.message}</p>
                {failures.length > 1 && <ul className="mt-3 space-y-1 text-left text-xs text-muted">{failures.map((f) => <li key={f}>{f}</li>)}</ul>}
                {!["INVALID_URL", "BLOCKED"].includes(error.code) && (s.url || batchText) && <button className={`${btnGhost} mt-5`} onClick={() => (failedJobs.length ? run(undefined, failedJobs) : run())}>{failedJobs.length > 1 ? `Retry failed (${failedJobs.length})` : "Try again"}</button>}
              </div></div>
            ) : (
              <div className="grid min-h-[22rem] place-items-center p-8 text-center"><div className="max-w-sm">
                <span className="mx-auto grid size-12 place-items-center rounded-xl border border-dashed border-line text-muted"><Camera className="size-5" /></span>
                <p className="mt-4 text-sm font-medium">Your screenshot will appear here</p>
                <p className="mt-1.5 text-sm text-muted">Paste a public web address above and choose a size or drop an existing screenshot anywhere on the page to preview it.</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">{EXAMPLES.map((x) => <button key={x} className="h-9 rounded-full border border-line px-3.5 text-[13px] hover:bg-soft" onClick={() => { setBatch(false); set("url", x); }}>{x}</button>)}</div>
              </div></div>
            )}
          </div>
          {status === "done" && failures.length > 0 && (
            <div role="status" className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-[13px]"><p className="font-medium">Some captures didn't complete</p><ul className="mt-1 space-y-0.5 text-xs">{failures.map((f) => <li key={f}>{f}</li>)}</ul>{failedJobs.length > 0 && !loading && <button className={`${btnGhost} mt-2`} onClick={() => run(undefined, failedJobs)}>Retry failed ({failedJobs.length})</button>}</div>
          )}
        </section>
      </div>

      <History items={history} storageNote={storageNote} onOpen={open}
        onRename={(id, n) => store.renameEntry(id, n).then(refresh)}
        onDelete={(id) => store.deleteEntry(id).then(refresh)}
        onClear={() => store.clearEntries().then(() => { setStorageNote(null); refresh(); })} />
    </main>
  );
}
