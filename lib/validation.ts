// Pure module: used by both the browser (instant feedback) and the server (authoritative check).
import { LIMITS, type CaptureOptions } from "./types";

export type UrlCheck = { ok: true; url: URL } | { ok: false; message: string };
const BAD_SCHEME = /^(javascript|data|file|ftp|blob|about|chrome|view-source|ws|wss|mailto|tel):/i;
const fail = (message: string): UrlCheck => ({ ok: false, message });
const ONLY_WEB = "Only http:// and https:// websites can be captured.";

export function validateUrl(raw: string): UrlCheck {
  let s = (raw ?? "").trim();
  if (!s) return fail("Enter a website address to capture.");
  if (s.length > 2048) return fail("That URL is too long.");
  if (BAD_SCHEME.test(s)) return fail(ONLY_WEB);
  if (!/^https?:\/\//i.test(s)) {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return fail(ONLY_WEB);
    s = "https://" + s;
  }
  let u: URL;
  try { u = new URL(s); } catch { return fail("That doesn't look like a valid URL."); }
  if (u.username || u.password) return fail("URLs that contain a username or password aren't supported.");
  if (u.port && u.port !== "80" && u.port !== "443") return fail("Only standard web ports (80 and 443) are supported.");
  if (!u.hostname.includes(".") && !u.hostname.includes(":")) return fail("Enter a full domain, such as example.com.");
  return { ok: true, url: u };
}

const num = (v: unknown, min: number, max: number, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
};
const pick = <T extends string>(v: unknown, allowed: readonly T[], def: T): T =>
  allowed.includes(v as T) ? (v as T) : def;

export function parseOptions(body: unknown): { ok: true; value: CaptureOptions } | { ok: false; message: string } {
  if (!body || typeof body !== "object") return { ok: false, message: "Invalid request." };
  const b = body as Record<string, unknown>;
  const u = validateUrl(String(b.url ?? ""));
  if (!u.ok) return u;
  const ua = typeof b.userAgent === "string" ? b.userAgent.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 300) : "";
  return {
    ok: true,
    value: {
      url: u.url.href,
      mode: pick(b.mode, ["full", "viewport"], "full"),
      device: pick(b.device, ["desktop", "tablet", "mobile", "custom"], "desktop"),
      width: num(b.width, LIMITS.minW, LIMITS.maxW, 1440),
      height: num(b.height, LIMITS.minH, LIMITS.maxH, 900),
      scale: num(b.scale, 1, LIMITS.maxScale, 1),
      format: pick(b.format, ["png", "jpeg", "webp"], "png"),
      quality: num(b.quality, 40, 100, 90),
      waitMs: num(b.waitMs, 0, LIMITS.maxWaitMs, 1000),
      waitUntil: pick(b.waitUntil, ["domcontentloaded", "load", "networkidle"], "load"),
      userAgent: ua || undefined,
      lazyLoad: b.lazyLoad !== false,
      hideCookieBanners: b.hideCookieBanners !== false,
      transparent: b.transparent === true,
      fixed: pick(b.fixed, ["keep", "static", "hide"], "keep"),
      colorScheme: pick(b.colorScheme, ["auto", "light", "dark"], "auto"),
      systemScheme: b.systemScheme === "dark" ? "dark" : b.systemScheme === "light" ? "light" : undefined,
      zoom: num(b.zoom, LIMITS.minZoom, LIMITS.maxZoom, 100),
    },
  };
}
