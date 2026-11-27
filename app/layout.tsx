import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme";
import { Nav, Footer } from "@/components/chrome";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "WSNAP | Website Screenshot Studio",
  description: "Capture pixel-accurate full-page or viewport screenshots of any public website. Free, private, no sign-up.",
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
        </ThemeProvider>
      </body>
    </html>
  );
}
