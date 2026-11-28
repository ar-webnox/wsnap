import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import sharp from "sharp";
import { capture, CaptureError, discardBrowser } from "./capture.ts";
import { ZOOM_PRESETS } from "./types.ts";

const pages = {
  "/scheme": `<!doctype html><title>Scheme</title><style>html,body{margin:0;height:100%;background:#fff}@media(prefers-color-scheme:dark){html,body{background:#101010}}</style><p>hello</p>`,
  "/nodark": `<!doctype html><title>NoDark</title><style>html,body{margin:0;height:100%;background:#fff}</style><p>hello</p>`,
  "/resp": `<!doctype html><title>Resp</title><style>html,body{margin:0;height:100%;background:#00f}@media(max-width:800px){html,body{background:#f00}}</style><p>x</p>`,
  "/tall": `<!doctype html><title>Tall</title><style>body{margin:0}div{height:5000px;background:linear-gradient(#0a0,#a00)}</style><div></div>`,
  "/blank": `<!doctype html><title>Blank</title>`,
};
let server, base;
before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/pdf") { res.writeHead(200, { "content-type": "application/pdf" }); return res.end("%PDF-1.4"); }
    if (req.url === "/gone") { res.writeHead(404, { "content-type": "text/html" }); return res.end("nope"); }
    const p = pages[req.url];
    res.writeHead(p ? 200 : 404, { "content-type": "text/html" }); res.end(p ?? "nf");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await discardBrowser(); });

const base0 = { mode: "viewport", device: "desktop", width: 800, height: 500, scale: 1, format: "png", quality: 90, waitMs: 0, waitUntil: "load",
  lazyLoad: false, hideCookieBanners: false, transparent: false, fixed: "keep", colorScheme: "auto", zoom: 100 };
const shot = (path, o = {}) => capture({ ...base0, url: base + path, ...o });
async function px(buf, x = 5, y = 5) {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels; return [data[i], data[i + 1], data[i + 2]];
}
const dark = ([r, g, b]) => r < 60 && g < 60 && b < 60, light = ([r, g, b]) => r > 230 && g > 230 && b > 230;

test("color scheme: auto follows the visitor's system preference, light/dark force it; same in full-page and viewport", async () => {
  for (const mode of ["viewport", "full"]) {
    const t = (o) => shot("/scheme", { mode, ...o }).then((r) => px(r.buffer));
    assert.ok(dark(await t({ colorScheme: "auto", systemScheme: "dark" })), `${mode} auto+dark system`);
    assert.ok(light(await t({ colorScheme: "auto", systemScheme: "light" })), `${mode} auto+light system`);
    assert.ok(light(await t({ colorScheme: "auto" })), `${mode} auto, no hint`);
    assert.ok(light(await t({ colorScheme: "light", systemScheme: "dark" })), `${mode} light overrides dark system`);
    assert.ok(dark(await t({ colorScheme: "dark", systemScheme: "light" })), `${mode} dark overrides light system`);
  }
});
test("dark mode on a site without a dark theme: page stays light and the user is told", async () => {
  const r = await shot("/nodark", { colorScheme: "dark" });
  assert.ok(light(await px(r.buffer)));
  assert.ok(r.notes.some((n) => /dark theme/i.test(n)));
  assert.ok(!(await shot("/scheme", { colorScheme: "dark" })).notes.some((n) => /dark theme/i.test(n)));
});
test("zoom changes layout (CSS viewport) but keeps output size; scale changes pixels but not layout", async () => {
  const w = 1440;
  const a = await shot("/resp", { width: w, height: 600, zoom: 100 }); assert.deepEqual([a.width, a.height], [1440, 600]); assert.ok(!dark(await px(a.buffer)) && (await px(a.buffer))[2] > 200, "100% -> wide layout (blue)");
  const b = await shot("/resp", { width: w, height: 600, zoom: 200 }); assert.deepEqual([b.width, b.height], [1440, 600]); assert.ok((await px(b.buffer))[0] > 200, "200% -> 720px CSS viewport (red)");
  const c = await shot("/resp", { width: w, height: 600, zoom: 50 }); assert.deepEqual([c.width, c.height], [1440, 600]); assert.ok((await px(c.buffer))[2] > 200, "50% -> wide layout (blue)");
  const d = await shot("/resp", { width: w, height: 600, zoom: 100, scale: 2 }); assert.deepEqual([d.width, d.height], [2880, 1200]); assert.ok((await px(d.buffer))[2] > 200, "scale 2 does not change layout");
  const e = await shot("/resp", { width: w, height: 600, zoom: 200, scale: 2 }); assert.deepEqual([e.width, e.height], [2880, 1200]); assert.ok((await px(e.buffer))[0] > 200, "zoom 200 + scale 2: layout red, pixels 2x");
});
test("every zoom preset and custom zooms produce exact output widths in both modes", async () => {
  for (const zoom of [...ZOOM_PRESETS, 33, 137, 300]) {
    for (const [width, scale] of [[1440, 1], [1366, 2], [393, 3]]) {
      for (const mode of ["viewport", "full"]) {
        const r = await shot("/tall", { mode, width, height: 800, scale, zoom });
        assert.equal(r.width, width * scale, `zoom ${zoom} ${mode} ${width}@${scale}x width`);
        if (mode === "viewport") assert.equal(r.height, 800 * scale, `zoom ${zoom} viewport height`);
        else assert.ok(r.height >= 1, "full height");
      }
    }
  }
});
test("full page captures the whole document at 100% zoom", async () => {
  const r = await shot("/tall", { mode: "full", width: 800, height: 500 });
  assert.deepEqual([r.width, r.height], [800, 5000]); assert.equal(r.pageHeight, 5000);
});
test("viewport mode captures exactly the viewport", async () => {
  const r = await shot("/tall", { mode: "viewport", width: 800, height: 500 });
  assert.deepEqual([r.width, r.height], [800, 500]);
});
test("metadata, formats", async () => {
  const r = await shot("/scheme", { format: "webp" });
  assert.equal(r.contentType, "image/webp"); assert.equal(r.title, "Scheme"); assert.equal(r.status, 200); assert.match(r.finalUrl, /\/scheme$/);
  assert.equal((await shot("/scheme", { format: "jpeg" })).contentType, "image/jpeg");
});
test("unsupported / failing pages give specific errors and never an image", async () => {
  await assert.rejects(() => shot("/pdf"), (e) => e instanceof CaptureError && e.code === "UNSUPPORTED");
  await assert.rejects(() => shot("/gone"), (e) => e instanceof CaptureError && e.code === "HTTP" && /wasn't found/.test(e.message));
  assert.ok((await shot("/blank")).notes.some((n) => /almost no visible content/.test(n)));
});
test("navigation timeout is reported as TIMEOUT", async () => {
  const slow = http.createServer(() => {}); await new Promise((r) => slow.listen(0, "127.0.0.1", r));
  slow.unref();
  await assert.rejects(() => capture({ ...base0, url: `http://127.0.0.1:${slow.address().port}/`, waitUntil: "domcontentloaded" }), (e) => e.code === "TIMEOUT");
  slow.closeAllConnections?.(); slow.close();
});
