"use client";

import type { Size } from "@/components/preview/viewport";
import { PRESETS } from "@/lib/agent/preview";
import { cn } from "@/lib/client/utils";

/** The toolbar's device toggles: the whole tab, then presets (lib/agent/preview.ts). */
const DEVICES = [
  { id: "fill", label: "Fill the tab", icon: <path d="M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3" /> },
  { id: "mobile", label: "Phone", icon: <><rect x="4.5" y="1.5" width="7" height="13" rx="1.5" /><path d="M7.2 12.2h1.6" /></> },
  { id: "tablet", label: "Tablet", icon: <><rect x="2.5" y="1.5" width="11" height="13" rx="1.5" /><path d="M7.2 12.2h1.6" /></> },
  { id: "desktop", label: "Desktop", icon: <><rect x="1.5" y="2.5" width="13" height="8.5" rx="1" /><path d="M5.5 13.5h5M8 11v2.5" /></> },
];

/** The sizes a page is most often checked at, a click apart, as in Chrome's device toolbar. */
export function Devices({ size, fill, resize }: { size: Size | null; fill: boolean; resize: (next: Size | null) => void }) {
  return (
    <div role="group" aria-label="Device" className="mr-1 flex shrink-0 items-center bg-surface-container p-0.5">
      {DEVICES.map((d) => {
        const p = PRESETS.find((x) => x.id === d.id);
        const on = p ? !!size && ((size.w === p.w && size.h === p.h) || (size.w === p.h && size.h === p.w)) : fill;
        return (
          <button
            key={d.id}
            type="button"
            aria-pressed={on}
            title={p ? `${d.label} · ${p.w} × ${p.h}` : d.label}
            onClick={() => resize(p ? { w: p.w, h: p.h } : null)}
            className={cn(
              "flex h-5 w-6 cursor-pointer items-center justify-center",
              on ? "bg-card text-ink shadow-[0_0_0_1px_var(--color-border-gray)]" : "text-muted-slate hover:text-ink",
            )}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {d.icon}
            </svg>
          </button>
        );
      })}
    </div>
  );
}
