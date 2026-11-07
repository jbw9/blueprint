"use client";

import { cn } from "@/lib/client/utils";

/** An edge of the viewport to drag, with a grip that shows on hover. */
export function Handle({
  label,
  cursor,
  style,
  bar,
  onPointerDown,
}: {
  label: string;
  cursor: string;
  style: React.CSSProperties;
  bar?: string;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  return (
    <div
      role="separator"
      aria-label={label}
      onPointerDown={onPointerDown}
      style={style}
      className={cn("group absolute z-10 flex items-center justify-center", cursor)}
    >
      {bar ? <span className={cn("rounded-full bg-border-strong opacity-0 transition-opacity group-hover:opacity-100", bar)} /> : null}
    </div>
  );
}
