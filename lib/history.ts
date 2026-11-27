// Browser-native persistence: metadata and image blobs live in IndexedDB (never localStorage).
import type { CaptureOptions, ImageFormat } from "./types";

export interface Entry {
  id: string; name: string; url: string; width: number; height: number; bytes: number;
  format: ImageFormat; at: number; thumb: string; settings: CaptureOptions | null;
}
export const MAX_ENTRIES = 24;
export const MAX_BYTES = 150 * 1024 * 1024;

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open("wsnap", 1);
      r.onupgradeneeded = () => { r.result.createObjectStore("meta", { keyPath: "id" }); r.result.createObjectStore("blobs"); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => { dbp = null; rej(r.error); };
    });
  }
  return dbp;
}
const done = (t: IDBTransaction) => new Promise<void>((res, rej) => {
  t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
});
const req = <T,>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function listEntries(): Promise<Entry[]> {
  const d = await db();
  const all = await req(d.transaction("meta").objectStore("meta").getAll() as IDBRequest<Entry[]>);
  return all.sort((a, b) => b.at - a.at);
}
export async function getBlob(id: string): Promise<Blob | null> {
  const d = await db();
  return (await req(d.transaction("blobs").objectStore("blobs").get(id))) ?? null;
}
async function remove(ids: string[]) {
  const d = await db(); const t = d.transaction(["meta", "blobs"], "readwrite");
  ids.forEach((id) => { t.objectStore("meta").delete(id); t.objectStore("blobs").delete(id); });
  await done(t);
}
export const deleteEntry = (id: string) => remove([id]);
export async function clearEntries() {
  const d = await db(); const t = d.transaction(["meta", "blobs"], "readwrite");
  t.objectStore("meta").clear(); t.objectStore("blobs").clear(); await done(t);
}
export async function renameEntry(id: string, name: string) {
  const d = await db(); const t = d.transaction("meta", "readwrite"); const s = t.objectStore("meta");
  const e = (await req(s.get(id))) as Entry | undefined;
  if (e) s.put({ ...e, name: name.trim().slice(0, 80) || e.name });
  await done(t);
}

async function put(e: Entry, blob: Blob) {
  const d = await db(); const t = d.transaction(["meta", "blobs"], "readwrite");
  t.objectStore("meta").put(e); t.objectStore("blobs").put(blob, e.id); await done(t);
}

/** Saves an entry, evicting the oldest ones to respect count/size limits and browser quota. */
export async function saveEntry(e: Entry, blob: Blob): Promise<{ ok: boolean; evicted: number; reason?: string }> {
  if (blob.size > MAX_BYTES / 2) return { ok: false, evicted: 0, reason: "This image is too large to keep in browser history, but you can still download it." };
  let evicted = 0;
  const trim = async (keep: number) => {
    const list = (await listEntries()).filter((x) => x.id !== e.id);
    let total = list.reduce((n, x) => n + x.bytes, 0) + blob.size;
    const drop: string[] = [];
    for (let i = list.length - 1; i >= 0 && (list.length - drop.length >= keep || total > MAX_BYTES); i--) { drop.push(list[i].id); total -= list[i].bytes; }
    if (drop.length) { await remove(drop); evicted += drop.length; }
  };
  try {
    await trim(MAX_ENTRIES);
    try { await put(e, blob); }
    catch { await trim(Math.max(1, Math.floor(((await listEntries()).length) / 2))); await put(e, blob); }
    return { ok: true, evicted };
  } catch {
    return { ok: false, evicted, reason: "Your browser's storage is full or unavailable, so this capture wasn't added to history." };
  }
}
export async function storageUsage(): Promise<{ used: number; quota: number } | null> {
  try { const s = await navigator.storage.estimate(); return s.quota ? { used: s.usage ?? 0, quota: s.quota } : null; } catch { return null; }
}
