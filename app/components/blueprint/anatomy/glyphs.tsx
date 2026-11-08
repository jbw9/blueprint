"use client";

import { cn } from "@/lib/client/utils";

/**
 * Points right, and turns green when this row's card is open.
 *
 * It does NOT rotate to point down any more. Down means "expands below me",
 * which is what this used to do and is exactly the thing that crushed 700px of
 * flow into a 340px column. The card opens to the RIGHT, so the mark keeps
 * pointing that way and only changes colour.
 */
export function Caret({ open }: { open: boolean }) {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      className={cn(
        "shrink-0 transition-colors duration-200",
        open ? "text-accent" : "text-faint",
      )}
    >
      <path
        d="M4.5 2.5L8 6l-3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function KeyTag({ k, lit }: { k: "PK" | "FK" | "UQ"; lit?: boolean }) {
  return (
    <span
      className={cn(
        "shrink-0 px-1 py-px font-mono text-[8.5px] font-semibold leading-none",
        lit
          ? "bg-card text-accent ring-1 ring-accent/45"
          : k === "PK"
            ? "bg-accent-surface text-accent"
            : "bg-surface-container text-muted-slate",
      )}
    >
      {k}
    </span>
  );
}

const METHOD_TONE: Record<string, string> = {
  GET: "bg-surface-container text-muted-slate",
  POST: "bg-accent-surface text-accent",
  PATCH: "bg-amber-surface text-amber-ink",
  DELETE: "bg-clay-surface text-clay-ink",
};

export function Method({ method }: { method: string }) {
  return (
    <span
      className={cn(
        "w-[42px] shrink-0 px-1 py-px text-center font-mono text-[8.5px] font-semibold leading-[1.4]",
        METHOD_TONE[method],
      )}
    >
      {method}
    </span>
  );
}

export function FileGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M3 1.5h3.5L9 4v6.5H3z"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
        className="text-muted-slate"
      />
      <path d="M6.4 1.6V4.2H9" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" className="text-muted-slate" />
    </svg>
  );
}

export function TableGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <rect x="1" y="1.5" width="10" height="9" rx="1.5" stroke="currentColor" strokeWidth="1" className="text-muted-slate" />
      <path d="M1 4.5h10M4.5 4.5v6" stroke="currentColor" strokeWidth="1" className="text-muted-slate" />
    </svg>
  );
}
