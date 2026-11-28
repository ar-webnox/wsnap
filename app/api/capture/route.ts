import { capture, CaptureError } from "@/lib/capture";
import { parseOptions } from "@/lib/validation";
import { assertPublicHost, BlockedHostError } from "@/lib/ssrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel Hobby maximum

let active = 0; // one capture at a time per instance: bounds memory on the 1 GB function

const err = (code: string, message: string, status: number) =>
  Response.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  // Same-origin only: the endpoint is not a public screenshot API for other sites.
  const site = req.headers.get("sec-fetch-site");
  const origin = req.headers.get("origin");
  let crossOrigin = !!site && site !== "same-origin" && site !== "none";
  try { if (origin && new URL(origin).host !== req.headers.get("host")) crossOrigin = true; } catch { crossOrigin = true; }
  if (crossOrigin) return err("INVALID_REQUEST", "Cross-origin requests are not allowed.", 403);
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) return err("INVALID_REQUEST", "Invalid request.", 415);
  let body: unknown;
  try {
    if (Number(req.headers.get("content-length") ?? 0) > 8_192) return err("INVALID_REQUEST", "Request too large.", 413);
    body = await req.json();
  } catch { return err("INVALID_REQUEST", "Invalid request.", 400); }

  const parsed = parseOptions(body);
  if (!parsed.ok) return err("INVALID_URL", parsed.message, 400);
  const opts = parsed.value;

  try { await assertPublicHost(new URL(opts.url).hostname); }
  catch (e) {
    if (e instanceof BlockedHostError) return err("BLOCKED", "This address points to a private or restricted network and can't be captured.", 400);
  }

  if (active >= 1) return err("BUSY", "WSNAP is busy right now. Please try again in a few seconds.", 429);
  active++;
  try {
    const r = await capture(opts, req.signal);
    return new Response(new Uint8Array(r.buffer), {
      headers: {
        "Content-Type": r.contentType,
        "Cache-Control": "no-store",
        "X-Image-Width": String(r.width),
        "X-Image-Height": String(r.height),
        "X-Capture-Ms": String(r.ms),
        "X-Notes": encodeURIComponent(JSON.stringify(r.notes)),
        "X-Final-Url": encodeURIComponent(r.finalUrl.slice(0, 2048)),
        "X-Page-Title": encodeURIComponent(r.title),
        "X-Http-Status": String(r.status),
        "X-Page-Height": String(r.pageHeight ?? ""),
      },
    });
  } catch (e) {
    const ce = e instanceof CaptureError ? e : new CaptureError("UNKNOWN", "The screenshot couldn't be completed.", 500);
    return err(ce.code, ce.message, ce.status);
  } finally { active--; }
}
