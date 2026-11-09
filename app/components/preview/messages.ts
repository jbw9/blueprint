"use client";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { bare } from "@/components/preview/address";
import { DRAIN, type Parts, type Said } from "@/components/preview/parts";
import { isDesktop } from "@/lib/client/platform";

/** Hands what the webview's pages say on loading to `hear`, until the returned call. */
export function listenToPage({ browser, hear, replace, setShown }: Pick<Parts, "browser" | "hear" | "replace" | "setShown">) {
  // Every page of the webview, heard from its first: a load can finish
  // before the webview is shown, or before its open has returned.
  const off = isDesktop()
    ? listen<{ label: string; url: string; done: boolean }>("blueprint:browser", (e) => {
        if (e.payload.label !== browser.current) return;
        replace.current();
        if (!e.payload.done) return setShown(bare(e.payload.url));
        // Where it ended up, before the page's own word on it is next collected.
        hear.current({ type: "location", url: e.payload.url });
        hear.current({ type: "loaded" });
      })
    : undefined;
  return () => void off?.then((f) => f());
}

/** A page keeps what it says until it is collected: collected for `hear`, until the returned call. */
export function collect(hear: Parts["hear"], web: string) {
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    invoke<Said[] | null>("browser_eval", { label: web, js: DRAIN })
      .then((all) => all?.forEach((m) => hear.current(m)))
      .catch(() => {})
      .finally(() => (busy = false));
  }, 120);
  return () => clearInterval(timer);
}
