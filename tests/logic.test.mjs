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
