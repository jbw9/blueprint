"use client";

import { cn } from "@/lib/client/utils";
import { StateChip } from "@/components/ui/state";
import { rowId, type Anatomy } from "@/lib/map/schema";
import type { RowCtx } from "@/components/map/anatomy";

export function PartsBlock({
  owner,
  block,
  ctx,
}: {
  owner: string;
  block: Extract<Anatomy, { kind: "parts" }>;
  ctx: RowCtx;
}) {
  // The ratio IS the finding. Segments are sized by real weight, so a 149KB
  // block next to a 1KB one looks like what it is — no amount of prose makes
  // that land the way a length does.
  const total = block.rows.reduce((sum, p) => sum + p.weight, 0) || 1;
  return (
    <div className="overflow-hidden border border-border-gray bg-card">
      <div className="flex items-center gap-2 border-b border-border-gray bg-surface px-3 py-1.5">
        <span className="font-mono text-[11px] font-semibold text-ink">
          {block.total}
        </span>
        <span className="ml-auto font-mono text-[10px] text-faint">
          {block.rows.length} parts
        </span>
      </div>
      <div className="px-3 pb-2.5 pt-2.5">
        <div className="flex h-[22px] w-full overflow-hidden">
          {block.rows.map((p, at) => {
            const id = rowId(owner, p.label);
            const isLit = ctx.traced === id;
            return (
              <button
                key={p.label}
                data-row={id}
                onClick={() => ctx.onTrace(id)}
                title={`${p.label} — ${p.display}`}
                // Floored at 6%: a slice worth naming has to be visible, and
                // a 1%-of-the-whole block rendered ~2px wide — present in the
                // DOM, absent to the eye. The exact figure is in the legend;
                // the bar's job is the contrast, not the arithmetic.
                style={{ width: `${Math.max((p.weight / total) * 100, 6)}%` }}
                className={cn(
                  "h-full border-r border-card transition-[background-color,opacity] duration-150 last:border-r-0",
                  ctx.traced !== null && !isLit && "opacity-45",
                  isLit
                    ? "bg-accent"
                    : p.tone === "vary"
                      ? "bg-amber-line"
                      : // Alternating weights within the same family. Every
                        // "hold" slice sharing one mint made a 198px and a
                        // 33px segment read as a single bar with a hairline
                        // seam — measured, not guessed. The ratio only lands
                        // if adjacent slices are separable.
                        at % 2 === 0
                        ? "bg-accent/55"
                        : "bg-accent-line",
                )}
              />
            );
          })}
        </div>
        {/* Legend, not a table: label and size on one line each. */}
        <ul className="mt-2 flex flex-col gap-1">
          {block.rows.map((p, at) => {
            const id = rowId(owner, p.label);
            const isLit = ctx.traced === id;
            return (
              <li key={p.label} className="flex items-center gap-2">
                <span
                  // Same tone rule as the bar segment above, index included.
                  // A swatch is only a key if it is the colour it explains.
                  className={cn(
                    "size-[7px] shrink-0",
                    isLit
                      ? "bg-accent"
                      : p.tone === "vary"
                        ? "bg-amber-line"
                        : at % 2 === 0
                          ? "bg-accent/55"
                          : "bg-accent-line",
                  )}
                />
                <span
                  className={cn(
                    // `min-w-0` so a long label wraps instead of shoving the
                    // figure past the right edge. The figure stays `shrink-0`
                    // because it is short and is the thing being compared.
                    "min-w-0 font-mono text-[10px]",
                    isLit ? "font-semibold text-accent" : "text-on-surface",
                  )}
                >
                  {p.label}
                </span>
                <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-slate">
                  {p.display}
                </span>
                <StateChip state={p.state} />
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
