"use client";

import { useState } from "react";
import { cn } from "@/lib/client/utils";
import { StateChip } from "@/components/ui/state";
import { rowId, type Anatomy } from "@/lib/bluprint/schema";
import type { RowCtx } from "@/components/bluprint/anatomy";
import { rowClass } from "@/components/bluprint/anatomy/layout";
import { Caret } from "@/components/bluprint/anatomy/glyphs";

/**
 * A `bluprint` block as a list of names. Each row's `to` stays folded until the
 * reader asks for it, so the block reads as the set of cases first and the
 * detail of one case second, instead of a wall of arrows.
 */
export function MapRows({ owner, block, ctx }: { owner: string; block: Extract<Anatomy, { kind: "map" }>; ctx: RowCtx }) {
  const [shown, setShown] = useState<Set<string>>(() => new Set());
  const toggle = (from: string) =>
    setShown((s) => {
      const next = new Set(s);
      if (!next.delete(from)) next.add(from);
      return next;
    });
  return (
    <div className="overflow-hidden border border-border-gray bg-card">
      {block.caption ? (
        <div className="border-b border-border-gray bg-surface px-3 py-1.5">
          <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-faint">
            {block.caption}
          </span>
        </div>
      ) : null}
      {block.rows.map((m) => {
        const id = rowId(owner, m.from);
        const isLit = ctx.traced === id;
        const isOpen = ctx.open === id;
        // A row with a level of its own shows its detail while that level is open.
        const expanded = shown.has(m.from) || isOpen;
        return (
          <div key={m.from} className="border-b border-border-gray last:border-b-0">
            <button
              data-row={id}
              aria-expanded={expanded}
              // The card wrapping these rows is itself clickable, and a real
              // pointer click bubbles: without stopping it here, the card's
              // handler fires on the SAME click and undoes the row's.
              onClick={(e) => {
                e.stopPropagation();
                if (m.under) return ctx.onOpenRow(id);
                toggle(m.from);
                ctx.onTrace(id);
              }}
              className={rowClass(id, ctx, "flex w-full items-start gap-2 px-3 py-1.5 text-left")}
            >
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "inline-block px-1.5 py-0.5 font-mono text-[10px]",
                    isLit || isOpen ? "bg-accent text-on-accent" : "bg-surface-container text-on-surface",
                  )}
                >
                  {m.from}
                </span>
                {m.state !== "derived" ? <StateChip state={m.state} className="ml-1.5 align-[1px]" /> : null}
                {expanded ? (
                  <span
                    className={cn(
                      "mt-1.5 mb-0.5 block border-l-2 pl-2 font-mono text-[9.5px] leading-snug",
                      m.state === "derived" ? "border-border-strong text-muted-slate" : "border-amber-line text-amber-ink",
                    )}
                  >
                    {m.to}
                  </span>
                ) : null}
              </span>
              {/* Turns down when the row unfolds in place; a row that opens a
                  level points right like every other way down. */}
              <span className={cn("mt-[3px] shrink-0 transition-transform duration-200", expanded && !m.under && "rotate-90")}>
                <Caret open={expanded} />
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
