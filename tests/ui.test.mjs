import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { resolve, extname, join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import manifest from "./manifest.ts";
import { chromium } from "playwright-core";
import sharp from "sharp";
import { capture, discardBrowser } from "./capture.ts";

const UI = process.env.UI_DIR, SHOTS = process.env.UI_SHOTS || "/tmp/wsnap-ui"; mkdirSync(SHOTS, { recursive: true });
let app, site, browser, appUrl, siteUrl;
const pages = {
  "/resp": `<!doctype html><title>Resp</title><style>html,body{margin:0;height:100%;background:#00f}@media(max-width:800px){html,body{background:#f00}}</style><p>x</p>`,
  "/scheme": `<!doctype html><title>S</title><style>html,body{margin:0;height:100%;background:#fff}@media(prefers-color-scheme:dark){html,body{background:#101010}}</style>`,
};
before(async () => {
  const files = { "/": ["index.html", "text/html"], "/app.js": ["app.js", "text/javascript"], "/app.css": ["app.css", "text/css"] };
  const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };
  app = http.createServer((q, s) => {
    const path = decodeURI(q.url.split("?")[0]);
    if (path === "/manifest.webmanifest") { s.writeHead(200, { "content-type": MIME[".webmanifest"] }); return s.end(JSON.stringify(manifest())); }
    if (path === "/sw.js") { app.swHits = (app.swHits ?? 0) + 1; s.writeHead(200, { "content-type": "text/javascript", "service-worker-allowed": "/", "cache-control": "no-cache" }); return s.end(readFileSync(`${UI}/public/sw.js`)); }
    const f = files[path]; const full = resolve(UI, f ? f[0] : `public${path}`);
    if (!full.startsWith(UI + "/") || !existsSync(full) || !statSync(full).isFile()) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { "content-type": MIME[extname(full)] ?? "application/octet-stream" }); s.end(readFileSync(full));
  });
  site = http.createServer((q, s) => { const p = pages[q.url]; s.writeHead(p ? 200 : 404, { "content-type": "text/html" }); s.end(p ?? "nf"); });
  await Promise.all([new Promise((r) => app.listen(0, "127.0.0.1", r)), new Promise((r) => site.listen(0, "127.0.0.1", r))]);
  appUrl = `http://127.0.0.1:${app.address().port}/`; siteUrl = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
});
after(async () => { await browser?.close(); await discardBrowser(); app.close(); site.close(); });

/** Opens the app. `api` decides how /api/capture is answered: "mock" (instant PNG), a function or "real" (the real engine). */
async function open({ viewport = { width: 1280, height: 900 }, scheme = "light", delay = 0, api = "mock", failUrls = [], sw = false, ctxOpts = {}, init } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme: scheme, serviceWorkers: sw ? "allow" : "block", ...ctxOpts });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage(); const reqs = []; const errors = [];
  page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => m.type() === "error" && !/^Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.route("**/api/capture", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}"); reqs.push(body);
    if (delay) await new Promise((r) => setTimeout(r, delay));
    if (failUrls.some((u) => body.url.includes(u))) return route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: { code: "UNREACHABLE", message: "Couldn't reach it." } }) });
    if (api === "real") {
      const r = await capture({ ...body, url: siteUrl + (body.url.includes("scheme") ? "/scheme" : "/resp"), waitMs: 0 });
      page.lastReal = r;
      return route.fulfill({ status: 200, contentType: r.contentType, body: r.buffer, headers: { "X-Image-Width": String(r.width), "X-Image-Height": String(r.height), "X-Capture-Ms": String(r.ms), "X-Notes": encodeURIComponent(JSON.stringify(r.notes)), "X-Page-Title": encodeURIComponent(r.title), "X-Http-Status": "200", "X-Final-Url": encodeURIComponent(body.url) } });
    }
    const w = body.width * body.scale, h = Math.min(body.height * body.scale, 300);
    const png = await sharp({ create: { width: w, height: h, channels: 3, background: body.url.includes("dark") ? "#101010" : "#ffffff" } }).png().toBuffer();
    return route.fulfill({ status: 200, contentType: "image/png", body: png, headers: { "X-Image-Width": String(w), "X-Image-Height": String(h), "X-Capture-Ms": "1200", "X-Notes": "%5B%5D", "X-Page-Title": "T", "X-Http-Status": "200", "X-Final-Url": encodeURIComponent(body.url), "X-Page-Height": "4321" } });
  });
  await page.goto(appUrl); await page.waitForSelector("#studio");
  const ui = {
    page, reqs, errors, ctx,
    gen: page.locator('#studio button[type=submit]'),
    summary: page.locator('[data-testid=summary]'),
    url: (v) => page.locator('input[aria-label="Website URL"]').fill(v),
    radio: (n) => page.getByRole("radio", { name: n, exact: true }),
    chip: (n) => page.getByRole("button", { name: new RegExp("^" + n, "i") }),
    adv: async () => { if (!(await page.locator("details:has(summary:has-text('Advanced options'))").evaluate((d) => d.open))) await page.locator("summary", { hasText: "Advanced options" }).click(); },
    zoom: (v) => page.locator("label", { hasText: "Browser zoom" }).locator("select").selectOption(String(v)),
    label: async () => (await page.locator('#studio button[type=submit]').innerText()).trim(),
    done: () => page.waitForSelector('text="Capture details"', { timeout: 20000 }),
  };
  return ui;
}
const noErrors = (u) => assert.deepEqual(u.errors, [], "no console/page errors");

test("count: one URL + one configuration is always 'Generate 1 screenshot'; settings never add jobs", async () => {
  const u = await open();
  assert.equal(await u.label(), "Generate 1 screenshot");
  await u.url("example.com"); assert.equal(await u.label(), "Generate 1 screenshot");
  await u.radio("Viewport").click(); await u.radio("Mobile").click(); assert.equal(await u.label(), "Generate 1 screenshot");
  await u.radio("Desktop").click(); await u.radio("JPEG").click(); await u.radio("WebP").click();
  await u.adv(); await u.zoom(150); await u.radio("Dark").click(); await u.radio("2×").click(); await u.radio("Auto").click();
  await u.page.getByRole("button", { name: /1366 × 768/ }).click();
  assert.equal(await u.label(), "Generate 1 screenshot");
  assert.match(await u.summary.innerText(), /^1 screenshot · /);
  assert.equal(u.reqs.length, 0, "changing settings never triggers captures");
  // intentional extras
  await u.chip("tablet").click(); assert.equal(await u.label(), "Generate 2 screenshots");
  await u.chip("mobile").click(); assert.equal(await u.label(), "Generate 3 screenshots");
  assert.match(await u.summary.innerText(), /\+ tablet, mobile sizes/);
  await u.chip("tablet").click(); await u.chip("mobile").click(); assert.equal(await u.label(), "Generate 1 screenshot");
  // an extra that equals the primary size is not counted (and its chip is disabled)
  await u.chip("tablet").click(); await u.radio("Tablet").click();
  assert.equal(await u.label(), "Generate 1 screenshot"); assert.ok(await u.chip("tablet").isDisabled());
  await u.radio("Desktop").click(); assert.equal(await u.label(), "Generate 2 screenshots", "chip state is visible and counted consistently");
  // batch: duplicates / case variants collapse
  await u.chip("tablet").click(); await u.page.getByText("Batch mode").click();
  await u.page.locator("textarea").fill("example.com\nEXAMPLE.com\nhttps://example.com/\nwikipedia.org");
  assert.equal(await u.label(), "Generate 2 screenshots");
  await u.chip("tablet").click(); assert.equal(await u.label(), "Generate 4 screenshots");
  noErrors(u); await u.ctx.close();
});

test("duplicate submissions are prevented; settings changes after a capture never create jobs", async () => {
  const u = await open({ delay: 1200 });
  await u.url("example.com");
  await u.gen.dblclick({ delay: 10 });
  for (let i = 0; i < 3; i++) await u.page.keyboard.press("Control+Enter");
  await u.page.locator('#studio button:has-text("Cancel")').waitFor();
  await u.done();
  assert.equal(u.reqs.length, 1, "exactly one request for repeated clicks / shortcuts");
  await u.radio("Viewport").click(); await u.adv(); await u.zoom(75); await u.radio("Dark").click(); await u.radio("3×").click();
  await u.page.waitForTimeout(600);
  assert.equal(u.reqs.length, 1); assert.equal(await u.label(), "Generate 1 screenshot");
  await u.gen.click(); await u.done(); assert.equal(u.reqs.length, 2, "one click = one more request");
  noErrors(u); await u.ctx.close();
});

test("payload carries zoom, scale, viewport and color scheme as three independent settings; extras inherit them", async () => {
  const u = await open({ scheme: "dark" });
  await u.url("example.com"); await u.radio("Viewport").click(); await u.adv();
  await u.zoom(125); await u.radio("2×").click(); await u.radio("Light").click();
  await u.chip("mobile").click(); await u.gen.click();
  await u.page.waitForFunction(() => document.querySelectorAll("[data-icon]").length > 0); await u.done();
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(u.reqs.length, 2);
  const [a, b] = u.reqs;
  assert.deepEqual([a.width, a.height, a.zoom, a.scale, a.colorScheme, a.mode, a.systemScheme], [1440, 900, 125, 2, "light", "viewport", "dark"]);
  assert.deepEqual([b.width, b.height, b.device, b.zoom, b.scale, b.colorScheme], [393, 852, "mobile", 125, 2, "light"]);
  noErrors(u); await u.ctx.close();
});

test("every zoom preset and a custom zoom reach the server unchanged", async () => {
  const u = await open(); await u.url("example.com"); await u.adv();
  for (const z of [50, 60, 70, 75, 80, 90, 100, 110, 125, 150, 175, 200]) {
    await u.zoom(z); const n = u.reqs.length; await u.gen.click(); await u.done(); await u.page.waitForTimeout(150);
    assert.equal(u.reqs.length, n + 1); assert.equal(u.reqs.at(-1).zoom, z);
  }
  await u.zoom("custom"); const input = u.page.getByLabel("Custom zoom percentage");
  await input.fill("137"); await u.gen.click(); await u.done(); await u.page.waitForTimeout(150);
  assert.equal(u.reqs.at(-1).zoom, 137);
  noErrors(u); await u.ctx.close();
});

test("advanced options are available in both modes; only genuinely inapplicable ones are disabled, with tooltips", async () => {
  const u = await open(); await u.adv();
  const lazy = u.page.getByRole("switch", { name: /Load lazy content/ }), fixed = u.page.locator("label", { hasText: "Sticky & fixed" }).locator("select");
  for (const el of ["Device scale factor", "Browser zoom", "Website color scheme", "Custom user-agent", "Page load strategy", "Wait before capture", "Hide cookie banners", "Transparent background"]) assert.ok(await u.page.getByText(el).first().isVisible(), `${el} visible in full mode`);
  assert.ok(await lazy.isEnabled()); assert.ok(await fixed.isEnabled());
  await u.radio("Viewport").click();
  for (const el of ["Device scale factor", "Browser zoom", "Website color scheme", "Custom user-agent", "Page load strategy", "Wait before capture", "Hide cookie banners", "Transparent background"]) assert.ok(await u.page.getByText(el).first().isVisible(), `${el} visible in viewport mode`);
  assert.ok(await lazy.isDisabled()); assert.ok(await fixed.isDisabled());
  assert.match(await lazy.getAttribute("title"), /Full page/); assert.match(await u.page.locator("label", { hasText: "Sticky & fixed" }).getAttribute("title"), /Full page/);
  const tr = u.page.getByRole("switch", { name: /Transparent background/ });
  assert.ok(await tr.isEnabled()); await u.radio("JPEG").click(); assert.ok(await tr.isDisabled()); assert.match(await tr.getAttribute("title"), /JPEG/);
  noErrors(u); await u.ctx.close();
});

test("history survives reload; last-used settings restored; rename + delete work; compare opens", async () => {
  const u = await open(); await u.url("example.com"); await u.adv(); await u.zoom(150); await u.radio("Dark").click();
  await u.gen.click(); await u.done();
  await u.url("wikipedia.org"); await u.gen.click(); await u.done(); await u.page.waitForTimeout(400);
  await u.page.reload(); await u.page.waitForSelector("#recent li");
  assert.equal(await u.page.locator("#recent li").count(), 2, "history persisted in IndexedDB");
  await u.adv(); assert.equal(await u.page.locator("label", { hasText: "Browser zoom" }).locator("select").inputValue(), "150", "last settings restored");
  assert.equal(await u.page.getByRole("radio", { name: "Dark", exact: true }).getAttribute("aria-checked"), "true");
  assert.equal(await u.label(), "Generate 1 screenshot");
  await u.page.locator("#recent li").first().getByRole("button", { name: "Rename" }).click();
  await u.page.getByLabel("Capture name").fill("Hero shot"); await u.page.keyboard.press("Enter");
  await u.page.getByText("Hero shot").waitFor(); // visible after the DB write + refresh, then prove it survives a reload
  await u.page.reload(); await u.page.waitForSelector("#recent li"); assert.ok(await u.page.getByText("Hero shot").isVisible(), "rename persisted");
  const boxes = u.page.locator('#recent input[type=checkbox]'); await boxes.nth(0).check(); await boxes.nth(1).check();
  await u.page.getByRole("button", { name: /Compare selected/ }).click(); await u.page.waitForSelector('[role=dialog][aria-label="Compare screenshots"] img');
  await u.page.keyboard.press("Escape");
  await u.page.locator("#recent li").first().getByRole("button", { name: "Delete" }).click();
  await u.page.waitForFunction(() => document.querySelectorAll("#recent li").length === 1);
  noErrors(u); await u.ctx.close();
});

test("batch with a failing URL: partial success is reported and Retry failed re-sends only the failed job", async () => {
  const u = await open({ failUrls: ["bad.example"] });
  await u.page.getByText("Batch mode").click(); await u.page.locator("textarea").fill("good.example\nbad.example");
  await u.gen.click(); await u.page.getByText("Some captures didn't complete").waitFor();
  assert.equal(u.reqs.length, 2);
  await u.page.getByRole("button", { name: /Retry failed \(1\)/ }).click(); await u.page.waitForTimeout(600);
  assert.equal(u.reqs.length, 3); assert.ok(u.reqs[2].url.includes("bad.example"));
  noErrors(u); await u.ctx.close();
});

test("END-TO-END with the real engine: UI settings drive the real Chromium capture (zoom, dark scheme, exact size)", async () => {
  const u = await open({ api: "real", scheme: "dark" });
  await u.url("example.com/resp"); await u.radio("Viewport").click(); await u.radio("Custom").click();
  await u.page.getByLabel("Width").fill("1000"); await u.page.getByLabel("Height").fill("600");
  await u.adv(); await u.zoom(200); await u.gen.click(); await u.done();
  const r1 = u.page.lastReal; assert.deepEqual([r1.width, r1.height], [1000, 600]);
  const { data } = await sharp(r1.buffer).raw().toBuffer({ resolveWithObject: true });
  assert.ok(data[0] > 200 && data[2] < 60, "zoom 200% -> 500px CSS viewport -> responsive red layout");
  assert.ok(await u.page.getByText("1000 × 600px").first().isVisible(), "preview shows the real captured size");
  await u.url("example.com/scheme"); await u.zoom(100); await u.gen.click(); await u.done(); await u.page.waitForTimeout(200);
  assert.ok((await sharp(u.page.lastReal.buffer).raw().toBuffer())[0] < 60, "Auto + dark system -> dark");
  await u.radio("Light").click(); await u.gen.click(); await u.page.waitForTimeout(2500);
  assert.ok((await sharp(u.page.lastReal.buffer).raw().toBuffer())[0] > 230, "Light forces light even on a dark system");
  noErrors(u); await u.ctx.close();
});

test("theme switching works and persists without flashing", async () => {
  const u = await open({ scheme: "light" });
  assert.ok(await u.page.evaluate(() => document.documentElement.classList.contains("dark")), "default theme is dark");
  await u.page.getByRole("button", { name: "Toggle theme" }).click();
  assert.ok(!(await u.page.evaluate(() => document.documentElement.classList.contains("dark"))));
  await u.page.reload(); assert.ok(!(await u.page.evaluate(() => document.documentElement.classList.contains("dark"))), "persisted");
  await u.page.getByRole("button", { name: "Settings" }).click(); await u.page.getByRole("radio", { name: "Dark", exact: true }).last().click();
  assert.ok(await u.page.evaluate(() => document.documentElement.classList.contains("dark")));
  noErrors(u); await u.ctx.close();
});

for (const [name, viewport] of [["mobile-375", { width: 375, height: 812 }], ["small-320", { width: 320, height: 640 }], ["tablet-768", { width: 768, height: 1024 }], ["laptop-1440", { width: 1440, height: 900 }]]) {
  test(`responsive ${name}: no horizontal overflow, controls usable, screenshots saved`, async () => {
    const u = await open({ viewport, scheme: "dark" });
    const overflow = () => u.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok((await overflow()) <= 0, "idle");
    await u.page.screenshot({ path: `${SHOTS}/${name}-idle.png`, fullPage: true });
    await u.adv(); await u.chip("tablet").click(); await u.url("example.com"); await u.zoom("custom");
    assert.ok((await overflow()) <= 0, "advanced open");
    await u.page.screenshot({ path: `${SHOTS}/${name}-advanced.png`, fullPage: true });
    await u.gen.click(); await u.done(); await u.page.waitForTimeout(800);
    assert.ok((await overflow()) <= 0, "with result");
    const small = await u.page.evaluate(() => [...document.querySelectorAll("button,select,input:not([type=checkbox]):not([type=range]),summary")].filter((e) => e.offsetParent && e.getBoundingClientRect().height < 32 && e.getBoundingClientRect().width > 0).map((e) => e.textContent.trim().slice(0, 20) || e.getAttribute("aria-label")));
    assert.deepEqual(small, [], "touch targets >= 32px");
    await u.page.screenshot({ path: `${SHOTS}/${name}-result.png`, fullPage: true });
    noErrors(u); await u.ctx.close();
  });
}

// ───────────────────────────── PWA ─────────────────────────────
const pub = (p) => `${UI}/public${p}`;
const readPng = async (p) => { const m = await sharp(pub(p)).metadata(); return [m.width, m.height, m.format]; };
const IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const MAC_SAFARI_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const promptEvent = () => { const e = new Event("beforeinstallprompt", { cancelable: true }); e.prompt = async () => { window.__prompted = (window.__prompted || 0) + 1; }; e.userChoice = Promise.resolve({ outcome: "accepted" }); window.dispatchEvent(e); return e.defaultPrevented; };
const swReady = (page) => page.evaluate(() => navigator.serviceWorker.ready.then((r) => !!r.active));

test("PWA manifest: identity, display, colors, icon set, shortcuts and screenshots are valid and every referenced file exists with the declared size", async () => {
  const m = JSON.parse(JSON.stringify(manifest()));
  assert.deepEqual([m.name, m.short_name, m.display, m.background_color, m.theme_color, m.scope, m.id], ["WSNAP", "WSNAP", "standalone", "#09090b", "#09090b", "/", "/"]);
  assert.match(m.start_url, /^\/(\?|$)/); assert.equal(m.prefer_related_applications, false);
  const purposes = (s) => m.icons.filter((i) => i.sizes === s).map((i) => i.purpose);
  assert.ok(purposes("192x192").includes("any") && purposes("192x192").includes("maskable"), "192 any + maskable");
  assert.ok(purposes("512x512").includes("any") && purposes("512x512").includes("maskable"), "512 any + maskable");
  for (const i of m.icons.filter((i) => i.type === "image/png")) {
    const [w, h, fmt] = await readPng(i.src); assert.equal(fmt, "png"); assert.equal(`${w}x${h}`, i.sizes, i.src);
  }
  for (const i of m.icons.filter((i) => i.purpose === "maskable")) {   // maskable: opaque full-bleed brand background, glyph inside the 80% safe zone
    const { data, info } = await sharp(pub(i.src)).raw().toBuffer({ resolveWithObject: true });
    const at = (x, y) => [...data.slice((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 4)];
    for (const [x, y] of [[0, 0], [info.width - 1, 0], [0, info.height - 1], [info.width - 1, info.height - 1]]) assert.deepEqual(at(x, y).slice(0, 3), [9, 9, 11], `${i.src} corner bg`), assert.equal(at(x, y)[3], 255);
    const edge = Math.round(info.width * 0.1); let lit = 0;      // outer 10% ring must contain only the background
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if ((x < edge || y < edge || x >= info.width - edge || y >= info.height - edge) && at(x, y)[0] > 40) lit++;
    assert.equal(lit, 0, `${i.src} glyph stays inside the safe zone`);
  }
  for (const i of m.icons.filter((i) => i.purpose === "any" && i.type === "image/png" && parseInt(i.sizes) >= 96)) {
    const { data } = await sharp(pub(i.src)).raw().toBuffer({ resolveWithObject: true }); assert.equal(data[3], 0, `${i.src} rounded: transparent corner`);
  }
  assert.ok(existsSync(pub("/icon.svg")));
  for (const s of m.screenshots) { const [w, h] = await readPng(s.src); assert.equal(`${w}x${h}`, s.sizes); assert.ok(["wide", "narrow"].includes(s.form_factor)); }
  for (const sc of m.shortcuts) { assert.ok(sc.name && sc.url.startsWith("/")); assert.ok(existsSync(pub(sc.icons[0].src))); }
  // iOS: apple touch icon, favicon and every launch image declared in layout.tsx exists with the right pixel size
  assert.deepEqual(await readPng("/apple-icon.png"), [180, 180, "png"]); assert.ok(existsSync(pub("/favicon.ico")));
  const layout = readFileSync(`${process.cwd()}/app/layout.tsx`, "utf8");
  const splash = [...layout.match(/const SPLASH = (\[\[.*?\]\]) as const/s)[1].matchAll(/\[(\d+), (\d+), (\d)\]/g)];
  assert.equal(splash.length, 14);
  for (const [, w, h] of splash) assert.deepEqual(await readPng(`/splash/splash-${w}x${h}.png`), [Number(w), Number(h), "png"]);
  assert.match(layout, /appleWebApp: \{ capable: true, title: "WSNAP"/); assert.match(layout, /applicationName: "WSNAP"/);
  assert.match(readFileSync(`${process.cwd()}/next.config.mjs`, "utf8"), /Service-Worker-Allowed/);
});

test("Chromium itself reports the app as installable (manifest parses, no installability errors, service worker active)", async () => {
  // A persistent profile is NOT incognito (Playwright's default contexts are and Chromium refuses installs there).
  const dir = mkdtempSync(join(tmpdir(), "wsnap-pwa-"));
  const ctx = await chromium.launchPersistentContext(dir, { executablePath: process.env.CHROME_PATH || undefined, serviceWorkers: "allow" });
  const u = { ctx, page: ctx.pages()[0] ?? (await ctx.newPage()) };
  await u.page.goto(appUrl); await u.page.waitForSelector("#studio"); await swReady(u.page); await u.page.reload(); await u.page.waitForSelector("#studio");
  const cdp = await u.ctx.newCDPSession(u.page);
  const { url, errors, data } = await cdp.send("Page.getAppManifest");
  assert.match(url, /manifest\.webmanifest$/); assert.deepEqual(errors.map((e) => e.message), [], "manifest has no parse errors/warnings");
  assert.equal(JSON.parse(data).short_name, "WSNAP");
  const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
  assert.deepEqual(installabilityErrors, [], "no installability errors");
  assert.ok(await u.page.evaluate(() => !!navigator.serviceWorker.controller), "page is controlled by the service worker");
  await u.ctx.close(); rmSync(dir, { recursive: true, force: true });
});

test("service worker: app shell works offline, API calls are never intercepted or cached, offline notice appears", async () => {
  const u = await open({ sw: true }); await swReady(u.page);
  await u.page.reload(); await u.page.waitForSelector("#studio");
  const cached = await u.page.evaluate(async () => { const keys = await caches.keys(); const hit = async (p) => !!(await caches.match(p)); return { keys, shell: await hit("/"), js: await hit("/app.js"), css: await hit("/app.css"), offline: await hit("/offline.html"), manifest: await hit("/manifest.webmanifest") }; });
  assert.ok(cached.shell && cached.js && cached.css && cached.offline && cached.manifest, JSON.stringify(cached));
  // an API capture goes through the network (the page route sees it) and is not cached
  await u.url("example.com"); await u.gen.click(); await u.done();
  assert.equal(u.reqs.length, 1, "SW did not swallow /api/capture");
  assert.equal(await u.page.evaluate(async () => !!(await caches.match("/api/capture"))), false, "API responses are never cached");
  // offline: reload from cache, shell + saved history available, offline notice shown, capture fails with a clear message
  await u.page.waitForTimeout(400); await u.ctx.setOffline(true); await u.page.unroute("**/api/capture");
  await u.page.reload(); await u.page.waitForSelector("#studio"); await u.page.waitForSelector("#recent li");
  assert.ok(await u.page.getByText("You're offline").isVisible(), "offline notice");
  await u.url("example.com"); await u.gen.click(); await u.page.getByText("Couldn't reach the WSNAP server").waitFor();
  await u.page.goto(appUrl + "some/unknown/route"); await u.page.waitForSelector("#studio");   // navigations fall back to the shell
  await u.ctx.setOffline(false); await u.page.goto(appUrl); await u.page.waitForSelector("#studio");
  assert.equal(await u.page.getByText("You're offline").count(), 0, "notice clears when back online");
  assert.deepEqual(u.errors.filter((e) => !/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(e)), []);
  await u.ctx.close();
});

test("install UX: native prompt where supported; hidden after install and when already running as an app", async () => {
  const u = await open({ sw: false });
  const btn = u.page.getByRole("button", { name: "Install WSNAP app" });
  assert.equal(await btn.count(), 0, "no Install button without a prompt on Chromium-class browsers that haven't offered one");
  assert.equal(await u.page.evaluate(promptEvent), true, "beforeinstallprompt is captured (default mini-infobar prevented)");
  await btn.waitFor(); await btn.click();
  await u.page.waitForFunction(() => window.__prompted === 1); await u.page.waitForFunction(() => document.querySelectorAll('[aria-label="Install WSNAP app"]').length === 0);
  await u.page.evaluate(promptEvent); await btn.waitFor(); await u.page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  await u.page.waitForFunction(() => document.querySelectorAll('[aria-label="Install WSNAP app"]').length === 0);
  await u.ctx.close();
  const s = await open({ init: () => { const o = window.matchMedia.bind(window); window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q) ? { matches: true, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false } : o(q)); } });
  await s.page.evaluate(promptEvent); await s.page.waitForTimeout(300);
  assert.equal(await s.page.getByRole("button", { name: "Install WSNAP app" }).count(), 0, "hidden in standalone mode");
  await s.ctx.close();
});

test("install UX: iOS and macOS Safari get a clear Add to Home Screen / Add to Dock guide", async () => {
  const i = await open({ viewport: { width: 390, height: 844 }, scheme: "dark", ctxOpts: { userAgent: IOS_UA, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } });
  const b = i.page.getByRole("button", { name: "Install WSNAP app" }); await b.waitFor(); await b.click();
  const dlg = i.page.getByRole("dialog", { name: "Install WSNAP" }); await dlg.waitFor();
  assert.match(await dlg.innerText(), /Share[\s\S]*Add to Home Screen[\s\S]*Add/);
  assert.ok((await dlg.locator("img").getAttribute("src")).includes("/icons/icon-96.png"));
  assert.ok(await i.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "no overflow");
  const overlay = await dlg.evaluate((d) => { const r = d.parentElement.getBoundingClientRect(); return { parentIsBody: d.parentElement.parentElement === document.body, x: r.x, y: r.y, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight }; });
  assert.deepEqual([overlay.parentIsBody, overlay.x, overlay.y, overlay.w, overlay.h], [true, 0, 0, overlay.vw, overlay.vh], "dialog overlay covers the whole viewport (not trapped in the header)");
  await i.page.waitForTimeout(450); await i.page.screenshot({ path: `${SHOTS}/pwa-ios-guide.png` });
  await i.page.keyboard.press("Escape"); await dlg.waitFor({ state: "detached" }); await i.ctx.close();
  const m = await open({ ctxOpts: { userAgent: MAC_SAFARI_UA }, scheme: "dark" });
  await m.page.getByRole("button", { name: "Install WSNAP app" }).click();
  assert.match(await m.page.getByRole("dialog", { name: "Install WSNAP" }).innerText(), /File → Add to Dock/);
  await m.page.waitForTimeout(450); await m.page.screenshot({ path: `${SHOTS}/pwa-mac-guide.png` });
  await m.ctx.close();
});

test("Install button is usable on a 320px screen and in both themes (no overflow, 40px target)", async () => {
  for (const scheme of ["dark", "light"]) {
    const u = await open({ viewport: { width: 320, height: 640 }, scheme });
    await u.page.evaluate(promptEvent); const b = u.page.getByRole("button", { name: "Install WSNAP app" }); await b.waitFor();
    const box = await b.boundingBox(); assert.ok(box.height >= 40 && box.width >= 40, `target ${box.width}x${box.height}`);
    assert.ok(await u.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    await u.page.screenshot({ path: `${SHOTS}/pwa-nav-320-${scheme}.png`, clip: { x: 0, y: 0, width: 320, height: 120 } });
    await u.ctx.close();
  }
});

test("Settings dialog overlay also covers the whole viewport and closes with Escape", async () => {
  const u = await open({ viewport: { width: 390, height: 844 }, scheme: "dark" });
  await u.page.getByRole("button", { name: "Settings" }).click(); const dlg = u.page.getByRole("dialog", { name: "Settings" }); await dlg.waitFor();
  const o = await dlg.evaluate((d) => { const r = d.parentElement.getBoundingClientRect(); return [r.x, r.y, r.width, r.height, innerWidth, innerHeight]; });
  assert.deepEqual(o, [0, 0, o[4], o[5], o[4], o[5]]);
  await u.page.waitForTimeout(450); await u.page.screenshot({ path: `${SHOTS}/settings-dialog-390.png` });
  await u.page.keyboard.press("Escape"); await dlg.waitFor({ state: "detached" }); await u.ctx.close();
});
