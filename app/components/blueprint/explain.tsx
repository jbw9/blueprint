"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/client/utils";
import { Eyebrow, Prose } from "@/components/ui/state";
import { Button } from "@/components/ui/button";
import { Overlay, DIALOG } from "@/components/ui/dialog";
import { AnatomyView, type RowCtx } from "@/components/blueprint/anatomy";
import { SourceView } from "@/components/blueprint/source-view";
import { ExplainedBlock, isExplained } from "@/components/blueprint/blocks";
import { Hunks, useDiff } from "@/components/review/diff";
import { useBlueprint } from "@/components/blueprint/blueprint-context";
import { goTo, useLocation } from "@/components/chrome/crumbs";
import { useCitations, useTrail } from "@/components/blueprint/files";
import { nodesAt } from "@/lib/blueprint/coverage";
import { hunksOf, type HunkLines } from "@/lib/client/hunks";
import { readSource } from "@/lib/blueprint/source";
import type { Slice } from "@/lib/server/repo";
import type { Anatomy, Explainer as ExplainerData } from "@/lib/blueprint/schema";

/* ── one level, in plain words ───────────────────────────────── */

/**
 * An explainer's picture draws the idea, not the code, so it makes no claim to
 * be uncertain about: a row the generator left without a `state` would
 * otherwise render as "not certain".
 */
function settled(b: Anatomy): Anatomy {
  const rows = "rows" in b ? (b.rows as unknown[]).map((r) => (r && typeof r === "object" && !Array.isArray(r) ? { state: "derived", ...r } : r)) : undefined;
  return { ...b, ...(rows ? { rows } : {}), ...(b.kind === "table" ? { state: b.state ?? "derived" } : {}) } as Anatomy;
}

/**
 * The pictures of the level said again for someone new to the project and its
 * field (`Node.explain`). Its prose stands in for the header's detail instead,
 * since the two said the same thing twice. Set apart by a green rule, so it
 * reads as a gloss on the level rather than more of it.
 */
export function Explainer({ owner, explain, ctx }: { owner: string; explain: ExplainerData; ctx: RowCtx }) {
  if (!explain.blocks?.length) return null;
  return (
    <section data-pick="In plain words" className="border-l-2 border-accent-line pl-5">
      <Eyebrow className="text-accent">In plain words</Eyebrow>
      {explain.blocks.map(settled).map((b, i) => (
        <div key={i} className={i ? "mt-6" : "mt-3"}>
          {isExplained(b) ? (
            <div className={b.kind === "diagram" ? "" : "max-w-[1100px]"}>
              <ExplainedBlock block={b} />
            </div>
          ) : (
            <div className="max-w-[900px] [zoom:1.18]">
              <AnatomyView owner={`${owner}@explain${i}`} blocks={[b]} ctx={ctx} />
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

/* ── code, opened from what explains it ──────────────────────── */

/** What the code popup shows: the thing clicked, and the lines behind it. */
export interface CodeFocus {
  heading: string;
  detail?: string;
  refs: { file: string; start: number; end: number; label?: string }[];
  /** The level's own verification, for the level's code; a step's lines were not checked on their own. */
  verified?: { claims: number; corrected: number };
}

/** `file:start-end` or `file:line`, as a step's `at` cites it. */
export function parseAt(at: string): { file: string; start: number; end: number } | null {
  const m = /^(.+):(\d+)(?:-(\d+))?$/.exec(at);
  return m ? { file: m[1], start: +m[2], end: +(m[3] ?? m[2]) } : null;
}

/**
 * The lines behind one step (or one leaf), over the page. It opens with where
 * it belongs — the trail down to this level and the step's own words — so the
 * code never arrives without the sentence that explains it.
 */
export function CodePopup({
  focus,
  trail,
  owner,
  ctx,
  onClose,
}: {
  focus: CodeFocus;
  trail: string[];
  owner: string;
  ctx: RowCtx;
  onClose: () => void;
}) {
  return (
    <Overlay onClose={onClose}>
      <div role="dialog" aria-label={focus.heading} className={cn(DIALOG, "max-w-[1060px]")}>
        <div className="border-b border-border-gray px-5 pb-4 pt-3.5">
          <div className="flex items-center gap-3">
            <p className="min-w-0 flex-1 truncate text-[12px] text-faint">{trail.join(" › ")}</p>
            <Button variant="ghost" size="sm" onClick={onClose} title="Close (Esc)">
              ✕
            </Button>
          </div>
          <p className="mt-1.5 text-[17px] font-semibold tracking-[-0.01em] text-ink">{focus.heading}</p>
          {focus.detail ? (
            <p className="mt-1 max-w-[760px] text-[13.5px] leading-relaxed text-on-surface-variant">
              <Prose text={focus.detail} />
            </p>
          ) : null}
          {focus.verified ? (
            <p className="mt-2 text-[12px] text-faint">
              {focus.verified.claims === 1 ? "The one claim" : `All ${focus.verified.claims} claims`} on this level were checked against these lines by a second model
              {focus.verified.corrected ? ` · ${focus.verified.corrected} ${focus.verified.corrected === 1 ? "was" : "were"} corrected` : ""}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-5 overflow-y-auto p-5">
          {focus.refs.map((r) => (
            <div key={`${r.file}:${r.start}`}>
              <p className="mb-2 flex items-baseline gap-3">
                {r.label ? <span className="text-[13.5px] text-ink">{r.label}</span> : null}
                <span className="ml-auto font-mono text-[11px] text-faint">
                  {r.file}:{r.start === r.end ? r.start : `${r.start}–${r.end}`}
                </span>
              </p>
              <ChangedHere file={r.file} start={r.start} end={r.end} />
              <AlsoExplained file={r.file} start={r.start} end={r.end} onGo={onClose} />
              <CodeSlice owner={owner} file={r.file} start={r.start} end={r.end} ctx={ctx} />
            </div>
          ))}
        </div>
      </div>
    </Overlay>
  );
}

/**
 * In diff mode, the hunks that landed on these lines, above the code as it is
 * now: the answer to "what did that commit do here". Lines are matched where
 * the diff starts, so a ref the server carried to another commit
 * (lib/server/diff.ts `blueprintDiff`) is matched where it was carried to.
 */
function ChangedHere({ file, start, end }: { file: string; start: number; end: number }) {
  const diff = useDiff()?.diff;
  const change = diff?.files.find((f) => (f.mapped ?? f.path) === file);
  if (!diff || !change) return null;
  const cited = diff.sections.flatMap((s) => s.files.filter((f) => f.path === file).flatMap((f) => f.lines));
  const span = cited.find((l) => l.s === start && l.e === end)?.at ?? { s: start, e: end };
  const near = (h: HunkLines) => {
    const old = h.lines.map((l) => l.old ?? h.oldStart);
    return Math.min(...old) <= span.e && Math.max(...old) >= span.s;
  };
  if (!hunksOf(change.diff).some(near)) return null;
  return (
    <div className="mb-3">
      <p className="mb-1 text-[12px] font-medium text-muted-slate">What changed here — red is gone, green is new</p>
      <Hunks file={change} only={near} />
    </div>
  );
}

/**
 * Other levels that open these same lines: a function shared by two features
 * is explained where each one uses it, and a reader on one should know the
 * other exists rather than find it by chance.
 */
function AlsoExplained({ file, start, end, onGo }: { file: string; start: number; end: number; onGo: () => void }) {
  const cited = useCitations();
  const trail = useTrail();
  const here = useLocation().path.join("/");
  const others = [...new Map(nodesAt(cited, file, start, end).filter((c) => c.path.join("/") !== here).map((c) => [c.path.join("/"), c.path])).values()];
  if (!others.length) return null;
  return (
    <p className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[12px]">
      <span className="text-faint">Also explained in</span>
      {others.slice(0, 4).map((p) => (
        <button key={p.join("/")} type="button" onClick={() => (goTo(p), onGo())} className="cursor-pointer text-accent hover:underline">
          {trail(p)}
        </button>
      ))}
    </p>
  );
}

function CodeSlice({ owner, file, start, end, ctx }: { owner: string; file: string; start: number; end: number; ctx: RowCtx }) {
  const { name: blueprint } = useBlueprint();
  const [slice, setSlice] = useState<Slice | null | "failed">(null);
  useEffect(() => {
    const ac = new AbortController();
    readSource({ blueprint, file, start, end }, ac.signal)
      .then((r) => !ac.signal.aborted && setSlice("slice" in r ? r.slice : "failed"))
      .catch(() => !ac.signal.aborted && setSlice("failed"));
    return () => ac.abort();
  }, [blueprint, file, start, end]);
  if (slice === "failed") return <p className="text-[12.5px] text-clay-ink">Could not read this file from the repository.</p>;
  if (!slice) return <p className="text-[12.5px] text-faint">Reading…</p>;
  return <SourceView owner={`${owner}@${file}:${start}`} block={{ kind: "source", file, start: slice.start, code: slice.code }} ctx={ctx} />;
}
