"use client";

import { cn } from "@/lib/client/utils";
import { StateChip } from "@/components/ui/state";
import { rowId, type Anatomy } from "@/lib/bluprint/schema";
import type { RowCtx } from "@/components/bluprint/anatomy";
import { SCHEMA_ROW, rowClass } from "@/components/bluprint/anatomy/layout";
import { KeyTag, TableGlyph } from "@/components/bluprint/anatomy/glyphs";

export function SchemaBlock({
  owner,
  block,
  ctx,
  headless,
}: {
  owner: string;
  block: Extract<Anatomy, { kind: "schema" }>;
  ctx: RowCtx;
  headless?: boolean;
}) {
  return (
    <div className={headless ? "bg-card" : "overflow-hidden border border-border-gray bg-card"}>
      <div className={cn("flex items-center gap-2 border-b border-border-gray bg-surface px-3 py-1.5", headless && "hidden")}>
        <TableGlyph />
        <span className="font-mono text-[11px] font-semibold text-ink">
          {block.table}
        </span>
        <span className="ml-auto font-mono text-[10px] text-faint">
          {/* A schema named like a file (`bluprint.json`) is a document's fields, not a table's columns. */}
          {block.rows.length} {/\.\w+$/.test(block.table) ? "fields" : "columns"}
        </span>
      </div>
      {/* Every row shares one column template, sized in `ch` from the
          longest name and type (both are monospace), so the columns line up
          down the table. Under 300px the note takes a line of its own. */}
      <div
        className="@container"
        style={{
          ["--name" as string]: `${Math.max(6, ...block.rows.map((c) => c.name.length + (c.nullable ? 1 : 0)))}ch`,
          ["--type" as string]: `${Math.max(4, ...block.rows.map((c) => c.type.length))}ch`,
        }}
      >
        <div className={cn(SCHEMA_ROW, "border-b border-border-gray py-1 font-mono text-[9px] uppercase tracking-wide text-faint")}>
          <span>{/\.\w+$/.test(block.table) ? "field" : "column"}</span>
          <span>type</span>
          <span>key</span>
          <span className="hidden @min-[300px]:block">notes</span>
        </div>
        {block.rows.map((c) => {
          const id = rowId(owner, c.name);
          const isLit = ctx.traced === id;
          return (
            <button
              key={c.name}
              data-row={id}
              onClick={() => ctx.onTrace(id)}
              className={rowClass(id, ctx, cn(SCHEMA_ROW, "items-baseline gap-y-0.5 border-b border-border-gray py-1.5 last:border-b-0"))}
            >
              <span
                className={cn(
                  "min-w-0 break-words font-mono text-[10.5px]",
                  isLit ? "font-semibold text-accent" : "text-on-surface",
                )}
              >
                {c.name}
                {c.nullable ? <span className="text-faint" title="can be empty">?</span> : null}
              </span>
              <span className="min-w-0 break-words font-mono text-[10.5px] text-muted-slate">
                {c.type}
              </span>
              <span className="self-center">{c.key ? <KeyTag k={c.key} lit={isLit} /> : null}</span>
              <span className="col-span-full flex items-start gap-2 @min-[300px]:col-span-1">
                {c.note ? (
                  <span
                    className={cn(
                      "min-w-0 flex-1 text-[10px] leading-snug",
                      c.state === "derived" ? "text-faint" : "text-amber-ink",
                    )}
                  >
                    {c.note}
                  </span>
                ) : (
                  <span className="min-w-0 flex-1" />
                )}
                <StateChip state={c.state} />
              </span>
            </button>
          );
        })}
      </div>
      {block.rel?.length ? (
        <div className="border-t border-border-gray bg-surface-container-low px-3 py-2">
          {block.rel.map((r) => (
            <p
              key={r}
              className="text-[10px] leading-relaxed text-on-surface-variant"
            >
              {r}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
