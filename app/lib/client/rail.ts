import { useSyncExternalStore } from "react";
import { signal } from "@/lib/client/signal";
import { RAIL_COLLAPSED, RAIL_EXPANDED } from "@/lib/client/layout";
import { useDesktop } from "@/lib/client/platform";

const KEY = "blueprint.rail.expanded";
let expanded = false;
let loaded = false;
const { subscribe, emit } = signal();

const get = () => {
  if (!loaded && typeof window !== "undefined") {
    loaded = true;
    try {
      expanded = localStorage.getItem(KEY) === "1";
    } catch {
      expanded = false;
    }
  }
  return expanded;
};

/** Whether the project rail shows names beside its icons. Kept between launches. */
export const useRailExpanded = () => useSyncExternalStore(subscribe, get, () => false);

export function toggleRail() {
  expanded = !get();
  try {
    localStorage.setItem(KEY, expanded ? "1" : "0");
  } catch {
    /* not kept: the rail still works this session */
  }
  emit();
}

/** The space the rail takes on the window's left, nothing outside the desktop app. */
export function useRailWidth() {
  const desktop = useDesktop();
  const open = useRailExpanded();
  return desktop ? (open ? RAIL_EXPANDED : RAIL_COLLAPSED) : 0;
}
