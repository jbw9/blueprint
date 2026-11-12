"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

/**
 * Sizing the open level's diagrams: pinch, ⌘/Ctrl-scroll, or ⌘ +/−/0.
 *
 * Only the pictures change size; the prose around them keeps its own. A big
 * diagram drawn to fill the page is too close to be read whole, and
 * magnifying everything would only push the text off the side with it. The
 * scale is a CSS variable (`--dg-zoom`) each diagram multiplies its width by
 * (components/blueprint/blocks.tsx), so a pinch re-renders nothing.
 */

const MIN = 0.3;
const MAX = 3;
const STEPS = [0.3, 0.4, 0.5, 0.6, 0.75, 0.9, 1, 1.25, 1.5, 2, 2.5, 3];

/** A pinch the desktop shell took from WebKitGTK (src-tauri/src/lib.rs). */
const PINCH = "blueprint:pinch";

export function Zoom({ scrollRef, children }: { scrollRef: RefObject<HTMLElement | null>; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const now = useRef(1);
  const [zoom, setZoom] = useState(1);

  // Applied straight to the DOM, not through a render: a pinch delivers
  // several events a frame. Only the pill re-renders — `children` are the
  // same elements, so the level itself does not.
  const zoomTo = useRef((next: number) => {
    const box = ref.current;
    if (!box) return;
    const z = Math.min(MAX, Math.max(MIN, next));
    if (Math.abs(z - now.current) < 0.001) return;
    now.current = z;
    box.style.setProperty("--dg-zoom", String(z));
    setZoom(z);
  }).current;

  const step = (dir: 1 | -1) =>
    zoomTo(
      dir > 0
        ? (STEPS.find((s) => s > now.current + 0.01) ?? MAX)
        : ([...STEPS].reverse().find((s) => s < now.current - 0.01) ?? MIN),
    );

  useEffect(() => {
    const pane = scrollRef.current;
    const box = ref.current;
    if (!pane || !box) return;

    // Chrome reports a trackpad pinch as a ctrl-wheel; WebKit (the desktop
    // app) as gesture events, and may send both — so a wheel during a gesture
    // is the same pinch twice.
    let pinching = false;
    let from = 1;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey) || pinching) return;
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomTo(now.current * Math.exp(-Math.max(-25, Math.min(25, dy)) * 0.01));
    };
    type Gesture = Event & { scale: number };
    const onStart = (e: Event) => {
      e.preventDefault();
      pinching = true;
      from = now.current;
    };
    const onChange = (e: Event) => {
      e.preventDefault();
      zoomTo(from * (e as Gesture).scale);
    };
    const onEnd = (e: Event) => {
      e.preventDefault();
      pinching = false;
    };
    // WebKitGTK (the desktop app on Linux) sends neither, and would magnify
    // the whole window instead; the shell takes the pinch and passes on its
    // scale since the pinch began (src-tauri/src/lib.rs). A new one starts at 1.
    let last = 1;
    const onPinch = (e: Event) => {
      const { scale } = (e as CustomEvent<{ scale: number }>).detail;
      if (scale === 1) last = 1;
      zoomTo(now.current * (scale / last));
      last = scale;
    };

    const onKey = (e: KeyboardEvent) => {
      const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? e.metaKey : e.ctrlKey;
      if (!mod || e.altKey) return;
      // The terminal has its own font zoom on the same keys.
      if ((e.target as Element | null)?.closest?.(".xterm, input, textarea, [contenteditable]")) return;
      if (e.code === "Equal" || e.code === "NumpadAdd") step(1);
      else if (e.code === "Minus" || e.code === "NumpadSubtract") step(-1);
      else if (e.code === "Digit0" || e.code === "Numpad0") zoomTo(1);
      else return;
      e.preventDefault();
    };

    pane.addEventListener("wheel", onWheel, { passive: false });
    pane.addEventListener("gesturestart", onStart);
    pane.addEventListener("gesturechange", onChange);
    pane.addEventListener("gestureend", onEnd);
    window.addEventListener(PINCH, onPinch);
    window.addEventListener("keydown", onKey);
    return () => {
      pane.removeEventListener("wheel", onWheel);
      pane.removeEventListener("gesturestart", onStart);
      pane.removeEventListener("gesturechange", onChange);
      pane.removeEventListener("gestureend", onEnd);
      window.removeEventListener(PINCH, onPinch);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRef]);

  return (
    <>
      <div ref={ref}>{children}</div>
      {zoom === 1 ? null : (
        <div className="fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center overflow-hidden rounded-lg border border-border-gray bg-card text-[12.5px] text-ink shadow-lift">
          <button
            type="button"
            aria-label="Zoom diagrams out"
            onClick={() => step(-1)}
            className="cursor-pointer px-3 py-1 hover:bg-surface-container"
          >
            −
          </button>
          <button
            type="button"
            title="Back to 100% (⌘0)"
            onClick={() => zoomTo(1)}
            className="tnum min-w-[52px] cursor-pointer py-1 text-center hover:bg-surface-container"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            aria-label="Zoom diagrams in"
            onClick={() => step(1)}
            className="cursor-pointer px-3 py-1 hover:bg-surface-container"
          >
            +
          </button>
        </div>
      )}
    </>
  );
}
