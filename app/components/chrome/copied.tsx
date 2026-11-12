"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { signal } from "@/lib/client/signal";

/** The terminal copies on select with no key pressed (components/agent/shell.tsx), so this says it did. */
let shown = 0;
const { subscribe, emit } = signal();

export function showCopied() {
  shown++;
  emit();
}

export function Copied() {
  const n = useSyncExternalStore(subscribe, () => shown, () => 0);
  const [gone, setGone] = useState(0);
  useEffect(() => {
    if (!n) return;
    const t = setTimeout(() => setGone(n), 1800);
    return () => clearTimeout(t);
  }, [n]);
  if (!n || gone === n) return null;
  return (
    <div role="status" className="pointer-events-none fixed inset-x-0 bottom-10 z-50 flex justify-center px-4">
      {/* Keyed by the copy, so a second copy while it shows pops it again. */}
      <div key={n} className="pop flex items-center gap-2.5 rounded-lg bg-accent px-5 py-3 font-mono text-[14px] font-medium text-on-accent">
        <span aria-hidden>✓</span>
        Copied to clipboard
      </div>
    </div>
  );
}
