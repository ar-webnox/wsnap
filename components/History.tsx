"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Columns2, Pencil, Trash2, X } from "lucide-react";
import { getBlob, storageUsage, type Entry } from "@/lib/history";
import { EXT, formatBytes } from "@/lib/export";
import { btnGhost } from "./ui";

interface Props {
  items: Entry[]; storageNote: string | null;
  onOpen: (e: Entry) => void; onRename: (id: string, name: string) => void; onDelete: (id: string) => void; onClear: () => void;
}

function CompareModal({ a, b, onClose }: { a: Entry; b: Entry; onClose: () => void }) {
  const [srcs, setSrcs] = useState<[string, string] | null>(null);
  const [sync, setSync] = useState(true);
  const refs = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const lock = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    let urls: string[] = [], dead = false;
    Promise.all([getBlob(a.id), getBlob(b.id)]).then(([x, y]) => {
      if (dead || !x || !y) return;
      urls = [URL.createObjectURL(x), URL.createObjectURL(y)]; setSrcs([urls[0], urls[1]]);
    });
    const k = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    addEventListener("keydown", k);
    return () => { dead = true; urls.forEach(URL.revokeObjectURL); removeEventListener("keydown", k); };
  }, [a.id, b.id]);
  const onScroll = (i: 0 | 1) => {
    if (!sync || lock.current) return;
    const s = refs[i].current, o = refs[1 - i].current;
    if (!s || !o) return;
    lock.current = true;
    o.scrollTop = (s.scrollTop / Math.max(1, s.scrollHeight - s.clientHeight)) * (o.scrollHeight - o.clientHeight);
    o.scrollLeft = s.scrollLeft;
    requestAnimationFrame(() => (lock.current = false));
  };
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg" role="dialog" aria-modal="true" aria-label="Compare screenshots">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
        <p className="text-sm font-medium">Compare</p>
        <div className="flex items-center gap-2">
          <label className="flex h-10 items-center gap-2 text-[13px]"><input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} className="size-4 accent-[var(--accent)]" />Sync scrolling</label>
          <button className="grid size-10 place-items-center rounded-lg hover:bg-soft" onClick={onClose} aria-label="Close comparison"><X className="size-4" /></button>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-2 gap-px bg-line md:grid-cols-2 md:grid-rows-1">
        {[a, b].map((e, i) => (
          <div key={e.id} className="flex min-h-0 min-w-0 flex-col bg-bg">
            <p className="truncate px-3 py-2 text-xs text-muted"><span className="font-medium text-fg">{e.name}</span> · {e.width}×{e.height} · {formatBytes(e.bytes)}</p>
            <div ref={refs[i]} onScroll={() => onScroll(i as 0 | 1)} className="checker min-h-0 flex-1 overflow-auto p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {srcs && <img src={srcs[i]} alt={e.name} decoding="async" className="mx-auto block h-auto max-w-full bg-white shadow ring-1 ring-line" style={{ width: e.width }} />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function History({ items, storageNote, onOpen, onRename, onDelete, onClear }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [cmp, setCmp] = useState(false);
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  useEffect(() => { storageUsage().then(setUsage); }, [items]);
  useEffect(() => setPicked((p) => p.filter((id) => items.some((i) => i.id === id))), [items]);
  const pair = picked.length === 2 ? picked.map((id) => items.find((i) => i.id === id)!) : null;
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 2 ? [p[1], id] : [...p, id]));
  const commit = (id: string) => { onRename(id, draft); setEditing(null); };

  return (
    <section id="recent" className="mt-14 scroll-mt-20">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Recent captures</h2>
          {usage && items.length > 0 && <p className="text-xs text-muted">Stored in this browser · {formatBytes(items.reduce((n, i) => n + i.bytes, 0))} of {formatBytes(usage.quota)} available</p>}
        </div>
        <div className="flex gap-2">
          {pair && <button className={btnGhost} onClick={() => setCmp(true)}><Columns2 className="size-4" />Compare selected</button>}
          {items.length > 0 && <button className="inline-flex h-10 items-center gap-1.5 rounded-lg px-2 text-[13px] text-muted hover:text-fg" onClick={() => confirm("Delete all captures from this browser?") && onClear()}><Trash2 className="size-3.5" />Clear all</button>}
        </div>
      </div>
      {storageNote && <p role="status" className="mb-4 rounded-lg bg-amber-500/10 px-3 py-2 text-[13px]">{storageNote}</p>}
      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">Captures you make are saved here, in this browser only. Select two to compare them side by side.</p>
      ) : (
        <>
          {items.length > 1 && <p className="mb-3 text-xs text-muted">Tick two captures to compare them.</p>}
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {items.map((h) => (
              <li key={h.id} className={`overflow-hidden rounded-xl border bg-panel transition ${picked.includes(h.id) ? "border-accent" : "border-line"}`}>
                <div className="relative">
                  <button className="block w-full" onClick={() => onOpen(h)} aria-label={`Open ${h.name}`} title="Open in preview">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={h.thumb} alt="" loading="lazy" className="aspect-[16/10] w-full border-b border-line object-cover object-top" />
                  </button>
                  <label className="absolute left-2 top-2 grid size-9 cursor-pointer place-items-center rounded-md bg-bg/90 shadow ring-1 ring-line" title="Select for comparison">
                    <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={picked.includes(h.id)} onChange={() => toggle(h.id)} aria-label={`Select ${h.name} for comparison`} />
                  </label>
                </div>
                <div className="p-3 text-[13px]">
                  {editing === h.id ? (
                    <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); commit(h.id); }}>
                      <input autoFocus value={draft} maxLength={80} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setEditing(null)} className="h-9 min-w-0 flex-1 rounded-md border border-line bg-panel px-2 text-[13px] outline-none focus:border-accent" aria-label="Capture name" />
                      <button className="grid size-9 place-items-center rounded-md hover:bg-soft" aria-label="Save name"><Check className="size-4" /></button>
                    </form>
                  ) : <p className="truncate font-medium" title={h.name}>{h.name}</p>}
                  <p className="mt-0.5 text-xs text-muted">{h.width}×{h.height} · {formatBytes(h.bytes)} · .{EXT[h.format]}</p>
                  <p className="text-xs text-muted">{new Date(h.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</p>
                  <div className="-mb-1 mt-2 flex gap-1">
                    <button className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-xs text-muted hover:bg-soft hover:text-fg" onClick={() => { setEditing(h.id); setDraft(h.name); }}><Pencil className="size-3.5" />Rename</button>
                    <button className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-xs text-muted hover:bg-soft hover:text-red-500" onClick={() => onDelete(h.id)}><Trash2 className="size-3.5" />Delete</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {cmp && pair && <CompareModal a={pair[0]} b={pair[1]} onClose={() => setCmp(false)} />}
    </section>
  );
}
