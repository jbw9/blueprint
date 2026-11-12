"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { signal } from "@/lib/client/signal";

/**
 * Where the blueprint's tabs are drawn: the top row of the window, beside
 * the title bar's tools (components/chrome/titlebar.tsx). The strips are made
 * where their state lives, the blueprint's own (components/chrome/tabs.tsx) and the
 * main view's (components/agent/workspace.tsx), and `InTabSlot` puts them here.
 * With no slot (a browser, the page before the title bar has mounted) a strip is
 * drawn where it is made.
 */
let slot: HTMLElement | null = null;
const { subscribe, emit } = signal();

export function setTabSlot(el: HTMLElement | null) {
  if (slot === el) return;
  slot = el;
  emit();
}

const useTabSlot = () => useSyncExternalStore(subscribe, () => slot, () => null);

/** Whether a node is inside the slot, as a key pressed on a tab is. */
export const inTabSlot = (node: Node) => slot?.contains(node) ?? false;

export function InTabSlot({ children }: { children: ReactNode }) {
  const el = useTabSlot();
  return el ? createPortal(children, el) : <>{children}</>;
}

/** The main view's strip is showing, and so is the only one in the slot. */
let mainStrip = false;
const mainWatch = signal();

export function setMainStrip(shown: boolean) {
  if (mainStrip === shown) return;
  mainStrip = shown;
  mainWatch.emit();
}

export const useMainStrip = () => useSyncExternalStore(mainWatch.subscribe, () => mainStrip, () => false);
