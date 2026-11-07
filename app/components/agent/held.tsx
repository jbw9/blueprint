"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * A tab's body, drawn into one element for the tab's life and moved, never
 * drawn again, between the window and the main view: a terminal drawn again
 * would be a new shell.
 */
export function Held({ slot, children }: { slot: HTMLElement | null; children: React.ReactNode }) {
  const [box] = useState(() => {
    if (typeof document === "undefined") return null;
    // No box of its own: the body is laid out in the slot, and a hidden tab's
    // holder never lies over the one in view.
    const el = document.createElement("div");
    el.style.display = "contents";
    return el;
  });
  useLayoutEffect(() => {
    if (box && slot && box.parentElement !== slot) slot.appendChild(box);
  }, [box, slot]);
  useEffect(() => () => box?.remove(), [box]);
  return box ? createPortal(children, box) : null;
}
