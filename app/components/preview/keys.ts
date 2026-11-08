"use client";

// Real input is AppKit's (src-tauri/src/browser.rs).
export const REAL = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

/**
 * The Previews on screen, by tab, for a browser's keys: Cmd+R, Cmd+[, Cmd+]
 * and Cmd+L from the menu bar on a Mac (src-tauri/src/lib.rs), Ctrl+R and
 * Ctrl+L elsewhere. A key pressed in a page stays in its webview or frame,
 * so the Preview last clicked or focused is remembered here.
 */
export const onScreen = new Map<number, { el: HTMLElement; key: (k: string) => void }>();
export let touched: number | null = null;

/** Remembered from a Preview itself: an import cannot be assigned to. */
export const touch = (id: number) => {
  touched = id;
};

/** The Preview the keyboard is in; none while it is in a terminal or the bluprint. */
export const focused = () => (touched !== null && onScreen.has(touched) ? touched : null);

if (typeof window !== "undefined") {
  // Whatever of the app's page was last clicked or focused; a page's own
  // webview or frame says so itself (agent.js).
  const into = (e: Event) => {
    touched = [...onScreen].find(([, p]) => p.el.contains(e.target as Node))?.[0] ?? null;
  };
  window.addEventListener("pointerdown", into, true);
  window.addEventListener("focusin", into, true);
  // Off a Mac there is no menu bar to take the keys first, and the browser's
  // own Ctrl+R would reload the whole app, losing every tab.
  if (!REAL)
    window.addEventListener(
      "keydown",
      (e) => {
        if (!e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || (e.code !== "KeyR" && e.code !== "KeyL")) return;
        // A terminal's Ctrl+R is its shell's history search, and Ctrl+L its clear: its own to take.
        if ((e.target as Element | null)?.closest?.(".xterm")) return;
        const at = focused();
        if (at === null) {
          if (e.code === "KeyR") e.preventDefault();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        onScreen.get(at)?.key(e.code === "KeyR" ? "reload" : "address");
      },
      true,
    );
}
