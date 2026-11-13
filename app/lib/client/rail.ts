import { useSyncExternalStore } from "react";
import { signal } from "@/lib/client/signal";
import { RAIL_COLLAPSED, RAIL_EXPANDED } from "@/lib/client/layout";
import { useDesktop } from "@/lib/client/platform";

const KEY = "blueprint.rail.expanded";
const WIDTH_KEY = "blueprint.rail.width";
/** How narrow and wide the opened rail may be dragged. */
const MIN = 160;
const MAX = 360;
let expanded = false;
let width = RAIL_EXPANDED;
let loaded = false;
const { subscribe, emit } = signal();

const load = () => {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    expanded = localStorage.getItem(KEY) === "1";
    const w = Number(localStorage.getItem(WIDTH_KEY));
    if (w >= MIN && w <= MAX) width = w;
  } catch {
    expanded = false;
  }
};

const get = () => {
  load();
  return expanded;
};

const getWidth = () => {
  load();
  return width;
};

function keep() {
  try {
    localStorage.setItem(KEY, expanded ? "1" : "0");
    localStorage.setItem(WIDTH_KEY, String(width));
  } catch {
    /* not kept: the rail still works this session */
  }
}

/** Whether the project rail shows names beside its icons. Kept between launches. */
export const useRailExpanded = () => useSyncExternalStore(subscribe, get, () => false);

export function toggleRail() {
  expanded = !get();
  keep();
  emit();
}

/** The space the rail takes on the window's left, nothing outside the desktop app. */
export function useRailWidth() {
  const desktop = useDesktop();
  const open = useRailExpanded();
  const w = useSyncExternalStore(subscribe, getWidth, () => RAIL_EXPANDED);
  return desktop ? (open ? w : RAIL_COLLAPSED) : 0;
}

/**
 * The rail resized by dragging its right edge. Narrower than halfway between
 * folded and the least opened width, it folds; a folded rail dragged out opens.
 * Kept once it is let go.
 */
export function dragRail(e: React.PointerEvent) {
  e.preventDefault();
  load();
  // A preview's frame would take the pointer's moves for its own page.
  document.body.dataset.dragging = "";
  const left = e.currentTarget.parentElement!.getBoundingClientRect().left;
  let frame = 0;
  const move = (m: PointerEvent) => {
    const w = m.clientX - left;
    cancelAnimationFrame(frame);
    // One layout per frame: every move re-laid the whole window out.
    frame = requestAnimationFrame(() => {
      expanded = w >= (RAIL_COLLAPSED + MIN) / 2;
      if (expanded) width = Math.round(Math.max(MIN, Math.min(MAX, w)));
      emit();
    });
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    delete document.body.dataset.dragging;
    // After the last move's frame, so what is kept is what was let go.
    requestAnimationFrame(keep);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}
