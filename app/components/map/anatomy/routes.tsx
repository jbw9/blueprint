"use client";

import { cn } from "@/lib/client/utils";
import { StateChip } from "@/components/ui/state";
import { rowId, type Anatomy } from "@/lib/map/schema";
import type { RowCtx } from "@/components/map/anatomy";
import { PAIR_LABEL, PAIR_ROW, PAIR_SCOPE, PAIR_VALUE, rowClass } from "@/components/map/anatomy/layout";
import { Method } from "@/components/map/anatomy/glyphs";

export function RoutesBlock({
  owner,
  block,
  ctx,
}: {
  owner: string;
  block: Extract<Anatomy, { kind: "routes" }>;
  ctx: RowCtx;
}) {
  return (
    <div className="overflow-hidden border border-border-gray bg-card">
      {block.rows.map((r) => {
        const id = rowId(owner, `${r.method} ${r.path}`);
        const isLit = ctx.traced === id;
        return (
          <button
            key={r.method + r.path}
            data-row={id}
            onClick={() => ctx.onTrace(id)}
            className={rowClass(
              id,
              ctx,
              cn(PAIR_SCOPE, "block border-b border-border-gray px-3 py-1.5 last:border-b-0"),
            )}
          >
            {/* The method is the label; the path is the answer, and it was
                `truncate` — so the one string a reader needs in full was the
                first thing cut. It wraps now, and the auth note drops to its
                own line before the path has to give up any width. */}
            <span className={PAIR_ROW}>
              <span className={cn(PAIR_LABEL, "flex items-center gap-2")}>
                <Method method={r.method} />
                <span
                  className={cn(
                    "min-w-0 font-mono text-[10.5px] break-all",
                    isLit ? "font-semibold text-accent" : "text-on-surface",
                  )}
                >
                  {r.path}
                </span>
              </span>
              <span className={cn(PAIR_VALUE, "flex items-start gap-2")}>
                <span className="min-w-0 flex-1 font-mono text-[9.5px] leading-snug text-faint @min-[267px]:text-right">
                  {r.auth}
                </span>
                <StateChip state={r.state} />
              </span>
            </span>
            {r.note ? (
              <span
                className={cn(
                  "mt-0.5 block pl-[46px] text-[10px] leading-snug",
                  r.state === "derived" ? "text-faint" : "text-amber-ink",
                )}
              >
                {r.note}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
