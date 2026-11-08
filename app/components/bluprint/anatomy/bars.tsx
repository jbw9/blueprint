"use client";

import { cn } from "@/lib/client/utils";
import { StateChip } from "@/components/ui/state";
import { rowId, type Anatomy } from "@/lib/bluprint/schema";
import type { RowCtx } from "@/components/bluprint/anatomy";
import { PAIR_LABEL, PAIR_ROW, PAIR_SCOPE, PAIR_VALUE, rowClass } from "@/components/bluprint/anatomy/layout";

export function BarsBlock({
  owner,
  block,
  ctx,
}: {
  owner: string;
  block: Extract<Anatomy, { kind: "bars" }>;
  ctx: RowCtx;
}) {
  // Comparison, not enumeration. Bars share one scale so the 250x gap
  // between an anonymous and a premium quota is visible rather than stated.
  const max = Math.max(...block.rows.map((b) => b.value), 1);
  return (
    <div className="overflow-hidden border border-border-gray bg-card">
      <div className="flex items-center gap-2 border-b border-border-gray bg-surface px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-faint">
          {block.unit}
        </span>
      </div>
      <div className="flex flex-col gap-1.5 px-3 py-2.5">
        {block.rows.map((b) => {
          const id = rowId(owner, b.label);
          const isLit = ctx.traced === id;
          return (
            <button
              key={b.label}
              data-row={id}
              onClick={() => ctx.onTrace(id)}
              className={rowClass(id, ctx, cn(PAIR_SCOPE, ""))}
            >
              {/* The label was `w-[92px]` and the figure `w-[108px]`: 200px
                  of fixed furniture either side of the bar, so on a narrow
                  card the TRACK — the only part that carries the comparison
                  — was what collapsed. Both are capped shares now, and the
                  pair stacks before the bar can be squeezed out. */}
              <span className={PAIR_ROW}>
                <span
                  className={cn(
                    PAIR_LABEL,
                    "truncate font-mono text-[10px]",
                    isLit ? "font-semibold text-accent" : "text-on-surface",
                  )}
                >
                  {b.label}
                </span>
                <span className={cn(PAIR_VALUE, "flex items-center gap-2")}>
                  {/* The track is the scale. Without it a short bar reads as
                      a small number rather than a small share. */}
                  <span className="h-[9px] min-w-0 flex-1 bg-surface-container">
                    <span
                      style={{ width: `${Math.max((b.value / max) * 100, 2)}%` }}
                      className={cn(
                        "block h-full transition-[background-color] duration-150",
                        isLit
                          ? "bg-accent"
                          : b.state === "derived"
                            ? "bg-accent-line"
                            : "bg-amber-line",
                      )}
                    />
                  </span>
                  <span className="shrink-0 text-right font-mono text-[9.5px] text-muted-slate">
                    {b.display}
                  </span>
                  <StateChip state={b.state} />
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
