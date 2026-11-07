"use client";

import { invoke } from "@tauri-apps/api/core";
import type { Parts } from "@/components/preview/parts";

/**
 * The webview of a page from the web, kept over the viewport: moved with
 * it, and hidden while it is out of sight or anything of the app's (a menu,
 * a dialog) is over it, as it would otherwise cover that. Until the returned call.
 */
export function keepOver({ sheet, stage, view, replace }: Pick<Parts, "sheet" | "stage" | "view" | "replace">, web: string) {
  let last = "";
  let frameId = 0;
  const place = () => {
    const el = sheet.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // The viewport's own resize edges lie over the page's sides when it
    // fills the tab: they are the preview's, not something over it.
    const own = stage.current ?? el;
    const inside = (x: number, y: number) => {
      const top = document.elementFromPoint(x, y);
      return !!top && own.contains(top);
    };
    const shown =
      r.width > 0 &&
      inside(r.x + r.width / 2, r.y + r.height / 2) &&
      inside(r.x + 4, r.y + 4) &&
      inside(r.right - 4, r.y + 4) &&
      inside(r.x + 4, r.bottom - 4) &&
      inside(r.right - 4, r.bottom - 4);
    const at = { x: r.x, y: r.y, width: r.width, height: r.height, zoom: view.current.scale, shown };
    const key = JSON.stringify(at);
    if (key === last) return;
    last = key;
    void invoke("browser_place", { label: web, ...at }).catch(() => {});
  };
  const loop = () => {
    frameId = requestAnimationFrame(loop);
    place();
  };
  // WebKit sets the zoom back to 1 for each new page: given again.
  replace.current = () => {
    last = "";
    place();
  };
  loop();
  return () => {
    cancelAnimationFrame(frameId);
    void invoke("browser_place", { label: web, x: 0, y: 0, width: 1, height: 1, zoom: 1, shown: false }).catch(() => {});
  };
}
