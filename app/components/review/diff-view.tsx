"use client";

import { Fragment, memo, useMemo } from "react";
import { TINT } from "@/components/review/diff";
import type { HunkLines } from "@/lib/client/hunks";
import { startNote, useNotes } from "@/lib/agent/notes";
import type { Target } from "@/lib/agent/context";
import { TOKEN_COLOR, highlight, langOf } from "@/lib/client/highlight";
import { cn } from "@/lib/client/utils";
import { useDesktop } from "@/lib/client/platform";

export type View = "split" | "inline";

/* ── the lines ───────────────────────────────────────────────── */

type Cell = { n: number; text: string; kind: "+" | "-" | " " } | null;

/** A hunk as rows of [old, new]: removals beside the additions that replaced them. */
function pairsOf(h: HunkLines): [Cell, Cell][] {
  const out: [Cell, Cell][] = [];
  const ls = h.lines;
  for (let i = 0; i < ls.length; ) {
    if (ls[i].kind === " ") {
      out.push([{ n: ls[i].old!, text: ls[i].text, kind: " " }, { n: ls[i].new!, text: ls[i].text, kind: " " }]);
      i++;
      continue;
    }
    const del: Cell[] = [];
    const add: Cell[] = [];
    for (; i < ls.length && ls[i].kind === "-"; i++) del.push({ n: ls[i].old!, text: ls[i].text, kind: "-" });
    for (; i < ls.length && ls[i].kind === "+"; i++) add.push({ n: ls[i].new!, text: ls[i].text, kind: "+" });
    for (let k = 0; k < Math.max(del.length, add.length); k++) out.push([del[k] ?? null, add[k] ?? null]);
  }
  return out;
}

const BG = { "+": TINT.added.surface, "-": TINT.removed.surface, " ": undefined };
// Where one side has no line, the other's is not stretched to meet it.
const FILLER = "repeating-linear-gradient(-45deg, transparent 0 5px, var(--color-border-gray) 5px 6px)";

/**
 * The unchanged lines between two hunks, as one row both sides share. On the
 * side that carries it, the hunk below can be commented on, for the review
 * (components/review/review-tray.tsx).
 */
function Gap({ h, prev, path }: { h: HunkLines; prev?: HunkLines; path?: string }) {
  const end = prev ? Math.max(...prev.lines.map((l) => l.old ?? 0), prev.oldStart - 1) : 0;
  const n = h.oldStart - end - 1;
  const noted = useNotes().some((x) => x.status === "draft" && x.anchor.key === (path ? hunkKey(path, h) : ""));
  // The tray the note goes to is the desktop app's only: in a browser the click would do nothing.
  const desktop = useDesktop();
  return (
    <div className="sticky left-0 flex h-6 w-max items-center gap-3 bg-surface-container-low px-3 font-sans text-[10.5px] leading-6 text-faint">
      <span>{n > 0 ? `⋯ ${n} unchanged ${n === 1 ? "line" : "lines"}` : "⋯"}</span>
      {path && desktop ? (
        <button
          type="button"
          onClick={(e) => startNote({ x: e.clientX, y: e.clientY + 12, anchor: hunkTarget(path, h) })}
          className="cursor-pointer text-accent hover:underline"
        >
          {noted ? "✎ commented — add another" : "✎ Comment on this change"}
        </button>
      ) : null}
    </div>
  );
}

const hunkKey = (path: string, h: HunkLines) => `hunk:${path}:${h.oldStart}:${h.newStart}`;

/** A hunk as Claude reads it in a review: where it is, and the lines, as a unified diff. */
function hunkTarget(path: string, h: HunkLines): Target {
  const news = h.lines.filter((l) => l.new !== undefined).map((l) => l.new!);
  const span = news.length ? `${Math.min(...news)}-${Math.max(...news)}` : `${h.newStart}`;
  const CAP = 80;
  const lines = h.lines.slice(0, CAP).map((l) => `${l.kind}${l.text}`);
  if (h.lines.length > CAP) lines.push(`… ${h.lines.length - CAP} more lines`);
  return {
    key: hunkKey(path, h),
    title: `${path}:${span}`,
    text: [`[Diff hunk: ${path}, now lines ${span}`, "```diff", ...lines, "```]"].join("\n"),
  };
}

function Code({ text, lang }: { text: string; lang: ReturnType<typeof langOf> }) {
  return (
    <code className="whitespace-pre pr-4 text-code-plain">
      {text
        ? highlight(text, lang)[0].map((t, k) => (
            <span key={k} style={{ color: TOKEN_COLOR[t.kind] }}>
              {t.text}
            </span>
          ))
        : " "}
    </code>
  );
}

// Memoised, as is InlineDiff: every line is highlighted as it is drawn, and
// typing in the commit filter re-renders the whole panel around an open file.
export const SplitDiff = memo(function SplitDiff({ hunks, path }: { hunks: HunkLines[]; path: string }) {
  const lang = langOf(path);
  const rows = useMemo(() => hunks.map(pairsOf), [hunks]);
  // Each side scrolls sideways on its own, as two editors would; rows are one
  // fixed height so the two stay level without measuring.
  const side = (s: 0 | 1) => (
    <div className={cn("min-w-0 flex-1 overflow-x-auto", s === 1 && "border-l border-border-gray")}>
      <div className="w-max min-w-full font-mono text-[12px]">
        {hunks.map((h, i) => (
          <Fragment key={i}>
            <Gap h={h} prev={hunks[i - 1]} path={s === 1 ? path : undefined} />
            {rows[i].map((r, j) => {
              const c = r[s];
              return (
                <div key={j} className="flex h-5 leading-5" style={{ background: c ? BG[c.kind] : FILLER }}>
                  <span className="tnum w-11 shrink-0 select-none pr-2 text-right text-faint">{c?.n ?? ""}</span>
                  <span className="w-4 shrink-0 select-none text-center" style={{ color: c?.kind === "+" ? TINT.added.ink : TINT.removed.ink }}>
                    {c?.kind === "+" ? "+" : c?.kind === "-" ? "−" : ""}
                  </span>
                  {c ? <Code text={c.text} lang={lang} /> : null}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
  return (
    <div className="flex">
      {side(0)}
      {side(1)}
    </div>
  );
});

export const InlineDiff = memo(function InlineDiff({ hunks, path }: { hunks: HunkLines[]; path: string }) {
  const lang = langOf(path);
  return (
    <div className="overflow-x-auto">
      <div className="w-max min-w-full font-mono text-[12px]">
        {hunks.map((h, i) => (
          <Fragment key={i}>
            <Gap h={h} prev={hunks[i - 1]} path={path} />
            {h.lines.map((l, j) => (
              <div key={j} className="flex h-5 leading-5" style={{ background: BG[l.kind] }}>
                <span className="tnum w-11 shrink-0 select-none pr-2 text-right text-faint">{l.old ?? ""}</span>
                <span className="tnum w-11 shrink-0 select-none pr-2 text-right text-faint">{l.new ?? ""}</span>
                <span className="w-4 shrink-0 select-none text-center" style={{ color: l.kind === "+" ? TINT.added.ink : TINT.removed.ink }}>
                  {l.kind === "+" ? "+" : l.kind === "-" ? "−" : ""}
                </span>
                <Code text={l.text} lang={lang} />
              </div>
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
});
