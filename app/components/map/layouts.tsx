"use client";

import { useState } from "react";
import { cn } from "@/lib/client/utils";
import { sectionTone } from "@/components/map/blocks";
import { Eyebrow, StateChip } from "@/components/ui/state";
import { useChangedCode, useMap } from "@/components/map/map-context";
import { SectionTint } from "@/components/review/diff";
import type { Edge, Node } from "@/lib/map/schema";
import type { Link } from "@/lib/map/coverage";
import { BLURB_LINES } from "@/lib/map/view";
import { authored, openable } from "@/components/map/nodes";
import { openInTab } from "@/components/chrome/tabs";

/* ── layout ──────────────────────────────────────────────────── */

/**
 * Real order, drawn as one numbered line down the left — the same rail the
 * steps inside a flow use. It never wraps, so there is no row-end arrow
 * pointing at nothing. Where the data names the hand-off ("uploads to") it is
 * written on the line; where the hand-off is only partly established the line
 * is dashed.
 */
export function Steps({
  nodes,
  edges,
  at,
  onOpen,
}: {
  nodes: Node[];
  edges: Edge[];
  at: string[];
  onOpen: (p: string[]) => void;
}) {
  return (
    <ol className="flex max-w-[880px] flex-col">
      {nodes.map((n, i) => {
        const last = i === nodes.length - 1;
        const edge = last
          ? undefined
          : edges.find((e) => e.from === n.id && e.to === nodes[i + 1].id);
        const partial = edge && edge.state !== "derived";
        return (
          <li key={n.id} className="flex gap-4">
            <div className="flex w-[22px] shrink-0 flex-col items-center pt-[15px]">
              <StepDot n={i + 1} state={n.state} />
              {last ? null : (
                <span
                  className={cn(
                    "mt-1.5 w-0 flex-1 border-l",
                    partial ? "border-dashed border-amber-line" : "border-border-strong",
                  )}
                />
              )}
            </div>
            <div className={cn("min-w-0 flex-1", last ? "" : "pb-3")}>
              <Row node={n} at={at} onOpen={onOpen} />
              {edge?.label ? (
                <p
                  className={cn(
                    "mt-2.5 pl-1 text-[11.5px] italic",
                    partial ? "text-amber-ink" : "text-faint",
                  )}
                >
                  {edge.label} {nodes[i + 1].title}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}


/** A set has no order, so it gets no numbers and no line — a grid. */
export function Grid({
  nodes,
  at,
  onOpen,
}: {
  nodes: Node[];
  at: string[];
  onOpen: (p: string[]) => void;
}) {
  return (
    <div className="grid max-w-[1100px] grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-3">
      {nodes.map((n) => (
        <SectionTint key={n.id} path={[...at, n.id]}>
          <Row node={n} at={at} onOpen={onOpen} />
        </SectionTint>
      ))}
    </div>
  );
}

/**
 * The parts as an index, for when the diagram above is already the way down
 * (D40). One line each: the name, and a problem count if there is one. No
 * blurb, no block counts, no file path — the picture carries the shape of the
 * level, and this is here so a part is still reachable by keyboard, by screen
 * reader, and when a part has no box of its own.
 */
export function List({
  nodes,
  at,
  onOpen,
  hue = [],
}: {
  nodes: Node[];
  at: string[];
  onOpen: (p: string[]) => void;
  /** The order the picture above assigned its section hues, by node id. */
  hue?: string[];
}) {
  const changed = useChangedCode();
  return (
    <ul className="max-w-[560px]">
      {nodes.map((n) => {
        const go = openable(n) ? () => onOpen([...at, n.id]) : undefined;
        const sec = hue.indexOf(n.id);
        return (
          <li key={n.id}>
            <button
              data-node-id={n.id}
              data-path={JSON.stringify([...at, n.id])}
              onClick={go}
              disabled={!go}
              className={cn(
                "group flex w-full items-center gap-2.5 border-b border-border-gray/70 px-1.5 py-2.5 text-left transition-colors",
                go && "hover:bg-surface-container-low",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              )}
            >
              {/* The same hue the box carries upstairs. A part with no box
                  of its own gets no dot rather than a colour that matches
                  nothing — 3 of 13 levels have one. */}
              <span
                aria-hidden
                className={cn("size-[9px] shrink-0 rounded-full", sec < 0 && "opacity-0")}
                style={sec >= 0 ? { background: sectionTone(sec).ink } : undefined}
              />
              <span className="truncate text-[14px] font-medium tracking-[-0.01em] text-ink">
                {n.title}
              </span>
              <ChangeDot files={changed.get(n.id)} />
              {n.issues?.length ? (
                <span className="shrink-0 font-mono text-[10.5px] text-clay-ink">
                  ⚠ {n.issues.length}
                </span>
              ) : null}
              <span className="flex-1" />
              {go ? (
                <span
                  aria-hidden
                  className="shrink-0 text-[14px] text-faint transition-colors group-hover:text-accent"
                >
                  ›
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * What a level's code imports, and what imports it, each as the section that
 * explains the other side (lib/map/coverage.ts neighbours): where to read next,
 * and what a change here reaches. Grouped under the area each sits in, so a
 * long list reads as a few places rather than a heap of names. Each opens in
 * a new tab, so the level being read stays one tab back.
 */
export function Reach({ uses, usedBy }: { uses: Link[]; usedBy: Link[] }) {
  const { name: map, nodeAt } = useMap();
  const [all, setAll] = useState<Record<string, boolean>>({});
  if (!uses.length && !usedBy.length) return null;
  const SHOWN = 12;

  const block = (label: string, gloss: string, links: Link[]) => {
    if (!links.length) return null;
    const shown = all[label] ? links : links.slice(0, SHOWN);
    const groups = new Map<string, Link[]>();
    for (const l of shown) {
      const area = l.path && nodeAt(l.path.slice(0, 1))?.title;
      const k = area || "Not on the map";
      groups.set(k, [...(groups.get(k) ?? []), l]);
    }
    return (
      <div className="flex flex-col gap-2.5">
        <div className="flex items-baseline gap-2">
          <Eyebrow>{label}</Eyebrow>
          <span className="font-mono text-[11px] text-faint">{links.length}</span>
          <span className="text-[12px] text-faint">· {gloss}</span>
        </div>
        <div className="flex flex-col gap-1.5 border-l border-border-gray pl-3">
          {[...groups].map(([area, ls]) => (
            <div key={area} className="flex items-baseline gap-3">
              <span className="w-[150px] shrink-0 truncate text-[12px] text-muted-slate" title={area}>
                {area}
              </span>
              <div className="flex min-w-0 flex-wrap gap-1.5">
                {ls.map((l) => {
                  const title = `${l.via}${l.count > 1 ? ` and ${l.count - 1} more` : ""}`;
                  const leaf = l.path && nodeAt(l.path)?.title;
                  if (!l.path || !leaf)
                    return (
                      <span key={l.file} title={title} className="px-1 font-mono text-[11.5px] text-faint">
                        {l.file.split("/").pop()}
                      </span>
                    );
                  return (
                    <button
                      key={l.path.join("/")}
                      onClick={() => openInTab(map, l.path!)}
                      title={`${title}\nOpens in a new tab`}
                      className="group/reach flex items-center gap-1.5 border border-border-gray px-2 py-0.5 text-[12.5px] text-ink transition-colors hover:border-accent hover:bg-surface-container-low focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    >
                      {l.path.length > 1 ? leaf : "the area itself"}
                      <span aria-hidden className="text-[11px] text-faint group-hover/reach:text-accent">
                        ↗
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {links.length > SHOWN ? (
            <button
              onClick={() => setAll((a) => ({ ...a, [label]: !a[label] }))}
              className="self-start text-[12px] text-faint hover:text-ink"
            >
              {all[label] ? "Show fewer" : `Show all ${links.length}`}
            </button>
          ) : null}
        </div>
      </div>
    );
  };
  return (
    <section data-pick="Uses and used by" className="flex max-w-[820px] flex-col gap-5">
      {block("Uses", "what its code imports", uses)}
      {block("Used by", "what a change here reaches", usedBy)}
    </section>
  );
}

export function Caption({ count, what, how }: { count: number; what: string; how: string }) {
  return (
    <div className="mb-3 flex items-baseline gap-2">
      <Eyebrow className="text-muted-slate">
        {count} {what}
      </Eyebrow>
      <span className="text-[12px] text-faint">· {how}</span>
    </div>
  );
}

export function Note({ children }: { children: React.ReactNode }) {
  return <p className="-mt-1 mb-4 text-[12px] italic text-faint">{children}</p>;
}

/* ── a part: named, not opened ───────────────────────────────── */

export const BLOCK_NOUN: Record<string, string> = {
  flow: "steps",
  facts: "facts",
  map: "entries",
  schema: "columns",
  routes: "routes",
  chips: "kinds",
  bars: "measures",
  parts: "parts",
  table: "rows",
  sequence: "steps",
};

/**
 * What is behind the click, in a few words: the author's own `summary` when
 * there is one, else the names of the parts, else a count of what kind of
 * thing is inside — and whether real code is at the bottom of it.
 */
function inside(node: Node): string {
  if (node.summary) return node.summary;
  const kids = authored(node);
  if (kids.length) return kids.map((k) => k.title).join(" · ");
  // Code is not listed: it is behind every level now, not a destination.
  return (node.anatomy ?? [])
    .map((b) =>
      b.kind === "diagram" ? "diagram"
      : b.kind === "screen" ? `the ${b.title} screen`
      : b.kind === "example" ? "an example"
      : b.kind === "source" ? null
      // A reader's note is named as theirs here too: "what you will find if
      // you open it" is a different promise when part of it is their own.
      : b.kind === "note" ? "a note of yours"
      : `${b.rows.length} ${BLOCK_NOUN[b.kind]}`,
    )
    .filter(Boolean)
    .join(" · ");
}

/**
 * A quiet mark on a part whose code changed and that no update has rewritten
 * yet (lib/server/live.ts), naming the files on hover. Still: the map is not redrawn
 * while the code is being written.
 */
function ChangeDot({ files }: { files?: string[] }) {
  if (!files?.length) return null;
  const said = `Code changed: ${files.join(", ")}. The map follows once your edits settle.`;
  return <span role="img" aria-label={said} title={said} className="size-[7px] shrink-0 rounded-full bg-amber-ink" />;
}

/**
 * One part of the level: what it is, in a line, and what you will find if you
 * open it. Never its contents — those are the next step down.
 */
function Row({ node, at, onOpen }: { node: Node; at: string[]; onOpen: (p: string[]) => void }) {
  const changed = useChangedCode();
  const go = openable(node) ? () => onOpen([...at, node.id]) : undefined;
  // No path on a card at all (D42): a card says what the part IS, and the
  // level it opens says where that lives.
  const peek = inside(node);
  const count = node.shape?.kind === "count" ? `${node.shape.value} ${node.shape.unit}` : null;

  return (
    <button
      data-node-id={node.id}
      data-path={JSON.stringify([...at, node.id])}
      onClick={go}
      disabled={!go}
      className={cn(
        "group flex w-full items-start gap-3 border bg-card px-4 py-3 text-left transition-[border-color,box-shadow] duration-150",
        node.ghost ? "border-dashed border-border-strong bg-surface-container-low/60" : "border-border-gray",
        go && "hover:border-border-strong hover:shadow-panel",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">
            {node.title}
          </span>
          <ChangeDot files={changed.get(node.id)} />
          <StateChip state={node.state} alarm={node.alarm} />
          {node.issues?.length ? (
            <span className="shrink-0 border border-clay-line bg-clay-surface px-2 py-[3px] font-mono text-[10px] leading-none text-clay-ink">
              ⚠ {node.issues.length} {node.issues.length === 1 ? "problem" : "problems"}
            </span>
          ) : null}
        </span>
        <span
          className="mt-0.5 block text-[13px] leading-snug text-on-surface-variant [display:-webkit-box] [overflow:hidden] [-webkit-box-orient:vertical]"
          style={{ WebkitLineClamp: BLURB_LINES }}
        >
          {node.sub}
        </span>
        {count || peek ? (
          <span className="mt-1.5 block truncate text-[11.5px] text-muted-slate">
            {[count, peek].filter(Boolean).join(" · ")}
          </span>
        ) : null}
      </span>
      {go ? (
        <span
          aria-hidden
          className="pt-0.5 text-[15px] text-faint transition-colors group-hover:text-accent"
        >
          ›
        </span>
      ) : null}
    </button>
  );
}

function StepDot({ n, state }: { n: number; state: Node["state"] }) {
  return (
    <span
      className={cn(
        "flex size-[22px] shrink-0 items-center justify-center rounded-full border font-mono text-[10.5px] font-semibold",
        state === "derived"
          ? "border-accent-line bg-accent-surface text-accent"
          : "border-amber-line bg-amber-surface text-amber-ink",
      )}
    >
      {n}
    </span>
  );
}
