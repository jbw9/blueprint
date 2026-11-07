"use client";

import { cn } from "@/lib/client/utils";
import { StateChip } from "@/components/ui/state";
import { rowId, type Anatomy } from "@/lib/map/schema";
import type { RowCtx } from "@/components/map/anatomy";
import { rowClass } from "@/components/map/anatomy/layout";
import { Caret } from "@/components/map/anatomy/glyphs";

export function FlowBlock({
  owner,
  block,
  ctx,
}: {
  owner: string;
  block: Extract<Anatomy, { kind: "flow" }>;
  ctx: RowCtx;
}) {
  return (
    <ol className="flex flex-col">
      {block.rows.map((s, i) => {
        const id = rowId(owner, s.n);
        const isLit = ctx.traced === id;
        return (
          <li key={s.n} className="flex gap-2.5">
            {/* The rail: a numbered dot with a line to the next step, so the
                sequence reads as one path rather than four cards. */}
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  "flex size-[18px] shrink-0 items-center justify-center rounded-full border font-mono text-[9px] font-semibold transition-colors",
                  isLit
                    ? "border-accent bg-accent text-on-accent"
                    : s.state === "derived"
                      ? "border-accent-line bg-accent-surface text-accent"
                      : "border-amber-line bg-amber-surface text-amber-ink",
                )}
              >
                {s.n}
              </span>
              {i < block.rows.length - 1 ? (
                <span className="w-px flex-1 bg-border-gray" />
              ) : null}
            </div>
            <button
              data-row={id}
              data-code-step={s.at && ctx.onStepCode ? "" : undefined}
              // See the map row above: the click must not reach the card.
              onClick={(e) => {
                if (s.at && ctx.onStepCode) {
                  e.stopPropagation();
                  return ctx.onStepCode(s.at, `Step ${s.n} · ${s.title}`, s.detail);
                }
                if (!s.under) return ctx.onTrace(id);
                e.stopPropagation();
                ctx.onOpenRow(id);
              }}
              className={rowClass(
                id,
                ctx,
                cn(
                  "min-w-0 flex-1 px-1.5 py-0.5",
                  i < block.rows.length - 1 && "mb-2.5",
                ),
              )}
            >
              <span className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "text-[11px] font-semibold leading-tight",
                    isLit || ctx.open === id ? "text-accent" : "text-ink",
                  )}
                >
                  {s.title}
                </span>
                <StateChip state={s.state} />
                {s.at && ctx.onStepCode ? (
                  <span className="ml-auto shrink-0 font-mono text-[9px] text-faint" title="Show the code for this step">
                    {"</>"}
                  </span>
                ) : null}
                {s.under ? (
                  <span className="ml-auto">
                    <Caret open={ctx.open === id} />
                  </span>
                ) : null}
              </span>
              {/* A step that has somewhere to go shows its TITLE and nothing
                  else. Its `detail` is the level behind the click, and
                  printing it here painted the next level onto this one — 226
                  words on this card alone, measured, of which four paragraphs
                  were the four children it already had.

                  A step with no `under` keeps its line, because for that row
                  there is no deeper level to defer to and the sentence is the
                  whole fact. */}
              {s.under ? null : (
                <span className="mt-0.5 block text-[10px] leading-relaxed text-on-surface-variant">
                  {s.detail}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
