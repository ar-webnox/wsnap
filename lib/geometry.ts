import { LIMITS } from "./types";

/**
 * Browser zoom is emulated the way Chromium itself implements it: the page lays out in a smaller
 * (or larger) CSS viewport and renders at a proportionally higher (or lower) pixel ratio.
 *   zoom 200%  ->  CSS viewport = width / 2,  pixel ratio = scale x 2
 * Media queries therefore see the zoomed width (real responsive behaviour) and the output stays
 * width x scale pixels. The pixel ratio is solved from the rounded CSS viewport so the output width is exact.
 */
export function zoomGeometry(width: number, height: number, scale: number, zoom: number) {
  const z = Math.min(LIMITS.maxZoom, Math.max(LIMITS.minZoom, zoom)) / 100;
  const vw = Math.max(1, Math.round(width / z));
  const eff = (width * scale) / vw;
  // Round the CSS height UP so the viewport is never shorter than requested; viewport captures are then cropped
  // (lossless) to exactly height x scale device pixels.
  const vh = Math.max(1, Math.ceil((height * scale) / eff - 1e-6));
  return { vw, vh, eff };
}
