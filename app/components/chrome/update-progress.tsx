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
  /** behind: code moved and nothing is committed. finding: started, no sections picked yet. */
  phase: "behind" | "finding" | "running" | "done" | "failed";
  rows: UpdateRow[];
  startedAt?: string;
  finishedAt?: string;
  paused?: boolean;
  error?: string;
  update?: () => void;
  review?: () => void;
  dismiss?: () => void;
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
  if (!v || v.phase === "behind" || v.phase === "finding") return null;
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
  behind: "border-border-strong bg-surface text-ink hover:bg-surface-container",
  finding: "border-amber-line bg-amber-surface text-amber-ink",
  running: "border-amber-line bg-amber-surface text-amber-ink",
  done: "border-sage-line bg-sage-surface text-sage-ink",
  failed: "border-clay-line bg-clay-surface text-clay-ink",
} as const;

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
  return (
    <div ref={box} className={cn("relative flex items-center", title ? "mr-1.5" : "mr-1 h-full")}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={v.phase === "behind" ? "The code changed under these sections. The blueprint follows when it is committed." : headline(v)}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "arrive flex shrink-0 cursor-pointer items-center gap-2 border font-medium whitespace-nowrap transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          title ? "h-7 rounded-full px-3 text-[12px]" : "h-[18px] rounded px-2 text-[11px]",
          TONE[v.phase],
        )}
      >
        {v.phase === "behind" ? <span aria-hidden className="size-[7px] shrink-0 rounded-full bg-amber-ink" /> : null}
        {v.phase === "finding" || v.phase === "running" ? <span aria-hidden className="size-[7px] shrink-0 animate-pulse rounded-full bg-current" /> : null}
        {v.phase === "behind" ? (
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
          <span className="font-mono text-[11px] tabular-nums">
            {landed}/{n}
          </span>
        ) : null}
        {v.phase === "done" ? <span className="font-mono text-[11px] tabular-nums">{n}</span> : null}
        {v.phase === "finding" || v.phase === "running" ? <Progress v={v} /> : null}
      </button>
      {open ? <UpdatePanel v={v} up={!title} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

const WORD: Record<RowState, string> = {
  behind: "behind",
  rewriting: "rewriting",
  updated: "updated",
  removed: "removed",
  added: "added",
  failed: "failed",
};

const INK: Record<RowState, string> = {
  behind: "text-faint",
  rewriting: "text-amber-ink",
  updated: "text-sage-ink",
  removed: "text-muted-slate",
  added: "text-sage-ink",
  failed: "text-clay-ink",
};

function Mark({ state }: { state: RowState }) {
  if (state === "rewriting") return <span aria-hidden className="size-[7px] animate-pulse rounded-full bg-amber-ink" />;
  if (state === "behind") return <span aria-hidden className="size-[7px] rounded-full bg-amber-ink" />;
  return (
    <span aria-hidden className={cn("font-mono text-[11px] font-semibold leading-none", INK[state])}>
      {state === "failed" ? "✗" : state === "removed" ? "−" : state === "added" ? "+" : "✓"}
    </span>
  );
}

const ACT = "flex h-6 cursor-pointer items-center rounded px-2.5 text-[12px] font-medium focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";
const PRIMARY = cn(ACT, "bg-accent text-on-accent hover:bg-accent-strong");
const QUIET = cn(ACT, "text-muted-slate hover:bg-surface-container hover:text-ink");

function UpdatePanel({ v, up, onClose }: { v: UpdateView; up: boolean; onClose: () => void }) {
  const elapsed = useElapsed(v, true);
  const act = (f?: () => void) => () => {
    f?.();
    onClose();
  };
  return (
    <div
      role="dialog"
      aria-label="Blueprint update"
      className={cn(
        "absolute right-0 z-50 w-[340px] animate-[dialog-in_.14s_ease-out] overflow-hidden rounded-md border border-border-gray bg-card font-sans shadow-lift",
        up ? "bottom-full mb-1.5" : "top-full mt-1.5",
      )}
    >
      <div className="flex items-baseline justify-between gap-3 border-b border-border-gray px-3.5 pt-3 pb-2.5">
        <span className={cn("text-[13px] font-semibold", v.phase === "done" ? "text-sage-ink" : v.phase === "failed" ? "text-clay-ink" : "text-ink")}>{headline(v)}</span>
        {elapsed ? <span className="font-mono text-[11px] text-faint tabular-nums">{elapsed}</span> : null}
      </div>
      {v.phase === "finding" ? (
        <p className="flex items-center gap-2 px-3.5 py-3 text-[12.5px] text-muted-slate">
          <span aria-hidden className="size-[7px] shrink-0 animate-pulse rounded-full bg-amber-ink" />
          Finding the sections the change touches…
        </p>
      ) : v.rows.length ? (
        <ul className="max-h-[300px] overflow-y-auto py-1">
          {v.rows.map((r) => {
            const go = r.open;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  disabled={!go}
                  onClick={go ? act(() => goTo(go)) : undefined}
                  title={r.trail ? `${r.trail} › ${r.title}` : r.title}
                  className={cn(
                    "grid w-full grid-cols-[14px_minmax(0,1fr)_max-content] items-center gap-2.5 px-3.5 py-1.5 text-left",
                    go && "cursor-pointer hover:bg-surface-container-low focus-visible:bg-surface-container-low focus-visible:outline-none",
                  )}
                >
                  <span className="flex justify-center">
                    <Mark state={r.state} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-medium text-ink">{r.title}</span>
                    {r.trail ? <span className="block truncate text-[11px] text-faint">{r.trail}</span> : null}
                  </span>
                  <span className={cn("font-mono text-[10.5px]", INK[r.state])}>{WORD[r.state]}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {v.phase === "failed" && v.error ? (
        <p title={v.error} className="mx-3.5 mb-2 line-clamp-3 border-l-2 border-clay-line pl-2 font-mono text-[11px] leading-snug text-clay-ink">
          {v.error}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-3 border-t border-border-gray px-3.5 py-2">
        <span className="min-w-0 truncate text-[11.5px] text-muted-slate">
          {v.phase === "behind"
            ? v.paused
              ? "Auto-updates are paused"
              : "Updates when the code is committed"
            : v.phase === "finding" || v.phase === "running"
              ? "Each section changes on the blueprint as it lands"
              : v.phase === "done"
                ? "The blueprint matches the code"
                : "What failed keeps its last version"}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {v.dismiss ? (
            <button type="button" onClick={act(v.dismiss)} className={QUIET}>
              Dismiss
            </button>
          ) : null}
          {v.review ? (
            <button type="button" onClick={act(v.review)} className={PRIMARY}>
              See what changed
            </button>
          ) : null}
          {v.update ? (
            <button type="button" onClick={act(v.update)} className={PRIMARY}>
              {v.phase === "failed" ? "Retry" : "Update now"}
            </button>
          ) : null}
        </span>
      </div>
    </div>
  );
}
