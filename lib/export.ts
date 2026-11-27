import type { CaptureMode, ImageFormat } from "./types";

export const EXT: Record<ImageFormat, string> = { png: "png", jpeg: "jpg", webp: "webp" };
export const MIME: Record<ImageFormat, string> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(2)} MB`;
}

export function buildFilename(url: string, w: number, h: number, mode: CaptureMode, fmt: ImageFormat, at = new Date()): string {
  let host = "site";
  try { host = new URL(url).hostname.replace(/^www\./, "").replace(/[^a-z0-9.-]/gi, "-"); }
  catch { host = url.replace(/\.[a-z0-9]+$/i, "").replace(/[^a-z0-9.-]/gi, "-").slice(0, 40) || "site"; }
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`;
  return `wsnap_${host}_${w}x${h}_${mode === "full" ? "fullpage" : "viewport"}_${stamp}.${EXT[fmt]}`;
}

async function toBitmap(blob: Blob) { return createImageBitmap(blob); }

/** Re-encode a lossless PNG into another format in the browser (no re-capture needed). */
export async function convertBlob(blob: Blob, to: ImageFormat, quality: number): Promise<Blob> {
  const bmp = await toBitmap(blob);
  const c = document.createElement("canvas");
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  if (to === "jpeg") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const out = await new Promise<Blob | null>((r) => c.toBlob(r, MIME[to], quality / 100));
  if (!out || out.type !== MIME[to]) throw new Error("This browser can't export that format at this size.");
  return out;
}

export async function makeThumb(blob: Blob): Promise<string> {
  const bmp = await toBitmap(blob);
  const w = 360, h = 225;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
  const sh = Math.min(bmp.height, bmp.width * (h / w));
  ctx.drawImage(bmp, 0, 0, bmp.width, sh, 0, 0, w, h);
  bmp.close();
  return c.toDataURL("image/jpeg", 0.7);
}
