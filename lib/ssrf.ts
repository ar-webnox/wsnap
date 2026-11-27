import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class BlockedHostError extends Error {}

function v4Private(ip: string): boolean {
  const [a, b, c] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||          // CGNAT
    (a === 169 && b === 254) ||                     // link-local + cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224                                        // multicast + reserved
  );
}

function v6Private(raw: string): boolean {
  const ip = raw.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (ip === "::" || ip === "::1") return true;
  const dotted = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return v4Private(dotted[1]);
  const hex = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const x = parseInt(hex[1], 16), y = parseInt(hex[2], 16);
    return v4Private(`${x >> 8}.${x & 255}.${y >> 8}.${y & 255}`);
  }
  return /^(fc|fd|fe[89ab]|ff|2001:0?db8|2002:|64:ff9b|2001:0?:|100:)/.test(ip);
}

export const isPrivateIp = (ip: string) => (isIP(ip) === 6 ? v6Private(ip) : v4Private(ip));
const cache = new Map<string, number>();

/** Throws BlockedHostError if the host is or resolves to, a non-public address. */
export async function assertPublicHost(hostname: string): Promise<void> {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (!h || h === "localhost" || /\.(local|localhost|internal|lan|home|corp|intranet|arpa)$/.test(h))
    throw new BlockedHostError(h);
  const exp = cache.get(h);
  if (exp && exp > Date.now()) return;

  let addrs: string[];
  if (isIP(h)) addrs = [h];
  else {
    try { addrs = (await lookup(h, { all: true })).map((a) => a.address); }
    catch { return; } // unresolvable: the browser will report a DNS error itself
  }
  if (addrs.some(isPrivateIp)) throw new BlockedHostError(h);
  if (cache.size > 500) cache.clear();
  cache.set(h, Date.now() + 60_000);
}
