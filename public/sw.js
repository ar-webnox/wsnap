/* WSNAP service worker: offline app shell only.
 * - Screenshots (/api/*) are NEVER intercepted or cached: they always go to the network.
 * - Pages: network-first, falling back to the cached shell, then /offline.html.
 * - Static assets: cache-first (hashed /_next/static files are immutable).
 * Bump VERSION to invalidate old caches. */
const VERSION = "v1";
const SHELL = `wsnap-shell-${VERSION}`;
const ASSETS = `wsnap-assets-${VERSION}`;
const PRECACHE = ["/", "/offline.html", "/manifest.webmanifest", "/icon.svg", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    await Promise.all(PRECACHE.map((u) => shell.add(new Request(u, { cache: "reload" })).catch(() => {})));
    // Cache the scripts/styles/fonts the home page references so the app also opens offline right after the first visit.
    try {
      const res = await shell.match("/");
      if (res) {
        const html = await res.clone().text();
        const urls = new Set();
        for (const m of html.matchAll(/(?:src|href)="(\/[^"#?]+\.(?:js|css|woff2?))(?:\?[^"]*)?"/g)) urls.add(m[0].replace(/^(?:src|href)="/, "").slice(0, -1));
        const assets = await caches.open(ASSETS);
        await Promise.all([...urls].map((u) => assets.add(new Request(u)).catch(() => {})));
      }
    } catch {}
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("wsnap-") && k !== SHELL && k !== ASSETS) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname === "/sw.js") return; // network, untouched

  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok && url.pathname === "/") (await caches.open(SHELL)).put("/", res.clone());
        return res;
      } catch {
        const shell = await caches.open(SHELL);
        return (await shell.match("/")) || (await shell.match("/offline.html")) || Response.error();
      }
    })());
    return;
  }

  if (/\.(?:js|css|woff2?|png|jpg|jpeg|webp|svg|ico|webmanifest)$/.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(ASSETS);
      const hit = await cache.match(req);
      if (hit) {
        // Stale-while-revalidate for non-hashed files (icons, manifest); hashed files never change.
        if (!url.pathname.startsWith("/_next/static/")) fetch(req).then((r) => r.ok && cache.put(req, r)).catch(() => {});
        return hit;
      }
      try { const res = await fetch(req); if (res.ok) cache.put(req, res.clone()); return res; }
      catch { const shell = await caches.open(SHELL); return (await shell.match(req)) || Response.error(); }
    })());
  }
});
