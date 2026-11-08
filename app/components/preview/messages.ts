"use client";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { bare } from "@/components/preview/address";
import { DRAIN, type Parts, type Said } from "@/components/preview/parts";
import { isDesktop } from "@/lib/client/platform";

/** Hands what the frame's page and the webview's pages say to `hear`, until the returned call. */
export function listenToPage({ frame, onWeb, browser, hear, replace, setShown }: Pick<Parts, "frame" | "onWeb" | "browser" | "hear" | "replace" | "setShown">) {
  const on = (e: MessageEvent) => {
    if (!frame.current || e.source !== frame.current.contentWindow || !e.data?.__blueprint) return;
    // Behind a page from the web, the frame's page is not the one in front:
    // where it is, what it logs and that it loaded are not this tab's.
    if (onWeb.current && e.data.type !== "reply") return;
    hear.current(e.data);
  };
  window.addEventListener("message", on);
  // Every page of the webview, heard from its first: a load can finish
  // before the webview is shown, or before its open has returned.
  const off = isDesktop()
    ? listen<{ label: string; url: string; done: boolean }>("blueprint:browser", (e) => {
        if (e.payload.label !== browser.current || !onWeb.current) return;
        replace.current();
        if (!e.payload.done) return setShown(bare(e.payload.url));
        // Where it ended up, before the page's own word on it is next collected.
        hear.current({ type: "location", url: e.payload.url });
        hear.current({ type: "loaded" });
      })
    : undefined;
  return () => {
    window.removeEventListener("message", on);
    void off?.then((f) => f());
  };
}

/** A page from the web keeps what it says until it is collected: collected for `hear`, until the returned call. */
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
