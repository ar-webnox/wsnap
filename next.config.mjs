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
    return [{
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
