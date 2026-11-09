"use client";

import { invoke } from "@tauri-apps/api/core";
import { covers, pathOf, toWeb } from "@/components/preview/address";
import type { Parts } from "@/components/preview/parts";
import { hostOf } from "@/lib/agent/preview";
import { sleep } from "@/lib/client/utils";

let nextView = 1;

/** How a Preview moves between pages: its own, its address bar's, its keys' and Claude's. */
export function navigation({
  id,
  root,
  sheet,
  proxy,
  browser,
  ownStore,
  signingNow,
  here,
  server,
  missed,
  trail,
  view,
  setPointed,
  setWeb,
  display,
  fail,
  nextLoad,
}: Parts) {
  /**
   * Opens a page, the dev server's or one from the web, in the tab's webview,
   * opened the first time. Its own webview, not a frame in the app's page:
   * what Claude clicks or focuses there never takes the keyboard from the user.
   */
  const go = (url: string) =>
    void (async () => {
      // A webview has one store for its life: a page kept in the other is opened in a new one.
      const s = signingNow.current;
      const own = s && covers(s.site, url) ? s.project : await invoke<boolean>("signin_project", { root, url }).catch(() => false);
      const label = browser.current;
      if (label && ownStore.current === own) {
        setWeb(label);
        return invoke("browser_go", { label, url });
      }
      if (label) void invoke("browser_close", { label });
      const r = sheet.current?.getBoundingClientRect();
      const { scale: zoom } = view.current;
      // Named before it opens: its first load can be heard before the open returns.
      const opened = `browser-${id}-${nextView++}`;
      browser.current = opened;
      ownStore.current = own;
      try {
        await invoke("browser_open", {
          label: opened,
          url,
          x: r?.x ?? 0,
          y: r?.y ?? 0,
          width: r?.width || 1,
          height: r?.height || 1,
          zoom,
          project: own ? root : null,
        });
      } catch (e) {
        if (browser.current === opened) browser.current = null;
        throw e;
      }
      setWeb(opened);
    })().catch(fail);

  /** Opens a page and waits for it: the answer is where it ended up, not where it was asked to go. */
  const arrive = async (open: () => void) => {
    missed.current = null;
    const done = nextLoad();
    open();
    await done;
    if (missed.current) throw new Error(missed.current);
    return `Now at ${display(here.current)}.`;
  };

  /** A path, an address on this machine or the web, a search, or back, forward, reload, hard-reload. */
  const navigate = async (raw: string): Promise<string> => {
    const v = raw.trim();
    const label = browser.current;
    // The page itself loaded again, not opened afresh, so its server is asked
    // whether it changed; a hard reload skips the cache altogether.
    if ((v === "reload" || v === "hard-reload") && label && here.current)
      return arrive(() => void invoke("browser_reload", { label, hard: v === "hard-reload" }).catch(fail));
    if (v === "back" || v === "forward" || v === "reload" || v === "hard-reload") {
      const t = trail.current;
      const at = v === "back" ? t.at - 1 : v === "forward" ? t.at + 1 : t.at;
      const again = v === "reload" || v === "hard-reload";
      const url = again ? here.current : t.list[at];
      if (!url) return `There is no page to go ${v} to.`;
      if (!again) {
        t.at = at;
        t.stepping = true;
      }
      return arrive(() => go(url));
    }
    const host = hostOf(v);
    if (!host && !v.startsWith("/")) return arrive(() => go(toWeb(v)));
    if (host && host !== hostOf(server.current ?? "")) {
      // Another server: this tab follows it (the Preview's proxy effect).
      return arrive(() => setPointed(/^https?:/.test(v) ? v : `http://${v}`));
    }
    // A tab just opened is still opening its proxy.
    for (let i = 0; i < 50 && server.current && !proxy.current; i++) await sleep(100);
    const p = proxy.current;
    if (!p) throw new Error("The preview has no page open yet.");
    const path = host ? pathOf(v) : v.startsWith("/") ? v : `/${v}`;
    return arrive(() => go(`http://localhost:${p.port}${path}`));
  };

  return { go, navigate };
}
