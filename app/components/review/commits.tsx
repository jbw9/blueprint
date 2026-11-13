"use client";

import { TINT, WORD } from "@/components/review/diff";
import { cn } from "@/lib/client/utils";
import type { FileChange, Verdict } from "@/lib/server/diff";

/* ── the history list ────────────────────────────────────────── */

export const STATUS: Record<Exclude<Verdict, "untouched">, string> = { changed: "M", added: "A", removed: "D" };

export function Row({
  on,
  soft,
  onPick,
  title,
  children,
}: {
  on: boolean;
  soft?: boolean;
  onPick: (e: React.MouseEvent) => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="option"
      aria-selected={on}
      data-active={on}
      title={title}
      onClick={onPick}
      className={cn(
        "group relative flex cursor-pointer select-none items-stretch gap-2 pr-3",
        on ? "bg-accent/15" : soft ? "bg-accent/[0.06]" : "hover:bg-surface-container-low/60",
      )}
    >
      {children}
    </div>
  );
}

/**
 * The line the history hangs on, one segment per row. `on` is a picked
 * commit; `merge` a commit with two parents, drawn on its first parent's line.
 */
export function Rail({ dot, first, last }: { dot?: "on" | "off" | "merge"; first?: boolean; last?: boolean }) {
  return (
    <span aria-hidden className="relative w-6 shrink-0">
      <span className={cn("absolute left-1/2 w-px -translate-x-1/2 bg-border-strong", first ? "top-[15px]" : "top-0", last ? "h-[15px]" : "bottom-0")} />
      {dot ? (
        <span
          className={cn(
            "absolute left-1/2 top-[11px] size-[9px] -translate-x-1/2 rounded-full border-2",
            dot === "merge" ? "size-[11px] border-double border-[3px] border-accent bg-card" : "border-accent",
            dot === "on" ? "bg-accent" : dot === "off" ? "bg-card" : undefined,
          )}
        />
      ) : null}
    </span>
  );
}

function Name({ path, flat, gone }: { path: string; flat?: boolean; gone?: boolean }) {
  const cut = path.lastIndexOf("/");
  const dir = cut > 0 ? path.slice(0, cut) : "";
  return (
    <span className={cn("min-w-0 flex-1 truncate py-[3px] text-[12px]", !flat && "pl-3")}>
      <span className={cn("text-ink", gone && "line-through")}>{path.slice(cut + 1)}</span>
      {dir ? <span className="ml-1.5 text-[11px] text-faint">{dir}</span> : null}
    </span>
  );
}

/** A file the commit names while its diff is still being read: the same row, dimmed, so nothing moves when it arrives. */
export function PendingFileRow({ path, last, flat }: { path: string; last?: boolean; flat?: boolean }) {
  return flat ? (
    <div className="flex items-center gap-2 border-b border-border-gray px-3 py-1 opacity-50 last:border-b-0">
      <Name path={path} flat />
    </div>
  ) : (
    <div className="flex items-stretch gap-2 pr-3 opacity-50">
      <Rail last={last} />
      <Name path={path} />
    </div>
  );
}

/** A changed file as a row: name, folder, line counts and its M/A/D letter. */
export function FileRow({ file, on, last, flat, onPick }: { file: FileChange; on?: boolean; last?: boolean; flat?: boolean; onPick: () => void }) {
  const t = TINT[file.verdict];
  const body = (
    <>
      <Name path={file.path} flat={flat} gone={file.verdict === "removed"} />
      <span className="tnum shrink-0 font-mono text-[10.5px]">
        <span style={{ color: TINT.added.ink }}>+{file.added}</span> <span style={{ color: TINT.removed.ink }}>−{file.removed}</span>
      </span>
      <span className="w-3 shrink-0 text-center font-mono text-[11px] font-semibold" style={{ color: t.ink }} title={WORD[file.verdict]}>
        {STATUS[file.verdict]}
      </span>
    </>
  );
  if (flat) {
    return (
      <button
        type="button"
        onClick={onPick}
        className="flex w-full cursor-pointer items-center gap-2 border-b border-border-gray px-3 py-1 text-left last:border-b-0 hover:bg-surface-container-low focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      >
        {body}
      </button>
    );
  }
  return (
    <Row on={!!on} onPick={onPick} title={file.path}>
      <Rail last={last} />
      {body}
    </Row>
  );
}
