"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/client/utils";

/**
 * The pieces the app's dialogs share: a dimmed layer over the blueprint that closes
 * on Escape or a click outside (Escape stops here rather than also leaving the
 * level), and the form parts inside one.
 */
export function Overlay({
  onClose,
  dim,
  style,
  children,
}: {
  onClose: () => void;
  /** A darker layer, for a popup that should read as lifted off the blueprint. */
  dim?: boolean;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // A note being written over the dialog (components/review/review-tray.tsx) takes its own Escape.
      if ((e.target as Element | null)?.closest?.("[data-note-editor]")) return;
      // A menu open over the dialog (components/ui/menu.tsx) closes first.
      if (document.querySelector('[role="menu"]')) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div
      className={`fixed inset-0 z-50 flex animate-[scrim-in_.18s_ease-out] items-center justify-center p-6 ${dim ? "bg-night/40" : "bg-night/20"}`}
      style={style}
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      {children}
    </div>
  );
}

export const DIALOG =
  "flex max-h-full w-full animate-[dialog-in_.24s_cubic-bezier(.2,.7,.2,1)] flex-col overflow-hidden rounded-lg border border-border-gray bg-card shadow-lift";

export const INPUT =
  "w-full rounded border border-transparent bg-surface-container px-3 py-2 text-[14px] text-ink transition-colors duration-150 placeholder:text-faint focus:border-accent focus:bg-card focus:outline-none";

/* A dialog's actions, drawn as Button's `primary` and `ghost` (components/ui/button.tsx),
   so a dialog's buttons read as the rest of the app's. */
const ACTION =
  "inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded px-3.5 text-[13px] font-medium transition-[background-color,color,transform] duration-150 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent/70 disabled:cursor-default disabled:opacity-45 disabled:active:scale-100";

export const PRIMARY = `${ACTION} bg-accent text-on-accent hover:bg-accent-strong`;

export const QUIET = `${ACTION} text-on-surface-variant hover:bg-surface-container hover:text-ink`;

/**
 * A labelled setting. One row by default: its name on the left, the control on the
 * right. `stack` for one with a wide control (a field, a list): the name above it.
 * `group` for one that holds buttons rather than a field: a <label> passes a click
 * on its words to the first button inside, so clicking "Theme" would pick Light.
 */
export function Field({ label, hint, group, stack, children }: { label: string; hint?: string; group?: boolean; stack?: boolean; children: React.ReactNode }) {
  const Box = group ? "div" : "label";
  const props = group ? { role: "group", "aria-label": label } : {};
  return stack ? (
    <Box className="block border-b border-border-gray py-3.5 last:border-b-0" {...props}>
      <span className="text-[14px] font-medium text-ink">{label}</span>
      {hint ? <span className="mt-0.5 block text-[12.5px] text-muted-slate">{hint}</span> : null}
      <div className="mt-2.5">{children}</div>
    </Box>
  ) : (
    <Box className="flex min-h-14 flex-wrap items-center justify-between gap-x-5 gap-y-2 border-b border-border-gray py-2 last:border-b-0" {...props}>
      <span className="text-[14px] font-medium text-ink">{label}</span>
      <div className="flex min-w-0 items-center justify-end gap-3">{children}</div>
    </Box>
  );
}

/**
 * A setting's row of choices, the picked one filled with ink, which slides to the
 * next one picked. `null` picks none, while it is unknown.
 */
export function Segmented<T extends string | boolean>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | null;
  options: { value: T; label: React.ReactNode }[];
  onChange: (value: T) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);
  // Slides only once it has been drawn where it is, not from nothing when its row is first shown.
  const [slides, setSlides] = useState(false);
  const placed = useRef(false);
  const at = options.findIndex((o) => o.value === value);
  useLayoutEffect(() => {
    const el = track.current;
    if (!el) return;
    const measure = () => {
      const b = el.querySelectorAll<HTMLElement>('[role="radio"]')[at];
      if (!b || !b.offsetWidth) return setThumb(null);
      setThumb({ left: b.offsetLeft, width: b.offsetWidth });
      if (!placed.current) {
        placed.current = true;
        requestAnimationFrame(() => setSlides(true));
      }
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [at, options.length]);
  return (
    <div ref={track} role="radiogroup" aria-label={label} className="relative inline-flex rounded-[5px] bg-surface-container p-[3px]">
      {thumb ? (
        <span
          aria-hidden
          className={cn("absolute bottom-[3px] left-0 top-[3px] rounded-[3px] bg-accent", slides && "transition-[transform,width] duration-[280ms] ease-[cubic-bezier(.2,.7,.2,1)]")}
          style={{ width: thumb.width, transform: `translateX(${thumb.left}px)` }}
        />
      ) : null}
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "relative z-10 flex cursor-pointer items-center gap-1.5 rounded-[3px] px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-200 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
            value === o.value ? "text-on-accent" : "text-on-surface-variant hover:text-ink",
            value === o.value && !thumb && "bg-accent",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A setting that is on or off, as one thing rather than a choice between two. */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-[42px] shrink-0 cursor-pointer rounded-full transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        checked ? "bg-accent" : "bg-border-strong",
      )}
    >
      <span
        className={cn(
          "absolute left-[3px] top-[3px] size-[18px] rounded-full transition-transform duration-200 ease-[cubic-bezier(.2,.7,.2,1)]",
          checked ? "translate-x-[18px] bg-on-accent" : "bg-card",
        )}
      />
    </button>
  );
}
