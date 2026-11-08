"use client";

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { covers, isWeb, originOf, SHARED, siteOf, toWeb } from "@/components/preview/address";
import { REAL } from "@/components/preview/keys";
import { DRAIN, type Parts, type Said } from "@/components/preview/parts";
import { clamp } from "@/components/preview/viewport";
import { PRESETS, type Call } from "@/lib/agent/preview";
import { sleep } from "@/lib/client/utils";

type Act = { kind: "move" | "down" | "up" | "drag" | "key" | "text"; x?: number; y?: number; button?: number; clicks?: number; text?: string };

/** Where the agent found a click's target (agent.js `locate`). */
type Located = { x: number; y: number; what: string; native: { kind: "select" | "file" | "color"; ref: string; options?: string } | null };

let nextCall = 1;

/** A call to the agent in the page, answered by its reply as the Preview hears it. */
export const agent = (
  { frame, proxy, onWeb, browser, pending }: Pick<Parts, "frame" | "proxy" | "onWeb" | "browser" | "pending">,
  name: string,
  args: Record<string, unknown>,
) =>
  new Promise<unknown>((resolve, reject) => {
    const w = frame.current?.contentWindow;
    const p = proxy.current;
    const label = onWeb.current ? browser.current : null;
    if (!label && (!w || !p)) return reject(new Error("The preview has no page open yet."));
    const id = nextCall++;
    pending.current.set(id, { resolve, reject });
    if (label)
      void invoke<boolean>("browser_eval", { label, js: `window.__blueprint ? (window.__blueprint.run(${id}, ${JSON.stringify(name)}, ${JSON.stringify(args)}), true) : false` })
        .then((ok) => {
          if (!ok && pending.current.delete(id)) reject(new Error("This page cannot be read or used yet: it may still be loading."));
        })
        .catch((e) => pending.current.delete(id) && reject(new Error(String(e))));
    else w!.postMessage({ __blueprintCmd: true, id, name, args }, `http://localhost:${p!.port}`);
    const wait = args.action === "wait" ? 15000 : 10000;
    setTimeout(() => {
      if (pending.current.delete(id))
        reject(new Error("The page did not answer. It may still be loading: take a screenshot, or try again."));
    }, wait);
  });

/** Claude's browser tools on a Preview, and the sign-in it asks the user for. */
export function tools({
  root,
  frame,
  stage,
  sheet,
  sizeBadge,
  proxy,
  browser,
  signingNow,
  signedIn,
  onWeb,
  here,
  server,
  log,
  dialogs,
  everLoaded,
  view,
  hear,
  setBadge,
  setSigning,
  display,
  go,
  nextLoad,
  navigate,
  agent,
  resize,
}: Parts) {
  /**
   * Whether real input can reach the page: always for a page from the web,
   * which has its own webview; for the frame, only while it is on screen and
   * nothing is over it, since the input lands at that point of the window.
   */
  const reachable = () => {
    if (!REAL) return false;
    if (onWeb.current) return !!browser.current;
    const el = frame.current;
    const r = el?.getBoundingClientRect();
    if (!el || !r || r.width < 2) return false;
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return top === el;
  };

  /**
   * Mouse and key events at CSS pixels of the page, as points in its webview.
   * Whether the window was active, as a hover needs it to be.
   */
  const real = async (acts: Act[]) => {
    const label = onWeb.current ? browser.current : null;
    const { scale: k } = view.current;
    const r = frame.current?.getBoundingClientRect();
    const ox = label ? 0 : (r?.x ?? 0);
    const oy = label ? 0 : (r?.y ?? 0);
    // Only when the keyboard is elsewhere in the app: focusing the frame's
    // window takes it from a frame inside the page that a click just gave it to.
    if (!label && document.activeElement !== frame.current) frame.current?.contentWindow?.focus();
    return invoke<boolean>("native_input", {
      view: label,
      acts: acts.map((a) => (a.x === undefined ? a : { ...a, x: ox + a.x * k, y: oy + (a.y ?? 0) * k })),
    });
  };

  /** One of Claude's `computer` actions done with real input, or null to leave it to the agent. */
  const act = async (a: Record<string, unknown>): Promise<string | null> => {
    const action = a.action as string;
    const clicks = { left_click: 1, right_click: 1, double_click: 2, triple_click: 3 } as Record<string, number>;
    if (clicks[action]) {
      const { x, y, what, native } = (await agent("locate", a)) as Located;
      // Its menu, file picker or color panel would open on the user's screen,
      // out of Claude's sight and reach, and stay there.
      if (native?.kind === "select")
        return `${what} is a dropdown, whose menu is the system's: it was not opened. Choose an option with form_input on ${native.ref}. Options: ${native.options}.`;
      if (native?.kind === "file")
        return `${what} opens the system's file picker, which you cannot use, so it was not opened. Files cannot be chosen from these tools.`;
      if (native?.kind === "color")
        return `${what} opens the system's color panel, which you cannot use, so it was not opened. Set a color with form_input on ${native.ref}, as #rrggbb.`;
      const button = action === "right_click" ? 2 : 0;
      const acts: Act[] = [{ kind: "move", x, y }];
      for (let n = 1; n <= clicks[action]; n++) acts.push({ kind: "down", x, y, button, clicks: n }, { kind: "up", x, y, button, clicks: n });
      await real(acts);
      void agent("press", { x, y }).catch(() => {});
      await sleep(250);
      const done = `Clicked ${what} at (${Math.round(x)}, ${Math.round(y)}).`;
      if (button === 2 && !(await agent("menu", {}).catch(() => true)))
        return `${done} The page has no menu of its own there; the browser's was kept closed.`;
      return done;
    }
    if (action === "hover") {
      const { x, y, what } = (await agent("locate", a)) as Located;
      // WebKit hit-tests a move only in the active window: with the app in
      // the back, the agent's events at least reach the page's own listeners.
      if (!(await real([{ kind: "move", x, y }])))
        return `${await agent("computer", a)} The app is behind other windows, so this reached the page's mouse listeners but not its :hover styles.`;
      await sleep(150);
      return `Hovering ${what}.`;
    }
    if (action === "left_click_drag") {
      const [x0, y0] = (a.start_coordinate as number[]) ?? [];
      const [x1, y1] = (a.coordinate as number[]) ?? [];
      if ([x0, y0, x1, y1].some((n) => typeof n !== "number")) throw new Error("A drag needs start_coordinate and coordinate.");
      // AppKit's drag session follows the real mouse, never these events: the agent drags instead.
      if (await agent("draggable", { x: x0, y: y0 })) return null;
      await agent("glide", { x: x0, y: y0 });
      await real([{ kind: "move", x: x0, y: y0 }, { kind: "down", x: x0, y: y0 }]);
      void agent("glide", { x: x1, y: y1 }).catch(() => {});
      const steps: Act[] = [];
      for (let i = 1; i <= 12; i++) steps.push({ kind: "drag", x: x0 + ((x1 - x0) * i) / 12, y: y0 + ((y1 - y0) * i) / 12 });
      for (const step of steps) {
        await real([step]);
        await sleep(25);
      }
      await real([{ kind: "up", x: x1, y: y1 }]);
      await sleep(200);
      return `Dragged from (${x0}, ${y0}) to (${x1}, ${y1}).`;
    }
    if (action === "type") {
      const into = (await agent("focused", {})) as string | null;
      if (!into) throw new Error("Nothing has focus to type into: click a field first.");
      await real([{ kind: "text", text: String(a.text ?? "") }]);
      await sleep(150);
      return `Typed into ${into}.`;
    }
    if (action === "key") {
      const text = String(a.text ?? "").trim();
      // Puts back the field the page dropped while hidden; a password field still takes Enter.
      await agent("focused", {}).catch(() => {});
      // One at a time: the page takes keys in turn, but an edit (cmd+v) at once.
      for (const k of text.split(/\s+/)) {
        await real([{ kind: "key", text: k }]);
        await sleep(60);
      }
      await sleep(140);
      return `Pressed ${text}.`;
    }
    return null;
  };

  /** Where a sign-in is kept, changed while the user is signing in: the page reopens in that store. */
  const keepIn = (project: boolean) => {
    const s = signingNow.current;
    if (!s || s.project === project) return;
    signingNow.current = { ...s, project };
    setSigning(signingNow.current);
    go(isWeb(here.current) && covers(s.site, here.current) ? here.current : `https://${s.site}`);
  };

  /** Claude's `sign_in`: the page opened, and the user asked to sign in on it themselves. */
  const signIn = async (raw: string): Promise<string> => {
    const url = toWeb(raw.trim());
    const site = siteOf(url);
    if (!site) throw new Error(`Not an address: ${raw}`);
    if (signedIn.current) throw new Error(`The user is already being asked to sign in to ${signingNow.current?.site}.`);
    signingNow.current = { site, project: !SHARED.test(site) };
    setSigning(signingNow.current);
    const done = new Promise<boolean>((r) => (signedIn.current = r));
    go(url);
    const ok = await done;
    const kept = signingNow.current;
    signedIn.current = null;
    signingNow.current = null;
    setSigning(null);
    if (!ok) return `The user did not sign in to ${site}.`;
    await invoke("signin_keep", { root, site, project: kept.project });
    return `The user signed in to ${site}, kept for ${kept.project ? "this project only" : "all projects"}. The preview is at ${display(here.current)}.`;
  };

  // Claude's calls (src-tauri/src/mcp.rs), by way of the workspace.
  const run = async (call: Call): Promise<unknown> => {
    if (!everLoaded.current && call.op !== "navigate" && call.op !== "sign_in") await nextLoad();
    switch (call.op) {
      case "frame": {
        // Drawn first: the tab may have just come to the front.
        await Promise.race([
          new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
          new Promise((r) => setTimeout(r, 200)),
        ]);
        // Claude's pointer is not part of the page, nor is the size over it:
        // gone at once, not faded out after the picture is taken.
        sizeBadge.current?.style.setProperty("display", "none");
        setBadge(false);
        await agent("veil", {}).catch(() => {});
        const label = onWeb.current ? browser.current : null;
        const r = (label ? sheet.current : frame.current)?.getBoundingClientRect();
        if (!r || (!label && !proxy.current)) throw new Error("The preview has no page open yet.");
        // Whole pixels inside the frame, so no edge of what surrounds it is caught.
        const x = Math.ceil(r.x);
        const y = Math.ceil(r.y);
        return {
          x,
          y,
          width: Math.floor(r.right) - x,
          height: Math.floor(r.bottom) - y,
          viewportWidth: view.current.vw,
          viewportHeight: view.current.vh,
          dpr: window.devicePixelRatio || 1,
          url: display(here.current),
          view: label,
        };
      }
      case "agent": {
        if (signingNow.current)
          throw new Error(`The user is signing in to ${signingNow.current.site} in the preview. Wait for sign_in to return before using the page.`);
        dialogs.current = [];
        // Real input takes the keyboard: where the user was typing elsewhere in the
        // app, a Claude prompt, it is handed back, so their keys never land in the page.
        const theirs = document.hasFocus() ? document.activeElement : null;
        const handBack = theirs instanceof HTMLElement && theirs !== document.body && !stage.current?.contains(theirs);
        let said: string | null;
        try {
          said = call.name === "computer" && reachable() ? await act(call.args) : null;
        } finally {
          if (handBack && theirs.isConnected) {
            if (onWeb.current) await getCurrentWebview().setFocus().catch(() => {});
            theirs.focus({ preventScroll: true });
          }
        }
        if (said === null) said = (await agent(call.name, call.args)) as string;
        // A page from the web is heard by polling: heard once more, so a dialog the action set off is in its answer.
        if (onWeb.current && browser.current)
          (await invoke<Said[] | null>("browser_eval", { label: browser.current, js: DRAIN }).catch(() => null))?.forEach((m) => hear.current(m));
        if (dialogs.current.length) said += ` The page showed a dialog, answered OK: ${dialogs.current.join("; ")}.`;
        // The page knows itself by the proxy's address; Claude knows the dev server's.
        const p = proxy.current;
        return typeof said === "string" && p && server.current
          ? said.replaceAll(`http://localhost:${p.port}`, originOf(server.current))
          : said;
      }
      case "navigate":
        return navigate(call.url);
      case "sign_in":
        return signIn(call.url);
      case "resize": {
        const { width, height, preset } = call.args;
        if (preset === "fill") {
          resize(null);
          return "The viewport fills the tab again.";
        }
        const p = PRESETS.find((x) => x.id === preset);
        const w = clamp(p?.w ?? width ?? view.current.vw);
        const h = clamp(p?.h ?? height ?? view.current.vh);
        resize({ w, h });
        return `The viewport is now ${w}×${h}.`;
      }
      case "console": {
        const { pattern, only_errors, clear, limit } = call.args;
        let test: RegExp | null = null;
        try {
          test = pattern ? new RegExp(pattern, "i") : null;
        } catch {
          throw new Error(`Not a pattern: ${pattern}`);
        }
        const lines = log.current
          .filter((l) => (!only_errors || l.level === "error") && (!test || test.test(l.text)))
          .slice(-(limit ?? 100));
        if (clear) log.current = [];
        return lines.length ? lines.map((l) => `[${l.level}] ${l.text}`).join("\n") : "Nothing logged.";
      }
    }
  };

  return { keepIn, run };
}
