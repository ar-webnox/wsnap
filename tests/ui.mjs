// UI tests: bundles the real <Studio/> (+ nav, theme) with esbuild, compiles the app's real Tailwind CSS and drives it in Chromium.
// Only the HTTP boundary (/api/capture) is intercepted: either mocked or forwarded to the REAL capture engine.
// Run with: npm run test:ui   (needs Chromium: `npm run setup:browser` or CHROME_PATH)
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { buildEngine, nodeFlags } from "./_build.mjs";
const out = ".test-ui"; const nm = buildEngine(`${out}/engine`);
const esbuild = await import(pathToFileURL(`${nm}/esbuild/lib/main.js`));
const tw = await import(pathToFileURL(`${nm}/tailwindcss/dist/lib.mjs`));

writeFileSync(`${out}/entry.tsx`, `import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@/components/theme"; import { Nav, Footer } from "@/components/chrome"; import Studio from "@/components/Studio";
createRoot(document.getElementById("root")!).render(<ThemeProvider><Nav /><Studio /><Footer /></ThemeProvider>);`);
await esbuild.build({
  entryPoints: [`${out}/entry.tsx`], outfile: `${out}/app.js`, bundle: true, jsx: "automatic", minify: true, nodePaths: [nm],
  define: { "process.env.NODE_ENV": '"production"' }, tsconfig: "tsconfig.json", logLevel: "error",
  plugins: [{ name: "stub-lucide", setup(b) {
    b.onResolve({ filter: /^lucide-react$/ }, () => ({ path: "lucide", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ loader: "js", contents: `import {createElement as h} from "react"; const mk=(n)=>(p)=>h("svg",{...p,"data-icon":n,width:16,height:16}); export const ${["AlertTriangle","Bookmark","Camera","Globe","Layers","Loader2","Monitor","RotateCcw","Smartphone","Tablet","Upload","X","Check","Columns2","Pencil","Trash2","Copy","Download","Expand","Maximize2","Minimize2","RefreshCw","ZoomIn","ZoomOut","Moon","Settings","Sun"].map((n) => `${n}=mk("${n}")`).join(",")};`, resolveDir: "." }));
  } }],
});
// Real Tailwind CSS from the app's own stylesheet + every class token in the sources.
const files = ["app/layout.tsx", "components/Studio.tsx", "components/Preview.tsx", "components/History.tsx", "components/ui.tsx", "components/chrome.tsx"];
const cand = new Set(); for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(/[^\s"'`<>={}]+/g)) cand.add(m[0]);
const twdir = `${nm}/tailwindcss`;
const compiler = await tw.compile(readFileSync("app/globals.css", "utf8"), { base: process.cwd(), loadStylesheet: async (id) => {
  if (id !== "tailwindcss") throw new Error("unexpected import " + id);
  return { path: `${twdir}/index.css`, base: twdir, content: readFileSync(`${twdir}/index.css`, "utf8") }; } });
writeFileSync(`${out}/app.css`, compiler.build([...cand]));
const themeScript = readFileSync("app/layout.tsx", "utf8").match(/const themeScript = `([^`]*)`/)[1];
writeFileSync(`${out}/index.html`, `<!doctype html><html lang="en" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>t</title><link rel="stylesheet" href="/app.css"><script>${themeScript}</script></head><body class="min-h-dvh antialiased"><div id="root"></div><script src="/app.js"></script></body></html>`);
cpSync("tests/ui.test.mjs", `${out}/engine/ui.test.mjs`);
const r = spawnSync(process.execPath, [...nodeFlags, `${out}/engine/ui.test.mjs`], { stdio: "inherit", env: { ...process.env, UI_DIR: process.cwd() + "/" + out } });
if (!process.env.KEEP_TEST_UI) rmSync(out, { recursive: true, force: true });
process.exit(r.status ?? 1);
