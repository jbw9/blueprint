"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { cn } from "@/lib/client/utils";
import type { RowCtx } from "@/components/bluprint/anatomy";
import { Zoom } from "@/components/chrome/zoom";
import { Crumbs, goTo, useLocation } from "@/components/chrome/crumbs";
import { useBluprint } from "@/components/bluprint/bluprint-context";
import { useFlash } from "@/components/bluprint/flash";
import { DocView, closeDoc, isMarkdown, useOpenDoc } from "@/components/bluprint/docs";
import { TimelineView, closeTimeline, useTimelineOpen } from "@/components/review/timeline";
import { FileView, closeFile, useOpenFile } from "@/components/bluprint/code";
import { section, type Target } from "@/lib/agent/context";
import { DragChip, SectionTabs, dropAt, dropInTab, openInTab, setPartDrag, tabTitle, type Drop } from "@/components/chrome/tabs";
import { DiffBar, HereChanges } from "@/components/review/diagram-diff";
import { STATIC_BLUPRINT } from "@/lib/bluprint/source";
import { useSettings, type Ground } from "@/lib/client/settings";
import { useDesktop } from "@/lib/client/platform";
import { PICKABLE, PickMenu, opener, opensAt, targetOf, wordsOf } from "@/components/bluprint/pick";
import { Level } from "@/components/bluprint/level";

/**
 * The whole screen: ONE level at a time.
 *
 * The board used to be a pan/zoom canvas where every drill unfolded another
 * row of cards beside the last. Each level added width, siblings were squeezed
 * to fit a 360px wrapper (Formulas rendered one word per line), and the top
 * level was a hand-placed serpentine whose second row read right-to-left. See
 * D28.
 *
 * Now the node you opened is the header, its children are the body, and the
 * way back is the trail on the left. Every level — the repo included — is the
 * same template, so depth costs nothing visually: level six looks like level
 * one, and the bottom of every branch is the code itself.
 */

export function Canvas() {
  const bluprint = useBluprint();
  const { RUN, nodeAt, name, bluprints } = bluprint;
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // A rewrite of the bluprint lights what it changed (components/bluprint/flash.tsx).
  useFlash(contentRef);

  /**
   * The open path, root-first, read from the URL (useLocation in
   * components/chrome/crumbs.tsx); depth is its length. Clicking empty space used to
   * go back, and an accidental click on the background threw away where you
   * were.
   */
  const { path, crumbs } = useLocation();
  // An update held back while this level was open is taken in on the way to another (components/bluprint/bluprint-context.tsx).
  const { onScreen, apply } = bluprint;
  const at = JSON.stringify(path);
  useEffect(() => {
    onScreen(JSON.parse(at));
    apply();
  }, [at, onScreen, apply]);
  // A doc opened over the level (components/bluprint/docs.tsx) takes its place until closed.
  const doc = useOpenDoc();
  // So does the history (components/review/timeline.tsx).
  const timeline = useTimelineOpen();
  // And a whole file open to edit (components/bluprint/code.tsx).
  const file = useOpenFile();
  const key = doc ? `doc:${doc.file}` : file ? `file:${file.file}` : timeline ? "timeline" : path.join("/");
  const focus = path.length ? nodeAt(path) : null;

  // Which way the level slides: deeper or back. Derived when the depth
  // changes, during render, so the exiting level already knows its direction.
  const [moved, setMoved] = useState({ depth: path.length, dir: 1 });
  if (moved.depth !== path.length) {
    setMoved({ depth: path.length, dir: path.length > moved.depth ? 1 : -1 });
  }
  const dir = moved.dir;

  // A trace belongs to the level it was started on, and ends when you leave.
  const [trace, setTrace] = useState<{ at: string; id: string } | null>(null);
  const traced = trace?.at === key ? trace.id : null;
  const setTraced = useCallback(
    (id: string | null) => setTrace(id ? { at: key, id } : null),
    [key],
  );

  // A level gone into starts at its top; one come back to, where it was left.
  const scrolls = useRef(new Map<string, number>());
  const [came, setCame] = useState({ key, back: false });
  if (came.key !== key) setCame({ key, back: isBack(came.key, key) });

  /* ── rows that open their own level ───────────────────────── */

  const onOpenRow = useCallback(
    (id: string) => {
      // The row id names its owner (`eng-path:2` owns `eng-path:2:not expired`,
      // hence lastIndexOf). The owner is either the open node or a card on the
      // level below it, so cut the path back to it or step into it — never
      // just append.
      const owner = id.slice(0, id.lastIndexOf(":"));
      const ownerAt = path.indexOf(owner);
      const at = ownerAt === -1 ? [...path, owner] : path.slice(0, ownerAt + 1);
      if (nodeAt([...at, id])) goTo([...at, id]);
    },
    [path, nodeAt],
  );

  const ctx = useMemo<RowCtx>(
    () => ({
      traced,
      onTrace: (rid) => setTraced(traced === rid ? null : rid),
      open: path[path.length - 1] ?? null,
      onOpenRow,
    }),
    [traced, setTraced, path, onOpenRow],
  );

  /* ── keyboard ─────────────────────────────────────────────── */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest("textarea, input")) return;
      // Keys typed into an editor are the editor's: Esc there closes its search, not the file.
      if (e.target instanceof HTMLElement && e.target.closest(".cm-editor")) return;
      if (e.key === "Escape") {
        // Unwind one layer at a time: an open doc, file or the history, the trace, then one level.
        if (doc) closeDoc();
        else if (file) closeFile();
        else if (timeline) closeTimeline();
        else if (traced) setTraced(null);
        else if (path.length) goTo(path.slice(0, -1));
      } else if (e.key === "0" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // ⌘0 belongs to the zoom reset, which listens on window too.
        goTo([]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [traced, setTraced, path, doc, file, timeline]);

  /* ── handing a section to Claude ──────────────────────────── */

  // Right-click offers Claude the nearest thing under the pointer: a card or
  // the open level's header (`data-path`, a whole section), else a row, box,
  // block or line of code (`data-row`, `data-pick`). In the desktop app, and on
  // a published bluprint, whose Claude is its panel; a plain browser keeps its own menu.
  const desktop = useDesktop();
  const { ground } = useSettings();
  const [menu, setMenu] = useState<{ x: number; y: number; target: Target; words: string; opens: string[] | null } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const onContextMenu = (e: React.MouseEvent) => {
    // An editor's text keeps its own menu: copy, paste, spelling.
    if ((e.target as Element).closest(".cm-editor")) return;
    // Anything else on the level — a caption, the space between blocks — is
    // part of the section you are in, so that is what it offers.
    const el = (e.target as Element).closest<HTMLElement | SVGElement>(PICKABLE);
    const target = el ? targetOf(bluprint, el, path) : section(bluprint, path);
    if (!target) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, target, words: wordsOf(bluprint, el, path), opens: opensAt(e.target as Element, path) });
  };

  // A part opens in a new tab the way a link does: a middle click, or a click
  // with ⌘/Ctrl. Taken in the capture phase, before the part's own click opens
  // it in place.
  const toTab = (e: React.MouseEvent) => {
    const opens = opensAt(e.target as Element, path);
    if (!opens) return;
    e.preventDefault();
    e.stopPropagation();
    openInTab(name, opens);
  };

  // A part dragged off the bluprint onto its strip of tabs opens there, as a link
  // dragged onto Chrome's tabs does (components/chrome/tabs.tsx). A press that hardly
  // moves is still a click, which opens the part in place.
  const grab = (e: React.PointerEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const target = e.target as Element;
    if (target.closest(":disabled")) return;
    const part = opener(target, path);
    if (!part) return;
    const { el, at } = part;
    const label = tabTitle(nodeAt, at);
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moving = false;
    const move = (m: PointerEvent) => {
      if (!moving && Math.hypot(m.clientX - x0, m.clientY - y0) < 6) return;
      if (!moving) {
        moving = true;
        document.body.dataset.dragging = "";
        el.setAttribute("data-drag-source", "");
        window.getSelection()?.removeAllRanges();
      }
      setPartDrag({ label, x: m.clientX, y: m.clientY, drop: dropAt(m.clientX, m.clientY) });
    };
    const end = (drop: Drop | null) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", key, true);
      if (!moving) return;
      delete document.body.dataset.dragging;
      el.removeAttribute("data-drag-source");
      setPartDrag(null);
      // The click this press ends in would open the part in place too.
      const swallow = (c: MouseEvent) => {
        c.preventDefault();
        c.stopPropagation();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, true));
      if (drop) dropInTab(name, at, drop);
    };
    const up = (u: PointerEvent) => end(dropAt(u.clientX, u.clientY));
    const cancel = () => end(null);
    // Esc lets go of the part, before it can take the bluprint up a level.
    const key = (k: KeyboardEvent) => {
      if (k.key !== "Escape" || !moving) return;
      k.preventDefault();
      k.stopImmediatePropagation();
      end(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", key, true);
  };

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden bg-paper"
      onContextMenu={desktop || STATIC_BLUPRINT ? onContextMenu : undefined}
      onClickCapture={(e) => (e.metaKey || e.ctrlKey ? toTab(e) : undefined)}
      onAuxClickCapture={(e) => (e.button === 1 ? toTab(e) : undefined)}
      onPointerDown={grab}
      // The browser's own drag of a link would take the pointer from ours.
      onDragStart={(e) => (opensAt(e.target as Element, path) ? e.preventDefault() : undefined)}
    >
      {menu ? <PickMenu {...menu} onClose={closeMenu} /> : null}
      <DragChip />
      <SectionTabs path={path} />
      <main
        ref={scrollRef}
        // A file or doc is an editor: it fills the pane and scrolls inside itself.
        className={cn(GROUND[ground], "relative min-h-0 min-w-0 flex-1", doc || file ? "flex flex-col overflow-hidden" : "overflow-auto")}
        // The level is laid out in what the workspace window leaves of the
        // width (components/agent/workspace.tsx), but never in less than 480px: a
        // window dragged nearly full width covers the bluprint rather than crushing it.
        style={{ paddingRight: "min(var(--workspace-inset, 0px), max(0px, 100% - 480px))" }}
      >
        {/* In the desktop app the title bar carries where you are. */}
        {desktop ? null : (
          <Crumbs repo={RUN.repo} bluprint={name} bluprints={bluprints} crumbs={crumbs} onJump={(d) => goTo(path.slice(0, d))} />
        )}
        {doc || file || timeline ? null : <DiffBar path={path} />}
        {doc || file ? (
          <div className="relative min-h-0 flex-1">
            {doc ? (
              <DocView key={doc.file} file={doc.file} line={doc.line} />
            ) : file && isMarkdown(file.file) ? (
              // A Markdown file opened as a file (the palette, a link on a level) is still written in the Markdown editor.
              <DocView key={file.file} file={file.file} line={file.line} onClose={closeFile} />
            ) : file ? (
              <FileView key={file.file} file={file.file} line={file.line} />
            ) : null}
          </div>
        ) : (
        <Zoom scrollRef={scrollRef}>
        <div ref={contentRef} className="relative mx-auto max-w-[1680px] px-10 pb-28 pt-5">
          {/* The CSS reduced-motion rule (app/globals.css) does not reach motion's own animations. */}
          <MotionConfig reducedMotion="user">
          <AnimatePresence mode="wait" initial={false} custom={dir}>
            <motion.div
              key={key}
              custom={dir}
              variants={{
                in: { opacity: 1, y: 0 },
                out: (d: number) => ({ opacity: 0, y: 10 * d }),
                // Leaving is quicker than arriving, and takes no clicks: a
                // second click on the level going away would open one of its parts.
                gone: (d: number) => ({ opacity: 0, y: -6 * d, pointerEvents: "none", transition: { duration: 0.1, ease: [0.22, 1, 0.36, 1] } }),
              }}
              initial="out"
              animate="in"
              exit="gone"
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            >
              <Arrive pane={scrollRef} kept={scrolls} at={key} back={came.back} />
              {timeline ? (
                <TimelineView />
              ) : (
                <>
                  <HereChanges path={path} />
                  <Level node={focus ?? bluprint.TOP} path={path} ctx={ctx} onOpen={goTo} />
                </>
              )}
            </motion.div>
          </AnimatePresence>
          </MotionConfig>
        </div>
        </Zoom>
        )}
      </main>
    </div>
  );
}

const overlaid = (key: string) => key === "timeline" || key.startsWith("doc:") || key.startsWith("file:");

/** Whether `to` is where `from` was reached from: up the path, or out from under a doc, file or the history. */
function isBack(from: string, to: string) {
  if (overlaid(to)) return false;
  return overlaid(from) || (from !== to && (to === "" || from.startsWith(`${to}/`)));
}

/**
 * Scrolls the pane for a level as it arrives, and keeps where it was left as
 * it goes. Mounted inside the level rather than run on the change of path: the
 * level leaving is still on screen while it fades, and scrolling then jerked it
 * to its top under the reader's eyes.
 */
function Arrive({ pane, kept, at, back }: { pane: React.RefObject<HTMLElement | null>; kept: React.RefObject<Map<string, number>>; at: string; back: boolean }) {
  useLayoutEffect(() => {
    const el = pane.current;
    const tops = kept.current;
    if (!el) return;
    el.scrollTo({ top: back ? (tops.get(at) ?? 0) : 0 });
    return () => void tops.set(at, el.scrollTop);
  }, [pane, kept, at, back]);
  return null;
}

const GROUND: Record<Ground, string> = { dots: "dotfield", squares: "gridfield", plain: "" };
