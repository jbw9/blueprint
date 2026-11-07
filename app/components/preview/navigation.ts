"use client";

import { invoke } from "@tauri-apps/api/core";
import { covers, isWeb, pathOf, toWeb } from "@/components/preview/address";
import type { Parts } from "@/components/preview/parts";
import { hostOf } from "@/lib/agent/preview";
import { sleep } from "@/lib/client/utils";

let nextView = 1;

/** How a Preview moves between pages: its own, its address bar's, its keys' and Claude's. */
export function navigation({
  id,
  root,
  frame,
  sheet,
  proxy,
  browser,
  ownStore,
  signingNow,
  onWeb,
  here,
  server,
  missed,
  trail,
  view,
  setPointed,
  setSrc,
  setWeb,
  display,
  fail,
  nextLoad,
}: Parts) {
  /**
   * Opens a page: one from the web in its webview, opened the first time;
   * the dev server's in the frame, without a step in the window's history.
   */
  const go = (url: string) => {
    if (isWeb(url)) {
      onWeb.current = true;
      return void (async () => {
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
        if (onWeb.current) setWeb(opened);
      })().catch(fail);
    }
    onWeb.current = false;
    setWeb(null);
    const w = frame.current?.contentWindow;
    if (w) w.location.replace(url);
    else setSrc(url);
  };

  /** Opens a page and waits for it: the answer is where it ended up, not where it was asked to go. */
  const arrive = async (open: () => void) => {
    missed.current = null;
    const done = nextLoad();
    open();
    await done;
    if (missed.current) throw new Error(missed.current);
    return `Now at ${display(here.current)}.`;
  };

  /** A path, an address on this machine or the web, a search, or back, forward, reload. */
  const navigate = async (raw: string): Promise<string> => {
    const v = raw.trim();
    if (v === "back" || v === "forward" || v === "reload") {
      const t = trail.current;
      const at = v === "back" ? t.at - 1 : v === "forward" ? t.at + 1 : t.at;
      const url = v === "reload" ? here.current : t.list[at];
      if (!url) return `There is no page to go ${v} to.`;
      if (v !== "reload") {
        t.at = at;
        t.stepping = true;
      }
      return arrive(() => go(url));
    }
    const host = hostOf(v);
    if (!host && !v.startsWith("/")) return arrive(() => go(toWeb(v)));
    if (host && host !== hostOf(server.current ?? "")) {
      // Another server: this tab follows it (the Preview's proxy effect), in front of any page from the web.
      return arrive(() => {
        onWeb.current = false;
        setWeb(null);
        setPointed(/^https?:/.test(v) ? v : `http://${v}`);
      });
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
