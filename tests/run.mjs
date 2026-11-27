// Runs the pure-logic tests with Node's built-in TypeScript stripping (Node >= 22.6). No extra dependencies.
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const out = ".test-build";
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
for (const f of readdirSync("lib").filter((f) => f.endsWith(".ts") && !["capture.ts", "history.ts"].includes(f))) {
  writeFileSync(`${out}/${f}`, readFileSync(`lib/${f}`, "utf8").replace(/from "\.\/(\w+)"/g, 'from "./$1.ts"'));
}
cpSync("tests/logic.test.mjs", `${out}/logic.test.mjs`);
const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "--test", `${out}/logic.test.mjs`], { stdio: "inherit" });
rmSync(out, { recursive: true, force: true });
process.exit(r.status ?? 1);
