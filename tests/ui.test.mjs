import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync, mkdirSync } from "node:fs";
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
  app = http.createServer((q, s) => { if (q.url === "/favicon.ico") { s.writeHead(204); return s.end(); } if (q.url === "/icon.svg") { s.writeHead(200, { "content-type": "image/svg+xml" }); return s.end(readFileSync(`${process.cwd()}/public/icon.svg`)); } const f = files[q.url.split("?")[0]]; if (!f) { s.writeHead(404); return s.end(); } s.writeHead(200, { "content-type": f[1] }); s.end(readFileSync(`${UI}/${f[0]}`)); });
  site = http.createServer((q, s) => { const p = pages[q.url]; s.writeHead(p ? 200 : 404, { "content-type": "text/html" }); s.end(p ?? "nf"); });
  await Promise.all([new Promise((r) => app.listen(0, "127.0.0.1", r)), new Promise((r) => site.listen(0, "127.0.0.1", r))]);
  appUrl = `http://127.0.0.1:${app.address().port}/`; siteUrl = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
});
after(async () => { await browser?.close(); await discardBrowser(); app.close(); site.close(); });

/** Opens the app. `api` decides how /api/capture is answered: "mock" (instant PNG), a function or "real" (the real engine). */
async function open({ viewport = { width: 1280, height: 900 }, scheme = "light", delay = 0, api = "mock", failUrls = [] } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme: scheme });
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
