import type { Device } from "./types";
export interface Preset { label: string; w: number; h: number }
export const PRESETS: Record<Exclude<Device, "custom">, Preset[]> = {
  desktop: [
    { label: "Full HD", w: 1920, h: 1080 }, { label: "HD+", w: 1600, h: 900 },
    { label: "MacBook", w: 1440, h: 900 }, { label: "Laptop", w: 1366, h: 768 },
    { label: "HD", w: 1280, h: 720 },
  ],
  tablet: [
    { label: "iPad", w: 820, h: 1180 }, { label: "iPad Pro 11″", w: 834, h: 1194 },
    { label: "iPad Pro 12.9″", w: 1024, h: 1366 }, { label: "Galaxy Tab", w: 800, h: 1280 },
  ],
  mobile: [
    { label: "iPhone 15 Pro Max", w: 430, h: 932 }, { label: "iPhone 15", w: 393, h: 852 },
    { label: "iPhone SE", w: 375, h: 667 }, { label: "Pixel 8", w: 412, h: 915 },
    { label: "Galaxy S23", w: 360, h: 780 },
  ],
};
