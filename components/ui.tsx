"use client";
import type { ReactNode } from "react";

export const inputCls =
  "h-11 w-full rounded-lg border border-line bg-panel px-3 text-sm text-fg placeholder:text-muted/70 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:opacity-50";
export const btnPrimary =
  "inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-fg px-5 text-sm font-medium text-bg transition hover:opacity-90 active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50";
export const btnGhost =
  "inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-line bg-panel px-3.5 text-sm font-medium text-fg transition hover:bg-soft active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between text-[13px] font-medium">{label}{hint && <span className="font-normal text-muted">{hint}</span>}</span>
      {children}
    </label>
  );
}

export function Seg<T extends string | number>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; label: string;
  options: { v: T; label: string; icon?: ReactNode }[];
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-soft p-1">
      {options.map((o) => (
        <button key={String(o.v)} type="button" role="radio" aria-checked={value === o.v} onClick={() => onChange(o.v)}
          className={`flex h-9 items-center justify-center gap-1.5 rounded-md text-[13px] font-medium transition ${value === o.v ? "bg-panel text-fg shadow-sm ring-1 ring-line" : "text-muted hover:text-fg"}`}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className="flex min-h-11 w-full items-center justify-between gap-4 text-left">
      <span><span className="block text-[13px] font-medium">{label}</span>{hint && <span className="block text-xs text-muted">{hint}</span>}</span>
      <span className={`relative h-6 w-10 shrink-0 rounded-full transition ${checked ? "bg-accent" : "bg-line"}`}>
        <span className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : ""}`} />
      </span>
    </button>
  );
}
