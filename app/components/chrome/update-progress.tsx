"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { goTo } from "@/components/chrome/crumbs";
import { cn } from "@/lib/client/utils";

/**
 * Keeping the blueprint up with the code, shown where it is seen: a pill in
 * the title bar (in a browser, where there is no title bar, at the right of the
 * status bar), a list of the sections it takes on, and a mark on each card
 * holding one. The status bar works out what to show (components/chrome/statusbar.tsx,
 * BlueprintUpdates) and hands it here, so every place reads the same thing.
 */

export type RowState = "behind" | "rewriting" | "updated" | "removed" | "added" | "failed";

export interface UpdateRow {
  id: string;
  title: string;
  /** The titles above it, for telling two sections of one name apart. */
  trail: string;
  /** Its ids from the top, when the blueprint has it. */
  path: string[] | null;
  /** The level that shows it: its own, or the one it sits on when it opens nothing. */
  open: string[] | null;
  state: RowState;
}

export interface UpdateView {
  /** behind: code moved and nothing is committed. finding: started, no sections picked yet. idle: nothing to report. */
  phase: "idle" | "behind" | "finding" | "running" | "done" | "failed";
  rows: UpdateRow[];
  startedAt?: string;
  finishedAt?: string;
  paused?: boolean;
  error?: string;
  update?: () => void;
  review?: () => void;
}

let view: UpdateView | null = null;
const listeners = new Set<() => void>();

export function setUpdateView(next: UpdateView | null) {
  if (next === view) return;
  view = next;
  listeners.forEach((l) => l());
}

export function useUpdateView(): UpdateView | null {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => view,
    () => null,
  );
}

/**
 * The section ids an update is rewriting right now, for the open level to say
 * so where the reader is looking (components/blueprint/header.tsx).
 */
export function useRedoing(): string[] {
  const v = useUpdateView();
  return useMemo(() => (v?.phase === "running" ? v.rows.filter((r) => r.state === "rewriting").map((r) => r.id) : []), [v]);
}

export type CardMark = { state: "rewriting" | "updated" | "failed"; n: number };

/** What an update is doing under a part: rewriting what it holds, done with it, or failed at it. */
function markOf(v: UpdateView | null, id: string): CardMark | null {
  // While it runs, and where it failed. A finished update's marks would stay on the blueprint for good.
  if (!v || (v.phase !== "running" && v.phase !== "failed")) return null;
  const under = v.rows.filter((r) => r.path?.includes(id));
  const count = (s: CardMark["state"]) => under.filter((r) => (s === "updated" ? r.state === "updated" || r.state === "added" || r.state === "removed" : r.state === s)).length;
  for (const s of ["rewriting", "failed", "updated"] as const) if (count(s)) return { state: s, n: count(s) };
  return null;
}

export function useCardMark(id: string): CardMark | null {
  const v = useUpdateView();
  return useMemo(() => markOf(v, id), [v, id]);
}

/** The same for many parts at once, as a picture's boxes ask. */
export function useCardMarks(): (id: string | undefined) => CardMark | null {
  const v = useUpdateView();
  return useCallback((id: string | undefined) => (id ? markOf(v, id) : null), [v]);
}

/** What a mark says, in a word or two. */
export const markWord = (m: CardMark) => (m.state === "rewriting" ? (m.n > 1 ? `${m.n} rewriting` : "rewriting") : m.state === "failed" ? "✗ update failed" : "✓ updated");

/** The chip a card carries while an update holds it, and after. */
export function CardMarkChip({ mark }: { mark: CardMark | null }) {
  if (!mark) return null;
  const said =
    mark.state === "rewriting"
      ? `Rewriting ${mark.n === 1 ? "a section" : `${mark.n} sections`} to match the code`
      : mark.state === "failed"
        ? `The update could not rewrite ${mark.n === 1 ? "a section" : `${mark.n} sections`} here`
        : `Updated to match the code`;
  return (
    <span
      title={said}
      className={cn(
        "flex shrink-0 items-center gap-1.5 border px-1.5 py-[3px] font-mono text-[10px] leading-none",
        mark.state === "rewriting" && "border-amber-line bg-amber-surface text-amber-ink",
        mark.state === "failed" && "border-clay-line bg-clay-surface text-clay-ink",
        mark.state === "updated" && "border-sage-line bg-sage-surface text-sage-ink",
      )}
    >
      {mark.state === "rewriting" ? <span aria-hidden className="size-[6px] animate-pulse rounded-full bg-current" /> : null}
      {markWord(mark)}
    </span>
  );
}

/** The border a card takes while it carries a mark. */
export function cardMarkClass(mark: CardMark | null) {
  if (!mark) return undefined;
  return mark.state === "rewriting" ? "shimmer border-amber-line" : mark.state === "failed" ? "border-clay-line" : "border-sage-line";
}

const done = (r: UpdateRow) => r.state === "updated" || r.state === "removed" || r.state === "added";

function headline(v: UpdateView): string {
  const n = v.rows.length;
  const landed = v.rows.filter(done).length;
  const failed = v.rows.filter((r) => r.state === "failed").length;
  if (v.phase === "idle") return v.paused ? "Auto-updates paused" : "Blueprint up to date";
  if (v.phase === "behind") return `${n} ${n === 1 ? "section" : "sections"} behind the code`;
  if (v.phase === "finding") return "Updating blueprint";
  if (v.phase === "running") return `Updating blueprint · ${landed} of ${n}`;
  if (v.phase === "done") return `Blueprint updated · ${n} ${n === 1 ? "section" : "sections"}`;
  return failed && n ? `${failed} of ${n} ${n === 1 ? "section" : "sections"} failed` : "Blueprint update failed";
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Time on the update: running, counting up each second; finished, how long it took. */
function useElapsed(v: UpdateView, on: boolean): string | null {
  const [now, setNow] = useState(() => Date.now());
  const ticking = on && (v.phase === "running" || v.phase === "finding");
  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking]);
  if (!v.startedAt) return null;
  const from = Date.parse(v.startedAt);
  if (v.finishedAt) return clock(Date.parse(v.finishedAt) - from);
  return ticking ? clock(now - from) : null;
}

const TONE = {
  idle: "border-sage-line bg-sage-surface text-sage-ink",
  behind: "border-border-gray bg-card text-ink hover:bg-surface-container",
  finding: "border-amber-line bg-amber-surface text-amber-ink",
  running: "border-amber-line bg-amber-surface text-amber-ink",
  done: "border-sage-line bg-sage-surface text-sage-ink",
  failed: "border-clay-line bg-clay-surface text-clay-ink",
} as const;

/** The app's working dot (components/agent/status-dot.tsx): still while it waits, ringing while work goes on. */
function Dot({ className, working }: { className: string; working?: boolean }) {
  return (
    <span aria-hidden className="relative flex size-2 shrink-0">
      {working ? <span className={cn("absolute inset-0 animate-ping rounded-full opacity-60", className)} /> : null}
      <span className={cn("relative size-2 rounded-full", className)} />
    </span>
  );
}

/** A thin bar of how many sections have landed; before any are picked, a sweep. */
function Progress({ v }: { v: UpdateView }) {
  const share = v.rows.length ? v.rows.filter((r) => r.state !== "rewriting").length / v.rows.length : 0;
  return (
    <span aria-hidden className="relative h-1 w-10 shrink-0 overflow-hidden rounded-full bg-current/20">
      {v.phase === "finding" ? (
        <span className="absolute inset-y-0 left-0 w-2/5 animate-[sweep_1.3s_ease-in-out_infinite] rounded-full bg-current" />
      ) : (
        <span className="absolute inset-y-0 left-0 rounded-full bg-current transition-[width] duration-500 ease-out" style={{ width: `${Math.round(share * 100)}%` }} />
      )}
    </span>
  );
}

/**
 * The update at a glance, and the list behind it on a click. `place`: in the
 * title bar it opens down; at the right of the status bar, up.
 */
export function UpdatePill({ place }: { place: "title" | "status" }) {
  const v = useUpdateView();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!v) return null;
  const n = v.rows.length;
  const landed = v.rows.filter(done).length;
  const failed = v.rows.filter((r) => r.state === "failed").length;
  const title = place === "title";
  const working = v.phase === "finding" || v.phase === "running";
  return (
    <div ref={box} className={cn("relative flex items-center", title ? "mr-1.5" : "mr-1 h-full")}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={v.phase === "behind" ? "The code changed under these sections. The blueprint follows when it is committed." : v.phase === "idle" ? "The blueprint matches the code" : headline(v)}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "arrive flex shrink-0 cursor-pointer items-center gap-2 rounded border font-medium whitespace-nowrap transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
          title ? "h-7 px-2.5 text-[12.5px]" : "h-[18px] px-2 text-[11px]",
          TONE[v.phase],
        )}
      >
        {v.phase === "behind" ? <Dot className="bg-amber-ink" /> : null}
        {working ? <Dot className="bg-amber-ink" working /> : null}
        {v.phase === "idle" ? (
          <span>{v.paused ? "Auto-updates paused" : "✓ Up to date"}</span>
        ) : v.phase === "behind" ? (
          <span>
            {n} {n === 1 ? "section" : "sections"} behind{v.paused ? " · paused" : ""}
          </span>
        ) : v.phase === "done" ? (
          <span>✓ Blueprint updated</span>
        ) : v.phase === "failed" ? (
          <span>✗ {failed && n > 1 ? `${failed} of ${n} failed` : "Update failed"}</span>
        ) : (
          <span>Updating blueprint</span>
        )}
        {v.phase === "running" ? (
          <span className="tabular-nums opacity-80">
            {landed}/{n}
          </span>
        ) : null}
        {v.phase === "done" ? <span className="tabular-nums opacity-80">{n}</span> : null}
        {working ? <Progress v={v} /> : null}
      </button>
      {open ? <UpdatePanel v={v} up={!title} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

const WORD: Record<RowState, string> = {
  behind: "Behind",
  rewriting: "Rewriting",
  updated: "Updated",
  removed: "Removed",
  added: "Added",
  failed: "Failed",
};

const INK: Record<RowState, string> = {
  behind: "text-amber-ink",
  rewriting: "text-amber-ink",
  updated: "text-sage-ink",
  removed: "text-muted-slate",
  added: "text-sage-ink",
  failed: "text-clay-ink",
};

const DOT: Record<RowState, string> = {
  behind: "bg-amber-ink",
  rewriting: "bg-amber-ink",
  updated: "bg-sage-ink",
  removed: "bg-faint",
  added: "bg-sage-ink",
  failed: "bg-clay-ink",
};

/** The menu's own row (components/ui/menu.tsx). */
const ROW = "flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[13px] font-medium text-ink outline-none transition-colors duration-100";
const LIVE = "cursor-pointer hover:bg-surface-container focus-visible:bg-surface-container";

/** The list behind the pill, drawn as the app's menus are (components/ui/menu.tsx). */
function UpdatePanel({ v, up, onClose }: { v: UpdateView; up: boolean; onClose: () => void }) {
  const elapsed = useElapsed(v, true);
  const act = (f?: () => void) => () => {
    f?.();
    onClose();
  };
  const note =
    v.phase === "idle"
      ? v.paused
        ? "Turn them on from the Blueprint menu in the status bar."
        : "It follows the code on each commit."
      : v.phase === "behind"
        ? v.paused
          ? "Auto-updates are paused."
          : "It updates when the code is committed."
        : v.phase === "finding"
          ? "Finding the sections the change touches."
          : v.phase === "running"
            ? "Each section changes on the blueprint as it lands."
            : v.phase === "done"
              ? "The blueprint matches the code."
              : "What failed keeps its last version.";
  const actions = [
    v.review ? { label: "See what changed", run: v.review } : null,
    v.update ? { label: v.phase === "failed" ? "Retry" : "Update now", run: v.update } : null,
  ].filter((a): a is { label: string; run: () => void } => a !== null);
  return (
    <div
      role="dialog"
      aria-label="Blueprint update"
      data-chrome
      className={cn(
        "absolute right-0 z-50 w-[300px] animate-[dialog-in_.14s_ease-out] overflow-hidden rounded-md border border-border-gray bg-card p-1 font-sans shadow-lift",
        up ? "bottom-full mb-1.5" : "top-full mt-1.5",
      )}
    >
      <p className="flex items-baseline gap-2 px-2.5 pb-1.5 pt-1 text-[12px] font-medium text-muted-slate">
        <span className="min-w-0 flex-1 truncate">{headline(v)}</span>
        {elapsed ? <span className="shrink-0 tabular-nums">{elapsed}</span> : null}
      </p>
      {v.rows.length ? (
        <div className="max-h-[300px] overflow-y-auto">
          {v.rows.map((r) => {
            const go = r.open;
            return (
              <button
                key={r.id}
                type="button"
                disabled={!go}
                onClick={go ? act(() => goTo(go)) : undefined}
                title={r.trail ? `${r.trail} › ${r.title}` : r.title}
                className={cn(ROW, go ? LIVE : "cursor-default")}
              >
                <Dot className={DOT[r.state]} working={r.state === "rewriting"} />
                <span className="min-w-0 flex-1 truncate">{r.title}</span>
                <span className={cn("shrink-0 text-[12px] font-normal", INK[r.state])}>{WORD[r.state]}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      {v.phase === "failed" && v.error ? (
        <p title={v.error} className="line-clamp-3 px-2.5 py-1.5 text-[12px] leading-snug text-clay-ink">
          {v.error}
        </p>
      ) : null}
      <p className={cn("px-2.5 py-1.5 text-[12px] text-muted-slate", (v.rows.length > 0 || v.error) && "mt-1 border-t border-border-gray pt-2")}>{note}</p>
      {actions.map((a) => (
        <button key={a.label} type="button" onClick={act(a.run)} className={cn(ROW, LIVE)}>
          {a.label}
        </button>
      ))}
    </div>
  );
}
