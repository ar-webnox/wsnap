// Copies lib/ into a temp dir for Node-based tests. The SSRF host check and port check are stubbed ONLY in that copy
// so the real capture engine can reach a local test server. Production code is never modified.
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, symlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";
export function buildEngine(out) {
  rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
  for (const f of readdirSync("lib").filter((f) => f.endsWith(".ts") && f !== "history.ts")) {
    let src = readFileSync(`lib/${f}`, "utf8").replace(/from "\.\/(\w+)"/g, 'from "./$1.ts"');
    if (f === "ssrf.ts") src = 'export class BlockedHostError extends Error {}\nexport async function assertPublicHost(){}\nexport const isPrivateIp=()=>false;';
    if (f === "capture.ts") src = src.replace(/if \(u\.port && u\.port !== "80"[^\n]*\n/, "");
    writeFileSync(`${out}/${f}`, src);
  }
  const nm = process.env.NODE_MODULES_DIR || (existsSync("node_modules") ? resolve("node_modules") : "/opt/npm-tools/node_modules");
  symlinkSync(nm, `${out}/node_modules`);
  return nm;
}
export const nodeFlags = ["--experimental-transform-types", "--no-warnings", "--test", "--test-concurrency=1"];
