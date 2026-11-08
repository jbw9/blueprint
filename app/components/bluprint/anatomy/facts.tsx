"use client";

import { cn } from "@/lib/client/utils";
import { StateChip } from "@/components/ui/state";
import { rowId, type Anatomy } from "@/lib/bluprint/schema";
import type { RowCtx } from "@/components/bluprint/anatomy";
import { PAIR_LABEL, PAIR_ROW, PAIR_SCOPE, PAIR_VALUE, rowClass } from "@/components/bluprint/anatomy/layout";

export function Facts({
  owner,
  block,
  ctx,
}: {
  owner: string;
  block: Extract<Anatomy, { kind: "facts" }>;
  ctx: RowCtx;
}) {

  return (
    <div className="overflow-hidden border border-border-gray bg-card">
      {block.rows.map((p) => {
        const id = rowId(owner, p.label);
        const isLit = ctx.traced === id;
        return (
          <button
            key={p.label}
            data-row={id}
            onClick={() => ctx.onTrace(id)}
            className={rowClass(
              id,
              ctx,
              cn(PAIR_SCOPE, "border-b border-border-gray px-3 py-1.5 last:border-b-0"),
            )}
          >
            <span className={PAIR_ROW}>
              <span
                className={cn(
                  PAIR_LABEL,
                  "font-mono text-[10.5px]",
                  isLit ? "font-semibold text-accent" : "text-on-surface",
                )}
              >
                {p.label}
              </span>
              {/* Left-aligned: right-aligning a long value in a narrow column
                  produces a ragged staircase of 3-4 wrapped lines. */}
              <span className={cn(PAIR_VALUE, "flex items-start gap-2")}>
                <span
                  className={cn(
                    "min-w-0 flex-1 text-[10px] leading-snug",
                    p.state === "derived" ? "text-muted-slate" : "text-amber-ink",
                  )}
                >
                  {p.value}
                </span>
                <StateChip state={p.state} />
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
