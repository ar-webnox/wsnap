/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Keep the browser + image libs out of the bundle; ship Chromium's binary with the function.
  serverExternalPackages: ["@sparticuz/chromium", "playwright-core", "sharp"],
  outputFileTracingIncludes: {
    "/api/capture": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
  async headers() {
    return [
      // The service worker must never be served stale and may control the whole origin.
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }, { key: "Service-Worker-Allowed", value: "/" }, { key: "Content-Type", value: "application/javascript; charset=utf-8" }] },
      { source: "/manifest.webmanifest", headers: [{ key: "Cache-Control", value: "public, max-age=3600" }] },
      { source: "/icons/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=604800" }] },
    {
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
};
export default nextConfig;
