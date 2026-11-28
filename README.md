# WSNAP - Website Screenshot Studio

Capture full-page or viewport screenshots of any public website at exact resolutions, rendered by a real Chromium browser. Export PNG, JPEG or WebP. No paid APIs, no keys, no database.

## Architecture

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS 4 |
| Browser | `playwright-core` driving `@sparticuz/chromium` (a Chromium build sized for serverless) on Vercel; Playwright's own Chromium locally |
| Image processing | `sharp` (WebP/JPEG encoding, lossless PNG recompression) |
| Endpoint | `POST /api/capture` (Node.js runtime, `maxDuration = 60`) |

```
app/api/capture/route.ts   request validation, concurrency guard, binary response
lib/validation.ts          URL + option parsing (shared by browser and server)
lib/ssrf.ts                private-network / metadata blocking (DNS-resolved)
lib/capture.ts             browser launch, navigation, lazy-load, cookies, screenshot, encoding
lib/export.ts              filenames, byte formatting, client-side format conversion, thumbnails
components/                Studio (workspace), chrome (nav/settings/footer), ui, theme
```

Why not plain `playwright`? The full Playwright browser bundle exceeds Vercel's 250 MB function limit. `@sparticuz/chromium` ships a compressed headless Chromium that fits and `playwright-core` drives it.

## Local setup

```bash
npm install
npm run setup:browser     # downloads Playwright's Chromium (once)
npm run dev               # http://localhost:3000
```
Already have Chrome? Skip `setup:browser` and set `CHROME_PATH` in `.env.local`. Requires Node 20+.

## Deploy to Vercel (Hobby)

1. Push this folder to a Git repository.
2. Import it at vercel.com/new. Framework preset: Next.js. No settings to change.
3. Deploy. `next.config.mjs` already bundles the Chromium binary into `/api/capture` and the route sets `maxDuration = 60`.

Or: `npm i -g vercel && vercel --prod`.

### Environment variables
None are required in production. `CHROME_PATH` is optional and local-only.

## Features

- Full page, viewport and custom-resolution capture, with desktop (1920×1080, 1600×900, 1440×900, 1366×768, 1280×720), tablet and mobile presets plus free width/height (240–3840 × 240–4320).
- Real browser viewport (mobile/tablet use touch + mobile emulation), never CSS-scaled images.
- Device scale factor 1×/2×/3×; zoom fixed at 100%.
- Wait mode (DOM ready / loaded / network idle), extra delay up to 10s, custom user-agent.
- Lazy-load scrolling for full page, best-effort cookie-banner hiding and dismissal, optional transparent background.
- PNG, JPEG, WebP with quality control; PNGs can also be exported as JPEG/WebP in the browser; automatic filenames such as `wsnap_example.com_1440x900_fullpage_20260101-120000.png`; exact pixel dimensions and file size shown.
- Fit-to-width or actual-size preview, cancel button, honest elapsed-time indicator (no fake progress percentages).
- Recent captures (IndexedDB, this browser only), dark/light/system themes with no flash, responsive layout.
- Human-readable errors for invalid URLs, unsupported protocols, DNS failures, unreachable or slow sites, TLS errors, CAPTCHA/bot walls, login-required pages, HTTP errors, memory limits, oversized output and browser launch failures. A screenshot is never reported unless the image was actually produced.

## Security

- Only `http`/`https` on ports 80/443; no embedded credentials.
- Hostnames are DNS-resolved and rejected if they map to loopback, RFC1918, CGNAT, link-local (including `169.254.169.254` cloud metadata), IPv6 ULA/link-local, IPv4-mapped IPv6, multicast or reserved ranges; `.local`/`.internal` style names are blocked.
- Every browser request, including redirects and sub-resources, is intercepted and checked with the same rules.
- Service workers and downloads are disabled; request bodies are size-limited; URLs are never logged or stored server-side.

## Step 2 additions

- **Engine:** warm-browser reuse between requests (isolated context per capture, always closed; crashed browsers are discarded), wait for pending images after lazy-load scrolling, sticky/fixed handling (keep / pin to page position / hide), one capture at a time per instance, server-side cancel when the client disconnects, same-origin-only API.
- **Preview:** zoom 10–400%, fit/actual size, fullscreen, copy to clipboard (PNG), download original or convert PNG to JPEG/WebP, scrollable large-image workspace.
- **History (IndexedDB):** survives refresh; open, rename, delete, clear; 24 entries / 150 MB cap with oldest-first eviction and quota-error handling; side-by-side compare with synced scrolling.
- **Workflow:** batch mode (≤5 URLs), multi-size capture (extra Desktop/Tablet/Mobile, ≤10 captures per run, run one after another), saved + recently used configurations, reset, drag-and-drop import of PNG/JPEG/WebP, keyboard shortcuts (see Settings).
- **Not implemented:** manual scroll-and-stitch capture. Chromium's native full-page capture is used, capped at ~16,000 px / 50 MP and truncation is reported. Stitching would add memory use and seam artifacts on sticky-header sites and was not worth the risk on a 1 GB function.

## Capture accuracy notes

- **Color scheme:** Auto emulates your device's light/dark preference (Playwright alone always reports "light"), Light/Dark force it. It is set on the browser context, so it is active before the page parses. Sites that only offer a manual theme toggle cannot be switched this way and WSNAP says so for Dark mode when no dark theme is detected. No CSS filters are used.
- **Browser zoom:** emulated the way Chromium implements zoom: CSS viewport = width / zoom and pixel ratio = scale x zoom. Media queries see the zoomed width and the output stays exactly width x scale pixels. Zoom, viewport size and device scale factor are independent settings. This is page-scale emulation, not the browser UI's own zoom control.
- **Job counting:** `lib/jobs.ts` (`planJobs`) is the single source of truth for the button label, the summary and the capture run.

## Testing

`npm run test:all` runs everything. `npm test` (logic, no browser), `npm run test:engine` (real Chromium engine against local pages) and `npm run test:ui` (the real UI bundled with the app's Tailwind CSS, driven in Chromium; only `/api/capture` is intercepted). The last two need Chromium (`npm run setup:browser` or `CHROME_PATH`) and `esbuild` (a dev dependency). The test builds stub the SSRF/port checks in a temporary copy only; production code is unchanged. These tests do not replace `next build` or a real Vercel deployment.

## Testing (basic)

`npm test` runs 7 pure-logic tests (URL validation, obfuscated-IP normalization, private/metadata/IPv6 range blocking, option clamping, filenames). See the summary delivered with Step 2 for exactly what was and was not verified in a real browser.

## Capture settings: colour scheme, browser zoom, job planning

- **Website color scheme** (Auto / Light / Dark) is applied with Playwright's `colorScheme` context option, so it is in effect before the page is parsed, in both Full page and Viewport mode. Auto emulates *your* device's light/dark preference (Playwright would otherwise always report "light"); Light/Dark force `prefers-color-scheme`. No CSS filters or injected dark CSS. Sites that only offer a manual theme toggle cannot be switched automatically; WSNAP warns when Dark is requested and the site doesn't appear to define a dark theme.
- **Browser zoom** (25-300%, presets 50-200%) is emulated the way Chromium implements zoom: CSS viewport = width / zoom and pixel ratio = scale x zoom. Media queries see the zoomed width, so responsive layouts react as in a real browser. **Viewport size, browser zoom and device scale factor are separate**: output is always width x scale pixels wide (viewport captures are cropped losslessly to exactly height x scale).
- **One job planner** (`lib/jobs.ts`) decides what will be captured: unique normalized URLs x unique sizes. The Generate button, the summary line and the capture loop all use it and settings changes never add jobs; only the explicit "Additional sizes" chips and batch URLs do.

## Tests

```bash
npm test              # pure logic: validation, SSRF ranges, job planner, zoom geometry
npm run test:engine   # real Chromium + sharp against local pages (needs a browser, see below)
npm run test:ui       # bundles the real UI, drives it in Chromium; also covers responsive layouts
npm run test:all
```
`test:engine` and `test:ui` need a Chromium (`npm run setup:browser` or set `CHROME_PATH`). In their temporary build copy only, the private-network and port checks are stubbed so the engine can reach a local test server; production code is not modified.

## Free-tier limitations (please read)

- **60 s execution limit** (Hobby). Very slow sites will time out; use "DOM ready" wait mode.
- **4.5 MB response limit.** Large full-page PNGs may not fit. WSNAP first recompresses losslessly; WebP/JPEG quality is lowered automatically (and you are told). If it still can't fit, you get a clear error rather than a broken file. Use WebP/JPEG, lower the scale or use viewport mode for huge pages.
- **1 GB memory.** Captures are capped at ~16,000 px of bitmap height and 50 megapixels; taller pages are truncated and the result says so.
- **Cold starts** add a few seconds to the first capture.
- **Bot protection.** Sites behind Cloudflare/CAPTCHA or that block datacenter IPs, will often refuse. WSNAP reports this instead of saving the challenge page. It does not attempt to bypass protections.
- **Fonts.** The serverless Chromium has a limited font set; some non-Latin scripts may render with fallback glyphs.
- **Abuse protection.** A per-instance concurrency guard is included, but there is no global rate limiter (that needs shared storage). Add one (e.g. Vercel WAF rules) before promoting publicly.
- **DNS rebinding.** Hosts are validated before and during navigation, but Chromium performs its own resolution; a determined attacker controlling DNS could theoretically race it. For hostile-traffic deployments, add an egress proxy.
- Vercel's Hobby plan is for non-commercial use.

## Notes on versions
Dependency ranges are in `package.json`. `@sparticuz/chromium` and `playwright-core` should be upgraded together; if you see browser launch errors after upgrading, align the Chromium major version of the two.
