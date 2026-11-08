"use client";

import { invoke } from "@tauri-apps/api/core";
import type { Parts } from "@/components/preview/parts";

/**
 * The webview of a page from the web, kept over the viewport: moved with
 * it, and hidden while it is out of sight or anything of the app's is over
 * it, as it would otherwise cover that. Under a menu or a dialog the page
 * stays in sight: a picture of it, given to `onPicture`, takes its place
 * until that closes. Until the returned call.
 */
export function keepOver(
  { sheet, stage, view, replace }: Pick<Parts, "sheet" | "stage" | "view" | "replace">,
  web: string,
  onPicture: (picture: string | null) => void,
) {
  let last = "";
  let frameId = 0;
  let shownNow = false;
  let picture: string | null = null;
  let taking = false;
  let gone = false;
  let clearing = 0;
  const painted = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  const take = async () => {
    taking = true;
    const url = await invoke<string>("browser_picture", { label: web }).catch(() => "");
    if (url) {
      const image = new Image();
      image.src = url;
      await image.decode().catch(() => {});
      if (!gone) onPicture(url);
      await painted();
    }
    taking = false;
    if (!gone) picture = url;
  };
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
    const covered = [...document.querySelectorAll('[role="menu"], [role="dialog"], [role="listbox"]')].some((o) => {
      if (own.contains(o)) return false;
      const b = o.getBoundingClientRect();
      return b.width > 0 && b.right > r.x && b.x < r.right && b.bottom > r.y && b.y < r.bottom;
    });
    if (covered) clearTimeout(clearing);
    if (covered && shownNow && picture === null && !taking) void take();
    const drop = !covered && picture !== null;
    if (drop) picture = null;
    const shown = covered
      ? taking && shownNow
      : r.width > 0 &&
        inside(r.x + r.width / 2, r.y + r.height / 2) &&
        inside(r.x + 4, r.y + 4) &&
        inside(r.right - 4, r.y + 4) &&
        inside(r.x + 4, r.bottom - 4) &&
        inside(r.right - 4, r.bottom - 4);
    shownNow = shown;
    const at = { x: r.x, y: r.y, width: r.width, height: r.height, zoom: view.current.scale, shown };
    const key = JSON.stringify(at);
    if (drop) clearing = window.setTimeout(() => !gone && onPicture(null), 150);
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
    gone = true;
    clearTimeout(clearing);
    onPicture(null);
    cancelAnimationFrame(frameId);
    void invoke("browser_place", { label: web, x: 0, y: 0, width: 1, height: 1, zoom: 1, shown: false }).catch(() => {});
  };
}
