"use client";

import { cn } from "@/lib/client/utils";

export function Tool({ label, onClick, disabled, on, children }: { label: string; onClick: () => void; disabled?: boolean; on?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={on}
      title={label}
      className={cn(
        "flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-[background-color,color,transform] duration-150 hover:bg-surface-container hover:text-ink active:scale-90 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent",
        on ? "bg-claude/12 text-claude-ink" : "text-muted-slate",
      )}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  );
}
