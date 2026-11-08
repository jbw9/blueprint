"use client";

import { cn } from "@/lib/client/utils";
import { rowId, type Anatomy } from "@/lib/bluprint/schema";
import type { RowCtx } from "@/components/bluprint/anatomy";

export function ChipsBlock({
  owner,
  block,
  ctx,
}: {
  owner: string;
  block: Extract<Anatomy, { kind: "chips" }>;
  ctx: RowCtx;
}) {
  return (
    <div className=" border border-border-gray bg-card px-3 py-2.5">
      {block.caption ? (
        <p className="mb-2 font-mono text-[9.5px] uppercase tracking-[0.08em] text-faint">
          {block.caption}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {block.rows.map((c) => {
          const id = rowId(owner, c.label);
          const isLit = ctx.traced === id;
          return (
            <button
              key={c.label}
              data-row={id}
              onClick={() => ctx.onTrace(id)}
              title={c.note}
              className={cn(
                " border px-2 py-1 font-mono text-[10px] transition-[background-color,border-color,color,opacity] duration-150",
                ctx.traced !== null && !isLit && "opacity-55",
                isLit
                  ? "border-accent bg-accent text-on-accent"
                  : c.state === "derived"
                    ? "border-accent-line bg-accent-surface text-accent"
                    : "border-amber-line bg-amber-surface text-amber-ink",
              )}
            >
              {c.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
