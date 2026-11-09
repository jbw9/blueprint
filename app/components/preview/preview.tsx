"use client";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Menu } from "@/components/ui/menu";
import { bare, isWeb, originOf, pathOf } from "@/components/preview/address";
import { Devices } from "@/components/preview/devices";
import { Handle } from "@/components/preview/handle";
import { focused, onScreen, touch, touched } from "@/components/preview/keys";
import { collect, listenToPage } from "@/components/preview/messages";
import { navigation } from "@/components/preview/navigation";
import type { Line, Parts, Said, Signing } from "@/components/preview/parts";
import { PickMenu } from "@/components/preview/pick-menu";
import { Placeholder } from "@/components/preview/placeholder";
import { ShowSwitches } from "@/components/preview/show-switches";
import { SignInBar } from "@/components/preview/sign-in-bar";
import { Tool } from "@/components/preview/tool";
import { agent as ask, tools } from "@/components/preview/tools";
import { PAD, clamp, keepSize, storedSize, type Size } from "@/components/preview/viewport";
import { keepOver } from "@/components/preview/webview";
import { mention, usePicks, type Target } from "@/lib/agent/context";
import { PRESETS, registerPreview, type Call } from "@/lib/agent/preview";
import { cn } from "@/lib/client/utils";
import { isDesktop } from "@/lib/client/platform";

/**
 * A project's running web app, in a workspace tab (components/agent/workspace.tsx).
 * The page is framed through the app's proxy (src-tauri/src/preview.rs), which
 * adds an agent to it (agent.js): that is how the page's address and console
 * reach this tab, and how Claude reads and uses the page (lib/agent/preview.ts).
 *
 * A page from the web (a search, a library's docs) cannot be framed: it opens
 * in a webview of its own, laid over the viewport and kept there
 * (src-tauri/src/browser.rs), with the same agent inside it, asked through the
 * app instead of by message. Both kinds are one trail of pages, back and forth.
 *
 * Claude's clicks and keys are real on macOS: AppKit events at the point on
 * screen, so every button that works for a person works for Claude. The
 * agent draws Claude's pointer gliding to each one. Where they cannot be real
 * (the frame is out of sight, or not on a Mac), the agent acts in the page.
 *
 * The viewport fills the tab until it is given a size: by dragging its right
 * or bottom edge, from the size menu, or by Claude. A size bigger than the tab
 * is scaled down to fit, and the page still lays out at its real width. While
 * the size changes, it is shown in the middle in pixels, as Ghostty shows a
 * terminal's.
 */

export function Preview({
  id,
  root,
  target: served,
  visible,
  waiting,
  asking,
  onAnswer,
  serverShown,
  onServer,
  sites,
  site,
  onSite,
  onStart,
  docked,
  blank,
  staged,
}: {
  /** Its tab's key: what Claude's calls find it by. */
  id: number;
  root: string;
  /** The project's dev server's address, once it has printed one: where the
   * tab goes until it is pointed at another server of its own. */
  target?: string;
  visible: boolean;
  /** The command starting the dev server, until it prints an address. */
  waiting?: string;
  /** A yes-or-no question the dev server is waiting on, and its answer typed into it. */
  asking?: string;
  onAnswer?: (yes: boolean) => void;
  /** The dev server's terminal is shown in the page's place (components/agent/workspace.tsx). */
  serverShown?: boolean;
  /** Switch between the page and the dev server's terminal; absent with no dev server. */
  onServer?: (shown: boolean) => void;
  /** The project's web apps by folder, when it has more than one to switch between; the one running. */
  sites?: string[];
  site?: string;
  onSite?: (dir: string) => void;
  /** Start the project's dev server; absent while one runs. */
  onStart?: () => void;
  /** In the main view rather than the window (components/agent/workspace.tsx). */
  docked?: boolean;
  /** A new tab of its own, as a browser's: no dev server, and the address bar taken at once. */
  blank?: boolean;
  /** Drawn past the window's edge while out of sight, so a screenshot can take
   * it without bringing its project to the front (components/agent/workspace.tsx). */
  staged?: boolean;
}) {
  // Another server this tab was pointed at, from its address bar or by
  // Claude: this tab's alone, so the project's other Previews stay put.
  const [pointed, setPointed] = useState<string | undefined>();
  // The dev server restarted, or another site of the project was switched to:
  // that is where the user wants this tab, whatever it was pointed at.
  const [servedWas, setServedWas] = useState(served);
  if (servedWas !== served) {
    setServedWas(served);
    setPointed(undefined);
  }
  const target = pointed ?? served;
  const frame = useRef<HTMLIFrameElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const whole = useRef<HTMLDivElement>(null);
  const address = useRef<HTMLInputElement>(null);
  // Where the frame starts. Set once: every later move is made on the frame itself.
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The address bar: where the page is, or what is being typed into it.
  const [shown, setShown] = useState("");
  const [draft, setDraft] = useState<string | null>(null);
  const [size, setSize] = useState<Size | null>(() => storedSize(root));
  const [box, setBox] = useState<Size>({ w: 0, h: 0 });
  const [badge, setBadge] = useState(false);
  const sizeBadge = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [picking, setPicking] = useState<{ x: number; y: number; targets: Target[] } | null>(null);
  const [selecting, setSelecting] = useState(false);
  // Counts the pages the agent has come up on, each needing its outlines again.
  const [page, setPage] = useState(0);
  // A page from the web is in front, in the webview of this label.
  const [web, setWeb] = useState<string | null>(null);
  const [picture, setPicture] = useState<string | null>(null);
  const [claude, setClaude] = useState(false);
  const [signing, setSigning] = useState<Signing | null>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const replace = useRef(() => {});

  // What the calls below read: they outlive any one render.
  const proxy = useRef<{ id: number; port: number } | null>(null);
  const browser = useRef<string | null>(null);
  // Whether that webview is in the project's own store of sign-ins, not the shared one.
  const ownStore = useRef(false);
  const signingNow = useRef<Signing | null>(null);
  const signedIn = useRef<((done: boolean) => void) | null>(null);
  const onWeb = useRef(false);
  const here = useRef("");
  const server = useRef(target);
  const log = useRef<Line[]>([]);
  // The page's alerts and confirms since Claude last acted (agent.js answers them).
  const dialogs = useRef<string[]>([]);
  const pending = useRef(new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>());
  const loads = useRef<(() => void)[]>([]);
  // A Preview just opened for an agent is asked before its first page is in:
  // the call waits for it, rather than being answered by its arrival.
  const everLoaded = useRef(false);
  // Why the page last asked for could not be opened, for the navigate waiting on it.
  const missed = useRef<string | null>(null);
  // The pages this tab has shown, for its own back and forward. The page's
  // history is shared with the app's window, so it is never stepped through:
  // every move is a replace, and adds nothing to the app's back.
  const trail = useRef<{ list: string[]; at: number; stepping: boolean }>({ list: [], at: -1, stepping: false });

  const fill = size === null;
  const vw = fill ? Math.round(box.w) : size.w;
  const vh = fill ? Math.round(box.h) : size.h;
  const scale = fill ? 1 : Math.max(0.1, Math.min(1, (box.w - 2 * PAD) / size.w, (box.h - 2 * PAD) / size.h));
  const view = useRef({ vw, vh, scale });
  useEffect(() => {
    view.current = { vw, vh, scale };
    server.current = target;
  });

  /** The page's address as the dev server knows it, not the proxy. */
  const display = (url: string) => {
    const p = proxy.current;
    if (!p || !server.current) return bare(url);
    const mine = `http://localhost:${p.port}`;
    return bare(url.startsWith(mine) ? originOf(server.current) + url.slice(mine.length) : url);
  };

  // What the Preview's code kept outside it works with (parts.ts): gathered
  // when that code is called, not in render.
  const parts = (): Parts => ({
    id, root, frame, stage, sheet, sizeBadge, proxy, browser, ownStore, signingNow, signedIn, onWeb, here, server, log, dialogs,
    pending, everLoaded, missed, trail, view, hear, replace, setPointed, setSrc, setShown, setBadge, setWeb, setSigning,
    display, go, fail, loaded, nextLoad, navigate, agent, resize,
  });

  /** Opens a page, from the web or the dev server (navigation.ts). */
  const go = (url: string) => navigation(parts()).go(url);

  const fail = (e: unknown) => {
    // Outside the desktop app every failure is its missing shell, not something to show raw.
    setError(isDesktop() ? String(e) : "Web pages open in the Blueprint desktop app.");
    missed.current = String(e);
    loads.current.splice(0).forEach((f) => f());
  };

  // A proxy in front of the dev server, opened once it has an address and
  // kept for the tab's life: a server that restarts elsewhere is followed on
  // the same port, so the page keeps its storage.
  useEffect(() => {
    if (!target || !isDesktop()) return;
    const open = proxy.current;
    if (open) {
      void invoke("preview_target", { id: open.id, target }).then(() => {
        // A page from the web in front is left there; the frame behind follows.
        const url = `http://localhost:${open.port}${pathOf(target)}`;
        if (onWeb.current) frame.current?.contentWindow?.location.replace(url);
        else go(url);
      }, fail);
      return;
    }
    let gone = false;
    invoke<{ id: number; port: number }>("preview_open", { target })
      .then((p) => {
        if (gone) return void invoke("preview_close", { id: p.id });
        proxy.current = p;
        const url = `http://localhost:${p.port}${pathOf(target)}`;
        // Opened behind a page from the web, which keeps the address bar.
        if (!onWeb.current) {
          here.current = url;
          setShown(display(url));
        }
        setSrc(url);
        setError(null);
      })
      .catch(fail);
    return () => {
      gone = true;
    };
  }, [target]);

  useEffect(
    () => () => {
      // Forgotten as well as closed: an effect run again (a hot reload) opens a fresh one.
      if (proxy.current) void invoke("preview_close", { id: proxy.current.id });
      proxy.current = null;
      if (browser.current) void invoke("browser_close", { label: browser.current });
      browser.current = null;
      signedIn.current?.(false);
    },
    [],
  );

  const loaded = () => {
    everLoaded.current = true;
    setError(null);
    // A page that navigated took its unanswered calls with it.
    for (const p of pending.current.values()) p.resolve(`The page navigated to ${display(here.current)}.`);
    pending.current.clear();
    // The new page says where it is just after this; wait to hear it.
    const waiting = loads.current.splice(0);
    setTimeout(() => waiting.forEach((f) => f()), 80);
  };

  const nextLoad = () =>
    new Promise<void>((resolve) => {
      loads.current.push(resolve);
      setTimeout(resolve, 15000);
    });

  // Moved between the window and the main view, the frame is taken out of
  // the page and put back, which loads it afresh from its src: made the page
  // it was showing, not the one it started on. Before the move, which the
  // workspace makes after this.
  const place = useRef(docked);
  useLayoutEffect(() => {
    if (place.current === docked) return;
    place.current = docked;
    const el = frame.current;
    if (el && here.current && !isWeb(here.current)) el.src = here.current;
  }, [docked]);

  const keyed = useRef<(k: string) => void>(() => {});
  // What the agent in the page says: where it is, what it logged, its answers.
  const hear = useRef<(m: Said) => void>(() => {});
  // Seconds the server this tab was pointed at has not answered.
  const down = useRef(0);
  useEffect(() => {
    hear.current = (m) => {
      if (m.type !== "down") down.current = 0;
      if (m.type === "down") {
        // A server Claude started for a moment and stopped would hold the tab
        // on its waiting page for good: after a few seconds it goes back to
        // the dev server, which may well be answering.
        if (pointed && served && pointed !== served && ++down.current >= 5) {
          down.current = 0;
          setPointed(undefined);
        }
      } else if (m.type === "location") {
        here.current = m.url;
        setShown(display(m.url));
        const t = trail.current;
        if (t.stepping) t.stepping = false;
        else if (t.list[t.at] !== m.url) {
          t.list = [...t.list.slice(0, t.at + 1), m.url];
          t.at = t.list.length - 1;
        }
      } else if (m.type === "console") {
        if (m.level === "dialog") dialogs.current.push(m.text);
        log.current.push({ level: m.level, text: m.text });
        if (log.current.length > 1000) log.current.shift();
      } else if (m.type === "open") {
        // A link off this machine, from the dev server's page.
        go(m.url);
      } else if (m.type === "reply") {
        const p = pending.current.get(m.id);
        if (!p) return;
        pending.current.delete(m.id);
        if (m.ok) p.resolve(m.value);
        else p.reject(new Error(String(m.value)));
      } else if (m.type === "loaded") {
        // A new page has a new agent, which is not selecting and has nothing outlined.
        setSelecting(false);
        loaded();
        setPage((n) => n + 1);
      } else if (m.type === "pick") {
        // The page knows itself by the proxy's address; Claude knows the dev server's.
        const p = proxy.current;
        const targets = m.targets.map((t) => ({
          ...t,
          text: p && server.current ? t.text.replaceAll(`http://localhost:${p.port}`, originOf(server.current)) : t.text,
        }));
        // A page from the web is a webview over the app, which would hide a menu.
        if (onWeb.current) return targets.forEach(mention);
        const r = frame.current?.getBoundingClientRect();
        const k = view.current.scale;
        setPicking({ x: (r?.x ?? 0) + m.x * k, y: (r?.y ?? 0) + m.y * k, targets });
      } else if (m.type === "unpick") {
        setPicking(null);
      } else if (m.type === "selecting") {
        setSelecting(m.on);
      } else if (m.type === "focus") {
        touch(id);
      } else if (m.type === "key") {
        keyed.current(m.key);
      }
    };
  });
  useEffect(() => listenToPage({ frame, onWeb, browser, hear, replace, setShown }), []);

  useEffect(() => {
    if (!web) return;
    return collect(hear, web);
  }, [web]);

  useEffect(() => {
    if (!web) return;
    return keepOver({ sheet, stage, view, replace }, web, setPicture);
  }, [web]);

  const agent = (name: string, args: Record<string, unknown>) => ask({ frame, proxy, onWeb, browser, pending }, name, args);

  // What is added from the page and not yet sent stays outlined there, under its name in the prompt.
  const picks = usePicks();
  const marks = useMemo(
    () => picks.filter((p) => p.status === "queued" && p.key.startsWith("preview:")).map((p) => ({ key: p.key, label: p.title })),
    [picks],
  );
  useEffect(() => void agent("marks", { marks }).catch(() => {}), [marks, page]);

  /** A path, an address on this machine or the web, a search, or back, forward, reload (navigation.ts). */
  const navigate = (raw: string) => navigation(parts()).navigate(raw);

  // A browser's keys, given to this tab while it is the one in use (keys.ts).
  useEffect(() => {
    keyed.current = (k) => {
      if (k === "address") address.current?.focus();
      else if (k === "reload" || k === "back" || k === "forward") void navigate(k).catch(() => {});
    };
  });
  useEffect(() => {
    const el = whole.current;
    if (!visible || !el) return;
    const me = { el, key: (k: string) => keyed.current(k) };
    onScreen.set(id, me);
    // Just brought to the front, with nothing else of the app's in use.
    if (touched === null) touch(id);
    const off = isDesktop() ? listen<string>("blueprint:preview-key", (e) => focused() === id && keyed.current(e.payload)) : undefined;
    return () => {
      if (onScreen.get(id) === me) onScreen.delete(id);
      void off?.then((f) => f());
    };
  }, [id, visible]);

  /** Where a sign-in is kept, changed while the user is signing in (tools.ts). */
  const keepIn = (project: boolean) => tools(parts()).keepIn(project);

  const resize = (next: Size | null) => {
    setSize(next);
    keepSize(root, next);
  };

  // Claude's calls (tools.ts), by way of the workspace.
  const run = (call: Call) => tools(parts()).run(call);
  const handle = useRef({ run });
  useEffect(() => {
    handle.current.run = run;
  });
  // Said in the toolbar while Claude is using the page, and for a moment after.
  const quiet = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () =>
      registerPreview(id, {
        run: (c) => {
          setClaude(true);
          clearTimeout(quiet.current);
          return handle.current.run(c).finally(() => {
            quiet.current = setTimeout(() => setClaude(false), 2500);
          });
        },
        url: () => here.current,
      }),
    [id],
  );

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    // A tab put out of layout measures 0×0: the page keeps its last size
    // rather than being laid out at nothing and back.
    const seen = new ResizeObserver(([e]) => {
      const { width: w, height: h } = e.contentRect;
      if (w || h) setBox({ w, h });
    });
    seen.observe(el);
    return () => seen.disconnect();
  }, []);

  // The size, in the middle, whenever it changes and for a moment after.
  const first = useRef(true);
  useEffect(() => {
    if (first.current || !vw || !vh) {
      first.current = !vw;
      return;
    }
    sizeBadge.current?.style.removeProperty("display");
    setBadge(true);
    const t = setTimeout(() => setBadge(false), 900);
    return () => clearTimeout(t);
  }, [vw, vh]);

  const drag = (edge: "x" | "y" | "xy") => (e: React.PointerEvent) => {
    e.preventDefault();
    // From filling the tab, the drag starts at the size that fits inside the handles.
    const from = fill ? { w: clamp(box.w - 2 * PAD), h: clamp(box.h - 2 * PAD), s: 1 } : { w: vw, h: vh, s: scale };
    const x0 = e.clientX;
    const y0 = e.clientY;
    let last: Size = { w: from.w, h: from.h };
    // The frame would take the pointer's moves for its own page.
    document.body.dataset.dragging = "";
    const move = (m: PointerEvent) => {
      // Centred, so the edge follows the pointer when the width grows twice as fast.
      last = {
        w: edge === "y" ? from.w : clamp(from.w + (2 * (m.clientX - x0)) / from.s),
        h: edge === "x" ? from.h : clamp(from.h + (m.clientY - y0) / from.s),
      };
      setSize(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      delete document.body.dataset.dragging;
      keepSize(root, last);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const bw = vw * scale;
  const bh = vh * scale;
  const left = fill ? 0 : (box.w - bw) / 2;
  const top = fill ? 0 : PAD;
  const dims = `${vw} × ${vh}${scale < 1 ? ` · ${Math.round(scale * 100)}%` : ""}`;
  const ready = (src !== null && !!target) || web !== null;

  // The size it last had in sight: staged at that size, the page lays out as it did.
  const [sized, setSized] = useState({ w: 0, h: 0 });
  const stagedNow = useRef(staged);
  useEffect(() => {
    stagedNow.current = staged;
  }, [staged]);
  useEffect(() => {
    const el = whole.current;
    if (!el) return;
    const seen = new ResizeObserver(([e]) => {
      const { width: w, height: h } = e.target.getBoundingClientRect();
      if (!stagedNow.current && w && h) setSized({ w, h });
    });
    seen.observe(el);
    return () => seen.disconnect();
  }, []);

  const typedInto = useRef(false);
  useEffect(() => {
    if (!blank || !visible || typedInto.current) return;
    typedInto.current = true;
    address.current?.focus();
  }, [blank, visible]);

  return (
    <div
      ref={whole}
      className={cn("absolute inset-0 flex flex-col", !visible && "pointer-events-none", !visible && !staged && "invisible")}
      // In the main view, clear of the window floating over its right, as the
      // blueprint is (components/agent/workspace.tsx): a page from the web would hide
      // wherever the window covers it, and a screenshot would take the window in.
      // Staged, past the right edge: WebKit's snapshot paints the area asked
      // for, on screen or not, and nobody sees it there.
      style={
        staged && !visible
          ? { position: "fixed", inset: "0 auto auto 100vw", width: sized.w || "60vw", height: sized.h || "80vh", visibility: "visible" }
          : docked
            ? { paddingRight: "var(--workspace-inset, 0px)" }
            : undefined
      }
    >
      <div data-chrome="bar" className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border-gray bg-surface px-1.5">
        <ShowSwitches serverShown={serverShown} onServer={onServer} sites={sites} site={site} onSite={onSite} />
        <Tool label="Back" onClick={() => void navigate("back").catch(() => {})} disabled={!ready}>
          <path d="M10 3.5 5.5 8l4.5 4.5" />
        </Tool>
        <Tool label="Forward" onClick={() => void navigate("forward").catch(() => {})} disabled={!ready}>
          <path d="M6 3.5 10.5 8 6 12.5" />
        </Tool>
        <Tool label="Reload" onClick={() => void navigate("reload").catch(() => {})} disabled={!ready}>
          <path d="M12.5 8a4.5 4.5 0 1 1-1.3-3.2M12.5 3v2.5H10" />
        </Tool>
        <form
          className="mx-1 min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft?.trim()) {
              void navigate(draft.trim()).catch(() => {});
            }
            setDraft(null);
            (document.activeElement as HTMLElement | null)?.blur();
          }}
        >
          <input
            ref={address}
            aria-label="Address"
            value={draft ?? shown}
            placeholder={target ? "" : blank ? "Search or type an address" : "localhost:3000, or search the web"}
            onFocus={(e) => {
              setDraft(shown);
              e.currentTarget.select();
            }}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => setDraft(null)}
            onKeyDown={(e) => {
              if (e.key === "Escape") (e.target as HTMLElement).blur();
            }}
            spellCheck={false}
            className="h-6 w-full border border-border-gray bg-card px-2 font-mono text-[11.5px] text-ink outline-none placeholder:text-faint focus:border-accent/60"
          />
        </form>
        <Devices size={size} fill={fill} resize={resize} />
        <button
          type="button"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({ x: r.left, y: r.bottom + 4 });
          }}
          title="Viewport size: drag the page's right or bottom edge, or pick one"
          className="flex h-6 shrink-0 cursor-pointer items-center px-2 font-mono text-[11px] text-muted-slate tabular-nums hover:bg-surface-container hover:text-ink"
        >
          {vw && vh ? dims : "—"}
        </button>
        {claude ? (
          <span className="mr-1 flex shrink-0 items-center gap-1.5 bg-[#d97757]/12 px-2 py-0.5 text-[11px] text-[#b4553a]">
            <span className="size-1.5 animate-pulse rounded-full bg-[#d97757]" />
            Claude
          </span>
        ) : null}
        <Tool
          label={selecting ? "Stop selecting (Esc)" : "Select an element to add to Claude · ⇧ click picks several"}
          on={selecting}
          onClick={() => void agent("select", { on: !selecting }).catch(() => {})}
          disabled={!ready}
        >
          <path d="M6 2.5H2.5V6M2.5 9v1M13.5 6V2.5H10M9 2.5H7" />
          <path d="m7 7 6.5 2.4-2.8 1-1 2.8z" />
        </Tool>
        <Tool
          label="Open in your browser"
          onClick={() =>
            void invoke("preview_external", { url: isWeb(here.current) ? here.current : `http://${display(here.current)}` }).catch(() => {})
          }
          disabled={!ready}
        >
          <path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M11.5 9.5v4h-9v-9h4" />
        </Tool>
      </div>
      {signing ? <SignInBar signing={signing} onKeep={keepIn} onDone={(done) => signedIn.current?.(done)} /> : null}
      {picking ? (
        <PickMenu
          {...picking}
          onClose={() => {
            setPicking(null);
            void agent("unmark", {}).catch(() => {});
          }}
        />
      ) : null}
      {menu ? (
        <Menu
          x={menu.x}
          y={menu.y}
          title="Viewport"
          onClose={() => setMenu(null)}
          items={[
            { label: "Fill the tab", onClick: () => resize(null), disabled: fill },
            ...PRESETS.map((p) => ({ label: `${p.label} · ${p.w} × ${p.h}`, onClick: () => resize({ w: p.w, h: p.h }) })),
            { label: "Rotate", onClick: () => size && resize({ w: size.h, h: size.w }), disabled: fill },
          ]}
        />
      ) : null}
      <div ref={stage} className={cn("relative min-h-0 flex-1 overflow-hidden bg-surface-container", serverShown && "invisible")}>
        {ready ? (
          <>
            <div
              ref={sheet}
              className={cn("absolute overflow-hidden bg-card", !fill && "shadow-[0_0_0_1px_var(--color-border-strong)]")}
              style={{ left, top, width: bw, height: bh }}
            >
              {src ? (
                <iframe
                  ref={frame}
                  src={src}
                  title="Preview"
                  onLoad={() => !onWeb.current && loaded()}
                  style={{ width: vw, height: vh, transform: scale < 1 ? `scale(${scale})` : undefined, transformOrigin: "0 0" }}
                  className={cn("block border-0", web && "invisible")}
                />
              ) : null}
              {web && picture ? <div className="absolute inset-0" style={{ backgroundImage: `url(${picture})`, backgroundSize: "100% 100%" }} /> : null}
            </div>
            <Handle
              label="Resize width"
              cursor="cursor-ew-resize"
              style={{ left: Math.min(left + bw, box.w - 10), top, width: 10, height: bh }}
              onPointerDown={drag("x")}
              bar="h-8 w-1"
            />
            <Handle
              label="Resize height"
              cursor="cursor-ns-resize"
              style={{ left, top: Math.min(top + bh, box.h - 10), width: bw, height: 10 }}
              onPointerDown={drag("y")}
              bar="h-1 w-8"
            />
            <Handle
              label="Resize"
              cursor="cursor-nwse-resize"
              style={{ left: Math.min(left + bw, box.w - 12), top: Math.min(top + bh, box.h - 12), width: 12, height: 12 }}
              onPointerDown={drag("xy")}
            />
          </>
        ) : (
          <Placeholder blank={blank} error={error} waiting={waiting} asking={asking} onAnswer={onAnswer} onServer={onServer} onStart={onStart} />
        )}
        <div
          ref={sizeBadge}
          aria-hidden
          className={cn(
            "pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-night/80 px-3 py-1.5 font-mono text-[13px] text-white tabular-nums",
            // On at once, as Ghostty's is; it fades only on the way out, and
            // not at all in a hidden window, where the fade would never run.
            badge ? "opacity-100" : cn("opacity-0", typeof document !== "undefined" && document.visibilityState === "visible" && "transition-opacity duration-300"),
          )}
        >
          {dims}
        </div>
      </div>
    </div>
  );
}
