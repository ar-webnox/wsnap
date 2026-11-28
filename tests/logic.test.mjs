import test from "node:test";
import assert from "node:assert/strict";
import { validateUrl, parseOptions } from "./validation.ts";
import { isPrivateIp, assertPublicHost, BlockedHostError } from "./ssrf.ts";
import { formatBytes, buildFilename } from "./export.ts";

test("validateUrl accepts and normalizes public URLs", () => {
  assert.equal(validateUrl("example.com").url.href, "https://example.com/");
  assert.equal(validateUrl("  http://example.com/a?b=1 ").ok, true);
  assert.equal(validateUrl("https://example.com:443/x").ok, true);
});
test("validateUrl rejects unsafe or malformed input", () => {
  for (const bad of ["", "   ", "javascript:alert(1)", "file:///etc/passwd", "ftp://example.com", "data:text/html,hi", "chrome://settings",
    "https://user:pw@example.com", "https://example.com:8080", "localhost", "localhost:3000", "http://intranet", "https://" + "a".repeat(2100) + ".com", "http://exa mple.com"]) {
    assert.equal(validateUrl(bad).ok, false, `should reject: ${bad.slice(0, 40)}`);
  }
});
test("URL parser normalizes obfuscated IPs so the SSRF check sees the real address", () => {
  for (const u of ["http://2130706433/", "http://0x7f.1/", "http://127.1/", "http://[::ffff:127.0.0.1]/", "http://0177.0.0.1/"]) {
    const h = new URL(u).hostname;
    assert.equal(isPrivateIp(h.replace(/^\[|\]$/g, "")), true, `${u} -> ${h}`);
  }
});
test("isPrivateIp blocks private, loopback, link-local, metadata and reserved ranges", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255",
    "::1", "::", "fd00:ec2::254", "fe80::1", "::ffff:7f00:1", "::ffff:10.0.0.1", "ff02::1", "2001:db8::1", "64:ff9b::7f00:1"]) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "93.184.216.34", "172.32.0.1", "172.15.0.1", "100.63.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
    assert.equal(isPrivateIp(ip), false, ip);
  }
});
test("assertPublicHost rejects internal names and literals, allows public literals", async () => {
  for (const h of ["localhost", "LOCALHOST.", "db.internal", "printer.local", "127.0.0.1", "[::1]", "169.254.169.254", "metadata.google.internal"]) {
    await assert.rejects(() => assertPublicHost(h), BlockedHostError, h);
  }
  await assert.doesNotReject(() => assertPublicHost("93.184.216.34"));
});
test("parseOptions clamps values and applies safe defaults", () => {
  const r = parseOptions({ url: "example.com", width: 99999, height: 1, scale: 9, quality: 5, waitMs: 1e9, format: "gif", mode: "x", fixed: "bad", userAgent: "ok\r\nX-Evil: 1" });
  assert.equal(r.ok, true);
  const v = r.value;
  assert.deepEqual([v.width, v.height, v.scale, v.quality, v.waitMs, v.format, v.mode, v.fixed], [3840, 240, 3, 40, 10000, "png", "full", "keep"]);
  assert.equal(/[\r\n]/.test(v.userAgent), false);
  assert.equal(parseOptions({ url: "file:///x" }).ok, false);
  assert.equal(parseOptions(null).ok, false);
});
test("export helpers", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2.0 KB");
  assert.equal(formatBytes(3 * 1024 * 1024), "3.00 MB");
  const f = buildFilename("https://www.example.com/a", 1440, 900, "full", "jpeg", new Date(2026, 0, 2, 3, 4, 5));
  assert.equal(f, "wsnap_example.com_1440x900_fullpage_20260102-030405.jpg");
  assert.match(buildFilename("My shot.png", 10, 10, "viewport", "png"), /^wsnap_My-shot_10x10_viewport_.*\.png$/);
});

import { planJobs, EXTRA_SIZES } from "./jobs.ts";
import { zoomGeometry } from "./geometry.ts";
const cfg = { url: "", mode: "full", device: "desktop", width: 1440, height: 900, scale: 1, format: "png", quality: 90, waitMs: 1000, waitUntil: "load", lazyLoad: true, hideCookieBanners: true, transparent: false, fixed: "keep", colorScheme: "auto", zoom: 100 };
test("planJobs: one URL + one configuration = exactly 1 job, whatever the other settings are", () => {
  for (const patch of [{}, { zoom: 150 }, { colorScheme: "dark" }, { scale: 3 }, { mode: "viewport" }, { width: 393, height: 852, device: "custom" }, { format: "webp", transparent: true }]) {
    const p = planJobs({ ...cfg, ...patch }, ["example.com"], []);
    assert.equal(p.jobs.length, 1, JSON.stringify(patch)); assert.equal(p.count, 1);
  }
});
test("planJobs: counts only intentionally selected, unique captures", () => {
  assert.equal(planJobs(cfg, ["example.com"], ["tablet"]).count, 2);
  assert.equal(planJobs(cfg, ["example.com"], ["tablet", "tablet", "mobile"]).count, 3);
  assert.equal(planJobs(cfg, ["example.com"], ["desktop"]).count, 1, "desktop extra equals primary 1440x900");
  assert.equal(planJobs({ ...cfg, device: "custom", width: 820, height: 1180 }, ["example.com"], ["tablet"]).count, 2, "custom size identical to tablet extra but desktop-class UA: both kept");
  assert.equal(planJobs({ ...cfg, device: "tablet", width: 820, height: 1180 }, ["example.com"], ["tablet"]).count, 1, "tablet extra identical to tablet primary");
  assert.equal(planJobs(cfg, ["example.com", " EXAMPLE.com ", "https://example.com/", "b.com"], []).count, 2, "URL duplicates collapse");
  const p = planJobs(cfg, ["a.com", "b.com"], ["tablet", "mobile"]);
  assert.equal(p.jobs.length, 6); assert.equal(new Set(p.jobs.map((j) => `${j.url}|${j.width}x${j.height}`)).size, 6, "no duplicate jobs");
  assert.deepEqual(p.jobs.slice(0, 3).map((j) => [j.width, j.height]), [[1440, 900], [820, 1180], [393, 852]], "primary first, extras after");
  assert.ok(p.jobs.every((j) => j.zoom === 100 && j.colorScheme === "auto"), "extras inherit the primary configuration");
});
test("planJobs: limits and invalid lines", () => {
  assert.match(planJobs(cfg, ["a.com", "b.com", "c.com", "d.com", "e.com", "f.com"], []).tooMany, /up to 5/);
  assert.match(planJobs(cfg, ["a.com", "b.com", "c.com", "d.com", "e.com"], ["tablet", "mobile"]).tooMany, /limit is 10/);
  const p = planJobs(cfg, ["example.com", "javascript:alert(1)"], []);
  assert.equal(p.jobs.length, 1); assert.equal(p.invalid.length, 1);
  assert.equal(planJobs(cfg, [""], []).count, 1); assert.equal(planJobs(cfg, [""], []).jobs.length, 0);
});
test("zoomGeometry keeps output width exact and CSS viewport = width / zoom", () => {
  assert.deepEqual(zoomGeometry(1440, 900, 1, 100), { vw: 1440, vh: 900, eff: 1 });
  const g = zoomGeometry(1440, 900, 2, 200); assert.deepEqual([g.vw, g.vh, g.eff], [720, 450, 4]);
  for (const z of [25, 33, 50, 60, 70, 75, 80, 90, 110, 125, 137, 150, 175, 200, 300]) for (const w of [393, 1366, 1440, 3840]) {
    const q = zoomGeometry(w, 800, 2, z); assert.ok(Math.abs(q.vw * q.eff - w * 2) < 1e-6); assert.ok(q.vh * q.eff >= 1600 - 1e-6);
  }
  assert.equal(zoomGeometry(1000, 1000, 1, 1).vw, 4000, "zoom clamps to 25%");
});
test("parseOptions: new fields validated", () => {
  const v = parseOptions({ url: "example.com", zoom: 5, colorScheme: "sepia", systemScheme: "dark" }).value;
  assert.deepEqual([v.zoom, v.colorScheme, v.systemScheme], [25, "auto", "dark"]);
  assert.equal(parseOptions({ url: "example.com", zoom: 9999 }).value.zoom, 300);
  assert.equal(parseOptions({ url: "example.com", systemScheme: "x" }).value.systemScheme, undefined);
});
