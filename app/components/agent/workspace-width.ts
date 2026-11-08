import type { RefObject } from "react";
import { GAP } from "@/lib/client/layout";

const WIDTH_KEY = "blueprint.workspace.width";
const MIN_WIDTH = 380;

export function storedWidth() {
  try {
    const w = Number(localStorage.getItem(WIDTH_KEY));
    if (w >= MIN_WIDTH) return w;
  } catch {
    /* storage blocked: the default is fine */
  }
  // Wide enough for a full Claude Code status line, about 105 columns.
  return 900;
}

/** The window resized by dragging its left edge, `aside`; the width is kept once it is let go. */
export function dragWidth(e: React.PointerEvent, aside: RefObject<HTMLElement | null>, setWidth: (w: number) => void) {
  e.preventDefault();
  // A preview's frame would take the pointer's moves for its own page.
  document.body.dataset.dragging = "";
  const from = e.clientX;
  // What is on screen, which a narrow window may have clamped.
  const start = (e.currentTarget.parentElement as HTMLElement).offsetWidth;
  let last = start;
  const move = (m: PointerEvent) => {
    last = Math.max(MIN_WIDTH, Math.min(window.innerWidth - 2 * GAP, start + from - m.clientX));
    // Straight to the page while dragging: a render of every tab per move made the edge trail the pointer.
    if (aside.current) aside.current.style.width = `min(${last}px, calc(100vw - ${2 * GAP}px))`;
    document.documentElement.style.setProperty("--workspace-inset", `calc(min(${last}px, 100vw - ${2 * GAP}px) + ${2 * GAP}px)`);
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    delete document.body.dataset.dragging;
    setWidth(last);
    try {
      localStorage.setItem(WIDTH_KEY, String(last));
    } catch {
      /* not kept; it still applies until reload */
    }
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}
