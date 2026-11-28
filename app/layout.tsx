import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme";
import { Nav, Footer } from "@/components/chrome";
import { PwaRegister } from "@/components/Pwa";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

// iOS launch images (portrait): [pixel width, pixel height, device pixel ratio]
const SPLASH = [[1290, 2796, 3], [1179, 2556, 3], [1284, 2778, 3], [1170, 2532, 3], [1125, 2436, 3], [828, 1792, 2], [750, 1334, 2], [1206, 2622, 3], [1320, 2868, 3], [1668, 2388, 2], [1640, 2360, 2], [2048, 2732, 2], [1488, 2266, 2], [1536, 2048, 2]] as const;

export const metadata: Metadata = {
  title: "WSNAP | Website Screenshot Studio",
  description: "Capture pixel-accurate full-page or viewport screenshots of any public website. Free, private, no sign-up.",
  applicationName: "WSNAP",
  appleWebApp: { capable: true, title: "WSNAP", statusBarStyle: "black", startupImage: SPLASH.map(([w, h, r]) => ({ url: `/splash/splash-${w}x${h}.png`, media: `(device-width: ${w / r}px) and (device-height: ${h / r}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait)` })) },
  formatDetection: { telephone: false },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: [{ color: "#fafafa", media: "(prefers-color-scheme: light)" }, { color: "#09090b", media: "(prefers-color-scheme: dark)" }] };

const themeScript = `(function(){try{var t=localStorage.getItem('wsnap:theme')||'dark';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d)}catch(e){document.documentElement.classList.add('dark')}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} dark`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body className="min-h-dvh antialiased">
        <ThemeProvider>
          <Nav />
          {children}
          <Footer />
          <PwaRegister />
        </ThemeProvider>
      </body>
    </html>
  );
}
