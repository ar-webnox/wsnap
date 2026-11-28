// Integration tests: drives the REAL capture engine (Playwright + Chromium + sharp) against local pages.
// Needs a Chromium: run `npm run setup:browser` or set CHROME_PATH. Run with: npm run test:engine
import { cpSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { buildEngine, nodeFlags } from "./_build.mjs";
const out = ".test-engine"; buildEngine(out);
cpSync("tests/engine.test.mjs", `${out}/engine.test.mjs`);
const r = spawnSync(process.execPath, [...nodeFlags, `${out}/engine.test.mjs`], { stdio: "inherit" });
rmSync(out, { recursive: true, force: true }); process.exit(r.status ?? 1);
