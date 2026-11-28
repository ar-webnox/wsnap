import type { MetadataRoute } from "next";

// Served at /manifest.webmanifest and linked automatically by Next.js.
export default function manifest(): MetadataRoute.Manifest {
  const any = [72, 96, 128, 144, 152, 192, 384, 512].map((n) => ({ src: `/icons/icon-${n}.png`, sizes: `${n}x${n}`, type: "image/png", purpose: "any" as const }));
  return {
    id: "/",
    name: "WSNAP",
    short_name: "WSNAP",
    description: "Capture pixel-accurate full-page or viewport screenshots of any public website. Free, private, no sign-up.",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#09090b",
    theme_color: "#09090b",
    lang: "en",
    dir: "ltr",
    categories: ["productivity", "utilities", "developer"],
    prefer_related_applications: false,
    icons: [
      ...any,
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
    shortcuts: [
      { name: "New screenshot", short_name: "Capture", description: "Jump straight to the capture studio", url: "/?source=shortcut#studio", icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "Recent captures", short_name: "Recent", description: "Open your saved captures", url: "/?source=shortcut#recent", icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] },
    ],
    screenshots: [
      { src: "/screenshots/wide.png", sizes: "1280x720", type: "image/png", form_factor: "wide", label: "WSNAP capture studio on desktop" },
      { src: "/screenshots/narrow.png", sizes: "780x1688", type: "image/png", form_factor: "narrow", label: "WSNAP capture studio on mobile" },
    ],
  };
}
