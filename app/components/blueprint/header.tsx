"use client";

import { Fragment } from "react";
import { cn } from "@/lib/client/utils";
import { InlineMarks } from "@/components/blueprint/shapes";
import { Eyebrow, OriginMark, Prose, StateChip } from "@/components/ui/state";
import { useMayBeStale } from "@/components/chrome/crumbs";
import { Button, CodeIcon } from "@/components/ui/button";
import { useBlueprint } from "@/components/blueprint/blueprint-context";
import { useRedoing } from "@/components/chrome/statusbar";
import { openReview } from "@/components/review/diff";
import type { Node } from "@/lib/blueprint/schema";
import type { Shape } from "@/lib/blueprint/view";

/* ── the node you are in ─────────────────────────────────────── */

export function Header({
  path,
  deepening,
  back,
  eyebrow,
  title,
  state,
  origin,
  alarm,
  sub,
  detail,
  unsure,
  meta,
  link,
  shape,
  onCode,
}: {
  /** Where this level is, so it can be handed to Claude from its header. */
  path: string[];
  /** A quick section's place in being written in full: still waiting, or being written now. */
  deepening?: "queued" | "drafting";
  /** The level above, named — so "back" says where it goes. */
  back?: { label: string; path: string[]; onClick: () => void }[];
  eyebrow?: string;
  title: string;
  state?: Node["state"];
  /** Set where the reader rewrote this level's own words (lib/server/overlay.ts). */
  origin?: Node["origin"];
  alarm?: boolean;
  sub?: string;
  detail?: string;
  /** Why this level is not certain, shown with the mark it explains. */
  unsure?: string;
  meta?: string;
  /** Where the code lives, outside this page. */
  link?: { href: string; label: string };
  shape?: Shape;
  onCode?: () => void;
}) {
  const stale = useMayBeStale(origin);
  // This level, or the section it sits in, is being redone by an update.
  const redoing = useRedoing();
  const rewriting = path.some((id) => redoing.includes(id));
  // An update rewrote this level and holds it back until asked (components/blueprint/blueprint-context.tsx).
  const { pending, apply } = useBlueprint();
  return (
    <header data-path={JSON.stringify(path)} className="mb-8 border-b border-border-gray pb-7">
      {/* One toolbar row: the way back on the left, what you can do to this
          level on the right. They used to be a back link here and a column of
          mismatched buttons in a rail beside the prose, which read as parts
          from different apps (D62). */}
      <div className="mb-5 flex min-h-7 flex-wrap items-center gap-2">
        {/* The whole way down, each step a way back to it, so a level always
            says what it is part of; the last is the one Esc goes back to. */}
        {back?.map((crumb, i) => (
          <Fragment key={i}>
            {i > 0 ? <span aria-hidden className="text-muted-slate">›</span> : null}
            <Button
              variant="ghost"
              data-opens-at={JSON.stringify(crumb.path)}
              onClick={crumb.onClick}
              className={`${i === 0 ? "-ml-2.5" : ""} text-muted-slate`}
              title={i === back.length - 1 ? "Back (Esc)" : undefined}
            >
              {i === 0 ? <span aria-hidden>←</span> : null}
              {crumb.label}
            </Button>
          </Fragment>
        ))}
        {/* Where you are, as a step that goes nowhere: without it the last
            link read as the current page and took clicks meant for none. */}
        {back?.length ? (
          <>
            <span aria-hidden className="text-muted-slate">›</span>
            <span aria-current="page" className="inline-flex h-7 items-center whitespace-nowrap px-2.5 text-[13px] font-medium text-ink">
              {title}
            </span>
          </>
        ) : null}
        <span className="flex-1" />
        {pending ? (
          <span role="status" className="arrive flex items-center gap-2 text-[12.5px] text-muted-slate">
            <span aria-hidden className="size-[6px] shrink-0 rounded-full bg-accent" />
            Updated to match the code
            <Button variant="ghost" onClick={() => (apply(), openReview("turn:latest"))}>
              Show changes
            </Button>
            <Button variant="ghost" onClick={apply}>
              Refresh
            </Button>
          </span>
        ) : null}
        {onCode ? (
          <Button onClick={onCode} icon={<CodeIcon />}>
            View the code
          </Button>
        ) : null}
      </div>
      {deepening && !rewriting ? (
        <div role="status" className={cn("mb-5 flex max-w-[720px] items-center gap-2 border border-accent-line bg-accent-surface/60 px-3 py-2 text-[13px] text-accent", deepening === "drafting" && "shimmer")}>
          <span aria-hidden className={cn("size-[7px] shrink-0 rounded-full bg-accent", deepening === "drafting" && "animate-pulse")} />
          {deepening === "drafting"
            ? "This is a quick first version. The full one is being written now; it usually takes a minute or two and appears here by itself."
            : "This is a quick first version. The full one is written next, since you opened it, and appears here by itself."}
        </div>
      ) : null}
      {rewriting ? (
        <div role="status" className="shimmer mb-5 flex max-w-[720px] items-center gap-2 border border-amber-line bg-amber-surface/60 px-3 py-2 text-[13px] text-amber-ink">
          <span aria-hidden className="size-[7px] shrink-0 animate-pulse rounded-full bg-amber-ink" />
          Rewriting this section to match its code. It usually takes a minute or two and updates here by itself.
        </div>
      ) : null}
      <div className="max-w-[720px]">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2", eyebrow && "mt-2")}>
          <h1 className="font-display text-[clamp(32px,3.2vw,46px)] font-normal leading-[1.02] tracking-[-0.018em] text-ink">
            {title}
          </h1>
          {state ? <StateChip state={state} alarm={alarm} /> : null}
          {/* Beside the state mark, never instead of it: the two answer
              different questions (see `Origin` in lib/blueprint/schema.ts). */}
          {origin ? <OriginMark origin={origin} stale={stale} /> : null}
          {shape?.kind === "marks" ? <InlineMarks ids={shape.ids} note={shape.note} /> : null}
          {shape?.kind === "count" ? (
            <span className=" border border-border-gray bg-card px-2.5 py-1 text-[12px] text-on-surface-variant">
              <span className="tnum font-semibold text-ink">{shape.value}</span> {shape.unit}
            </span>
          ) : null}
        </div>
        {sub ? (
          <p className="mt-1.5 text-[15px] leading-snug text-on-surface-variant">{sub}</p>
        ) : null}
        {/* Where this lives: one quiet line under the title, not a rail. */}
        {meta || link ? (
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-faint">
            {meta ? <span className="whitespace-pre-wrap font-mono text-[11.5px]">{meta}</span> : null}
            {link ? (
              <a href={link.href} target="_blank" rel="noreferrer" className="font-mono text-[11.5px] text-accent hover:underline">
                {link.label}
              </a>
            ) : null}
          </p>
        ) : null}
        {detail
          ? detail.split(/\n\s*\n/).map((para, i) => (
              <p key={i} className="mt-4 text-[14.5px] leading-relaxed text-on-surface">
                <Prose text={para} />
              </p>
            ))
          : null}
        {unsure ? (
          <p className="mt-4 border-l-2 border-amber-line bg-amber-surface/60 py-2 pl-3 pr-3 text-[13px] leading-snug text-amber-ink">
            <span className="font-semibold">Not certain: </span>
            <Prose text={unsure} />
          </p>
        ) : null}
      </div>
    </header>
  );
}
