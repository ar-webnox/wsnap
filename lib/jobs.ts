// Single source of truth for "what will be captured". The Generate button label, the summary line
// and the capture loop all use planJobs(), so they can never disagree.
import { validateUrl } from "./validation";
import { LIMITS, type CaptureOptions, type Device } from "./types";

export const EXTRA_SIZES = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 820, height: 1180 },
  mobile: { width: 393, height: 852 },
} as const;
export type ExtraDevice = keyof typeof EXTRA_SIZES;
export const MAX_URLS = 5;
export const MAX_JOBS = 10;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n) || lo));
const uaClass = (d: Device) => (d === "mobile" ? "m" : d === "tablet" ? "t" : "d");
export const sizeKey = (s: { width: number; height: number; device: Device }) => `${s.width}x${s.height}|${uaClass(s.device)}`;

export interface Plan {
  jobs: CaptureOptions[];   // runnable captures (valid URL x unique size)
  invalid: string[];        // rejected URL lines with the reason
  count: number;            // what the Generate button shows
  tooMany: string | null;
}

export function planJobs(cfg: CaptureOptions, rawUrls: string[], extras: readonly ExtraDevice[]): Plan {
  const primary = {
    device: cfg.device,
    width: clamp(cfg.width, LIMITS.minW, LIMITS.maxW),
    height: clamp(cfg.height, LIMITS.minH, LIMITS.maxH),
  };
  // The primary size always comes first; additional sizes are added only if they differ from it (or each other).
  const sizes = [primary];
  const seen = new Set([sizeKey(primary)]);
  for (const d of new Set(extras)) {
    const z = { device: d as Device, ...EXTRA_SIZES[d] };
    if (!seen.has(sizeKey(z))) { seen.add(sizeKey(z)); sizes.push(z); }
  }

  const lines = Array.from(new Set(rawUrls.map((r) => r.trim()).filter(Boolean)));
  const urls: string[] = [], invalid: string[] = [];
  for (const l of lines) {
    const v = validateUrl(l);
    if (!v.ok) { invalid.push(`${l.slice(0, 60)}: ${v.message}`); continue; }
    if (!urls.includes(v.url.href)) urls.push(v.url.href);
  }
  const jobs = urls.flatMap((url) => sizes.map((z) => ({ ...cfg, ...z, url })));
  // Count what will really run: unique normalized URLs (+ lines still being typed) x unique sizes.
  const n = urls.length + invalid.length;
  const count = Math.max(1, n) * sizes.length;
  const tooMany = n > MAX_URLS ? `Batch mode accepts up to ${MAX_URLS} URLs at a time.`
    : count > MAX_JOBS ? `That would create ${count} captures; the limit is ${MAX_JOBS} per run. Remove some URLs or sizes.` : null;
  return { jobs, invalid, count, tooMany };
}
