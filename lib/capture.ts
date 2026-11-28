import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import sharp from "sharp";
import { assertPublicHost, BlockedHostError } from "./ssrf";
import { zoomGeometry } from "./geometry";
import { LIMITS, type CaptureOptions, type ErrorCode, type ImageFormat } from "./types";

export class CaptureError extends Error {
  constructor(public code: ErrorCode, message: string, public status = 500) { super(message); }
}

const UA = {
  desktop: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  tablet: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  mobile: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36",
};

const COOKIE_CSS = [
  "#onetrust-consent-sdk", "#CybotCookiebotDialog", "#truste-consent-track", "#didomi-host", "#usercentrics-root",
  ".cc-window", ".fc-consent-root", ".qc-cmp2-container", ".osano-cm-window",
  '[id*="cookie-banner" i]', '[class*="cookie-banner" i]', '[id*="cookie-consent" i]', '[class*="cookie-consent" i]',
].join(",") + "{display:none!important}";

async function launch(): Promise<Browser> {
  try {
    if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
      const sparticuz = (await import("@sparticuz/chromium")).default;
      return await chromium.launch({
        args: [...sparticuz.args, "--hide-scrollbars"],
        executablePath: await sparticuz.executablePath(),
        headless: true,
      });
    }
    return await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ["--hide-scrollbars"] });
  } catch {
    throw new CaptureError("BROWSER",
      "The screenshot browser could not start. If you're running locally, run `npm run setup:browser` (or set CHROME_PATH); otherwise try again in a moment.", 503);
  }
}

// A warm browser is reused between requests on the same instance (saves 2-5s of launch time).
// Each capture still gets its own isolated context, which is always closed.
let shared: Promise<Browser> | null = null;
async function getBrowser(): Promise<Browser> {
  if (shared) {
    try { const b = await shared; if (b.isConnected()) return b; } catch {}
    shared = null;
  }
  const p = launch();
  shared = p;
  p.then((b) => b.on("disconnected", () => { if (shared === p) shared = null; })).catch(() => { if (shared === p) shared = null; });
  return p;
}
/** Closes the warm shared browser (used after crashes and by tests for a clean exit). */
export async function discardBrowser() {
  const p = shared; shared = null;
  try { await (await p)?.close(); } catch {}
}

function mapError(e: unknown): CaptureError {
  if (e instanceof CaptureError) return e;
  const m = e instanceof Error ? e.message : String(e);
  if (/ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION/.test(m)) return new CaptureError("DNS", "That domain couldn't be found. Check the spelling of the address.", 422);
  if (/ERR_CERT|ERR_SSL|SSL_/.test(m)) return new CaptureError("TLS", "The site's security certificate is invalid, so it can't be captured safely.", 422);
  if (/ERR_BLOCKED_BY_CLIENT/.test(m)) return new CaptureError("BLOCKED", "This address points to a private or restricted network and can't be captured.", 400);
  if (/ERR_CONNECTION|ERR_ADDRESS|ERR_NETWORK|ERR_EMPTY|ERR_TOO_MANY_REDIRECTS|ERR_INTERNET/.test(m)) return new CaptureError("UNREACHABLE", "The website couldn't be reached. It may be offline or may block automated visitors.", 422);
  if (/Download is starting/i.test(m)) return new CaptureError("UNSUPPORTED", "This address serves a file download rather than a web page, so it can't be captured as a screenshot.", 422);
  if (/Timeout|timed out/i.test(m)) return new CaptureError("TIMEOUT", "The page took too long to load. Try 'DOM ready' wait mode, a smaller viewport or turn off full-page capture.", 504);
  if (/out of memory|Target (page, context or browser has been )?closed|crash|Protocol error|Cannot take screenshot/i.test(m)) return new CaptureError("MEMORY", "The page was too large or heavy to capture. Try viewport mode, a lower scale factor or a smaller width.", 413);
  return new CaptureError("UNKNOWN", "The screenshot couldn't be completed. Please try again.", 500);
}

async function dismissCookies(page: Page) {
  await page.addStyleTag({ content: COOKIE_CSS }).catch(() => {});
  await page.evaluate(() => {
    const re = /^(accept( all)?( cookies)?|allow( all)?( cookies)?|i agree|agree|got it|ok|okay|accept & continue)$/i;
    const roots = document.querySelectorAll('[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[id*="gdpr" i],[class*="gdpr" i],[role="dialog"]');
    for (const r of Array.from(roots)) {
      const btn = Array.from(r.querySelectorAll<HTMLElement>('button,a,[role="button"]')).find((b) => re.test((b.innerText || "").trim()));
      if (btn) { btn.click(); break; }
    }
  }).catch(() => {});
  await page.waitForTimeout(350);
}

async function loadLazyContent(page: Page, maxMs: number) {
  await page.evaluate(async (budget) => {
    document.querySelectorAll("img[loading=lazy]").forEach((i) => ((i as HTMLImageElement).loading = "eager"));
    const t0 = Date.now(), step = Math.max(400, Math.floor(innerHeight * 0.8));
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (let y = 0; y < document.documentElement.scrollHeight && y < 40_000 && Date.now() - t0 < budget; y += step) {
      scrollTo(0, y); await sleep(130);
    }
    scrollTo(0, document.documentElement.scrollHeight); await sleep(250);
    scrollTo(0, 0); await sleep(250);
  }, maxMs).catch(() => {});
}

async function waitForImages(page: Page, ms: number) {
  await page.evaluate(async (limit) => {
    const pending = Array.from(document.images).filter((i) => !i.complete);
    await Promise.race([
      Promise.all(pending.map((i) => new Promise((r) => { i.addEventListener("load", r, { once: true }); i.addEventListener("error", r, { once: true }); }))),
      new Promise((r) => setTimeout(r, limit)),
    ]);
  }, ms).catch(() => {});
}

async function adjustFixed(page: Page, mode: "static" | "hide") {
  await page.evaluate((m) => {
    scrollTo(0, 0);
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const p = getComputedStyle(el).position;
      if (p !== "fixed" && p !== "sticky") continue;
      if (m === "hide") el.style.setProperty("visibility", "hidden", "important");
      else el.style.setProperty("position", p === "fixed" ? "absolute" : "relative", "important");
    }
  }, mode).catch(() => {});
}

async function encode(png: Buffer, format: ImageFormat, quality: number, notes: string[]): Promise<{ buf: Buffer; type: string }> {
  const fits = (b: Buffer) => b.length <= LIMITS.maxOutputBytes;
  if (format === "png") {
    if (fits(png)) return { buf: png, type: "image/png" };
    const smaller = await sharp(png, { limitInputPixels: false }).png({ compressionLevel: 9, effort: 8 }).toBuffer();
    if (fits(smaller)) { notes.push("PNG was recompressed (lossless) to fit the download size limit."); return { buf: smaller, type: "image/png" }; }
    throw new CaptureError("TOO_LARGE", "The PNG is too large to download from the free hosting tier (4.5 MB limit). Choose WebP or JPEG, lower the scale factor or use viewport mode.", 413);
  }
  for (let q = quality; q >= 40; q -= 10) {
    const img = sharp(png, { limitInputPixels: false });
    const buf = format === "jpeg"
      ? await img.flatten({ background: "#ffffff" }).jpeg({ quality: q, mozjpeg: true, chromaSubsampling: q >= 90 ? "4:4:4" : "4:2:0" }).toBuffer()
      : await img.webp({ quality: q, effort: 4 }).toBuffer();
    if (fits(buf)) {
      if (q < quality) notes.push(`Quality was lowered from ${quality} to ${q} to fit the download size limit.`);
      return { buf, type: format === "jpeg" ? "image/jpeg" : "image/webp" };
    }
  }
  throw new CaptureError("TOO_LARGE", "This capture is too large to download from the free hosting tier (4.5 MB limit), even at reduced quality. Use viewport mode or a lower scale factor.", 413);
}

export async function capture(o: CaptureOptions, signal?: AbortSignal) {
  const t0 = Date.now();
  const left = () => LIMITS.totalBudgetMs - (Date.now() - t0);
  const notes: string[] = [];
  let ctx: BrowserContext | undefined;
  try {
    const browser = await getBrowser();
    const mobile = o.device === "mobile" || o.device === "tablet";
    const onAbort = () => { ctx?.close().catch(() => {}); };
    signal?.addEventListener("abort", onAbort, { once: true });
    // Browser zoom, viewport size and device scale factor are three independent inputs (see lib/geometry.ts).
    const { vw, vh, eff } = zoomGeometry(o.width, o.height, o.scale, o.zoom);
    // Colour scheme is set on the context, so it is in effect before the first byte of the page is parsed.
    // "auto" emulates the visitor's own preference (Playwright would otherwise always report "light").
    const scheme = o.colorScheme === "auto" ? (o.systemScheme ?? "no-preference") : o.colorScheme;
    ctx = await browser.newContext({
      viewport: { width: vw, height: vh },
      deviceScaleFactor: eff,
      colorScheme: scheme,
      isMobile: mobile, hasTouch: mobile,
      userAgent: o.userAgent || UA[o.device === "custom" ? "desktop" : o.device],
      serviceWorkers: "block", acceptDownloads: false, locale: "en-US",
    });

    let blockedMain = false;
    await ctx.route("**/*", async (route) => {
      const req = route.request();
      const u = new URL(req.url());
      if (u.protocol === "data:" || u.protocol === "blob:" || u.protocol === "about:") return route.continue();
      try {
        if (u.protocol !== "http:" && u.protocol !== "https:") throw new BlockedHostError(u.protocol);
        if (u.port && u.port !== "80" && u.port !== "443") throw new BlockedHostError(u.host);
        await assertPublicHost(u.hostname);
        return route.continue();
      } catch {
        if (req.isNavigationRequest() && req.frame() === req.frame().page().mainFrame()) blockedMain = true;
        return route.abort("blockedbyclient");
      }
    });

    const page = await ctx.newPage();
    let resp;
    try {
      resp = await page.goto(o.url, {
        waitUntil: o.waitUntil === "networkidle" ? "load" : o.waitUntil,
        timeout: Math.min(LIMITS.navTimeoutMs, left()),
      });
    } catch (e) {
      if (blockedMain) throw new CaptureError("BLOCKED", "This address (or a redirect from it) points to a private or restricted network and can't be captured.", 400);
      throw e;
    }
    if (blockedMain) throw new CaptureError("BLOCKED", "A redirect led to a private or restricted network, so the capture was stopped.", 400);

    const status = resp?.status() ?? 0;
    if (status === 401) throw new CaptureError("AUTH", "This page requires you to sign in. WSNAP can only capture public pages.", 422);
    if (status === 403 || status === 429 || status === 503) {
      throw new CaptureError("CHALLENGE", `The site refused the request (HTTP ${status}). It may use bot protection or a CAPTCHA or require authentication.`, 422);
    }
    if (status === 404 || status === 410) throw new CaptureError("HTTP", `The page wasn't found (HTTP ${status}). Check the address for typos.`, 422);
    if (status >= 500) throw new CaptureError("HTTP", `The website's server reported an error (HTTP ${status}), so no screenshot was taken. Try again later.`, 422);
    if (status >= 400) throw new CaptureError("HTTP", `The website responded with an error (HTTP ${status}), so no screenshot was taken.`, 422);
    const ctype = resp?.headers()["content-type"] ?? "";
    if (/application\/(pdf|zip|octet-stream)|video\/|audio\//i.test(ctype)) throw new CaptureError("UNSUPPORTED", "This address is a document or media file, not a web page. WSNAP captures rendered web pages only.", 422);

    if (o.waitUntil === "networkidle") await page.waitForLoadState("networkidle", { timeout: Math.min(8000, Math.max(1000, left() - 20_000)) }).catch(() => notes.push("The page never became fully idle; captured after the wait limit."));
    if (o.hideCookieBanners) await dismissCookies(page);
    if (o.mode === "full" && o.lazyLoad) await loadLazyContent(page, Math.min(9000, Math.max(0, left() - 20_000)));
    if (o.mode === "full" && o.lazyLoad) await waitForImages(page, Math.min(4000, Math.max(0, left() - 18_000)));
    if (o.mode === "full" && o.fixed !== "keep") await adjustFixed(page, o.fixed);
    if (o.waitMs > 0) await page.waitForTimeout(Math.min(o.waitMs, Math.max(0, left() - 15_000)));
    await page.evaluate(() => (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready).catch(() => {});

    const wall = await page.evaluate(() => {
      const t = (document.title || "").toLowerCase(), body = (document.body?.innerText || "").slice(0, 2000).toLowerCase();
      const short = body.length < 900;
      return /just a moment|attention required|access denied|are you a robot|security check|captcha/.test(t) ||
        (short && /captcha|verify you are (a )?human|checking your browser/.test(body));
    }).catch(() => false);
    if (wall) throw new CaptureError("CHALLENGE", "The site is showing a CAPTCHA or bot-protection page instead of its content, so no screenshot was saved.", 422);

    const probe = await page.evaluate(() => {
      const visible = !!document.body && (document.body.innerText.trim().length > 0 || document.images.length > 0 || !!document.querySelector("canvas,video,svg"));
      let darkAware = !!document.querySelector('meta[name="color-scheme"]');
      const root = document.documentElement;
      if (/dark/i.test(`${root.className} ${root.getAttribute("data-theme")} ${root.getAttribute("data-bs-theme")} ${root.style.colorScheme}`)) darkAware = true;
      const scan = (rules: CSSRuleList): boolean => Array.from(rules).some((r) => {
        const m = (r as CSSMediaRule).media?.mediaText ?? "";
        return /prefers-color-scheme/.test(m) || ("cssRules" in r && scan((r as CSSGroupingRule).cssRules));
      });
      for (const ss of Array.from(document.styleSheets)) {
        try { if (scan(ss.cssRules)) { darkAware = true; break; } } catch { darkAware = true; break; } // cross-origin sheet: can't tell
      }
      return { visible, darkAware };
    }).catch(() => ({ visible: true, darkAware: true }));
    if (!probe.visible) notes.push("The page rendered almost no visible content. It may need JavaScript that was blocked, require a sign-in or reject automated browsers.");
    if (o.colorScheme === "dark" && !probe.darkAware) notes.push("This site doesn't appear to define a dark theme, so Dark mode may have no effect. Sites that only offer a manual theme toggle can't be switched automatically.");

    let png: Buffer;
    let pageHeight: number | null = null;
    const shotTimeout = Math.max(5000, left() - 3000);
    if (o.mode === "full") {
      const pageH = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0));
      pageHeight = pageH;
      const cap = Math.floor(Math.min(LIMITS.maxBitmapSide / eff, LIMITS.maxPixels / (vw * eff * eff)));
      const h = Math.max(vh, Math.min(pageH, cap));
      if (pageH > cap) notes.push(`This page is ${pageH.toLocaleString()} CSS px tall. Only the first ${cap.toLocaleString()} px fit within the size limit. Use a lower scale factor, a smaller zoom or capture it in Viewport mode for a specific section.`);
      png = await page.screenshot({ type: "png", fullPage: true, clip: { x: 0, y: 0, width: vw, height: h }, omitBackground: o.transparent, animations: "disabled", timeout: shotTimeout });
    } else {
      if (vw * vh * eff * eff > LIMITS.maxPixels) throw new CaptureError("MEMORY", "That resolution and scale factor is too large. Lower the scale factor.", 413);
      png = await page.screenshot({ type: "png", omitBackground: o.transparent, animations: "disabled", timeout: shotTimeout });
      const wantH = o.height * o.scale;
      if (png.readUInt32BE(20) > wantH) png = await sharp(png).extract({ left: 0, top: 0, width: Math.min(png.readUInt32BE(16), o.width * o.scale), height: wantH }).png().toBuffer();
    }
    if (o.transparent && o.format !== "png") notes.push("Transparent backgrounds are only supported in PNG; JPEG uses white and WebP keeps transparency.");

    const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
    const { buf, type } = await encode(png, o.format, o.quality, notes);
    const title = (await page.title().catch(() => "")).slice(0, 200);
    return { buffer: buf, contentType: type, width, height, notes, ms: Date.now() - t0, finalUrl: page.url(), title, status, pageHeight };
  } catch (e) {
    if (signal?.aborted) throw new CaptureError("UNKNOWN", "Capture cancelled.", 499);
    const ce = mapError(e);
    // A crashed or wedged browser must never be reused by the next request.
    if (ce.code === "MEMORY" || ce.code === "UNKNOWN") await discardBrowser();
    throw ce;
  } finally {
    await ctx?.close().catch(() => {});
  }
}
