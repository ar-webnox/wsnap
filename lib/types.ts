export type CaptureMode = "full" | "viewport";
export type Device = "desktop" | "tablet" | "mobile" | "custom";
export type ImageFormat = "png" | "jpeg" | "webp";
export type FixedMode = "keep" | "static" | "hide";
export type WaitUntil = "domcontentloaded" | "load" | "networkidle";

export interface CaptureOptions {
  url: string;
  mode: CaptureMode;
  device: Device;
  width: number;
  height: number;
  scale: number;
  format: ImageFormat;
  quality: number;
  waitMs: number;
  waitUntil: WaitUntil;
  userAgent?: string;
  lazyLoad: boolean;
  hideCookieBanners: boolean;
  transparent: boolean;
  fixed: FixedMode;
}

export type ErrorCode =
  | "INVALID_URL" | "INVALID_REQUEST" | "BLOCKED" | "DNS" | "UNREACHABLE" | "TLS"
  | "TIMEOUT" | "BROWSER" | "MEMORY" | "CHALLENGE" | "AUTH" | "HTTP"
  | "TOO_LARGE" | "BUSY" | "NETWORK" | "UNKNOWN";

export const LIMITS = {
  minW: 240, maxW: 3840, minH: 240, maxH: 4320,
  maxScale: 3, maxWaitMs: 10_000,
  navTimeoutMs: 25_000,
  totalBudgetMs: 52_000,        // Vercel Hobby functions are capped at 60s
  maxBitmapSide: 16_000,        // Chromium cannot reliably produce larger images
  maxPixels: 50_000_000,        // memory guard for the 1GB function
  maxOutputBytes: 4_200_000,    // Vercel's response body limit is 4.5MB
} as const;

export interface CaptureResultMeta {
  width: number; height: number; bytes: number; format: ImageFormat;
  ms: number; notes: string[];
}
