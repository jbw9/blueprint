import { cn } from "@/lib/client/utils";
import { ROW_LABEL_MAX_PCT, ROW_VALUE_MIN_PX } from "@/lib/map/view";
import type { RowCtx } from "@/components/map/anatomy";

/**
 * The label is the question; the value is the answer. The answer never gets
 * less room than the question.
 *
 * Measured failure this exists to delete: a `map` row 212px wide where the
 * label `what the code does` took 112px — 53% — and the value got 32px,
 * rendering one word per line over twelve lines. The most important comparison
 * on the card was the least readable thing on screen.
 *
 * The cause was a `shrink-0` label beside a `min-w-0 flex-1` value: the only
 * element in the row allowed to give up space was the one carrying the content.
 * A previous fix moved the state chip INSIDE the value column (see the comment
 * that survives in the `map` block), which was real but addressed the wrong
 * element — the label was still unbounded.
 *
 * Two rules from `lib/map/view.ts`, enforced together:
 *
 *   label ≤ ROW_LABEL_MAX_PCT (40%)   value ≥ ROW_VALUE_MIN_PX (160px)
 *
 * Below a certain row width both cannot hold at once, so rather than squeeze
 * the value under its floor the pair STACKS — label above value, each with the
 * full width. That threshold is a property of the ROW, not of the viewport: a
 * card is a fixed-width column on a canvas that pans, so a viewport breakpoint
 * would tell us nothing about the space this row actually has. Hence a
 * container query.
 *
 * The threshold below is 267px, and it is `ROW_VALUE_MIN_PX / (1 -
 * ROW_LABEL_MAX_PCT/100)` — the narrowest row on which a 40% label still
 * leaves 160px. It is written as a literal in the class strings because
 * Tailwind scans source statically: an interpolated `@min-[${n}px]:` is a
 * class name no build step ever sees, so it would compile to nothing and the
 * row would silently stay stacked at every width. The assertion keeps the
 * literal honest if either constant is ever retuned.
 */
const STACK_BELOW_PX = Math.ceil(ROW_VALUE_MIN_PX / (1 - ROW_LABEL_MAX_PCT / 100));
if (STACK_BELOW_PX !== 267) {
  throw new Error(
    `view.ts row rules changed: the @min-[267px] literals in components/map/anatomy/ must become @min-[${STACK_BELOW_PX}px]`,
  );
}

/**
 * Every pair row is its own query container. The row, not the card, is what
 * the rules are about — a card can be wide while a row inside a rail or an
 * indent is not.
 */
export const PAIR_SCOPE = "@container";

/**
 * Side by side once the row can honour both rules; stacked when it cannot.
 *
 * The percentage cap is a MAX, not a width, so a short label keeps its natural
 * size and does not pad out to 40% leaving the value starved for no reason.
 */
// Each of these is ONE unbroken literal on purpose. Tailwind's scanner reads
// source text, not evaluated JavaScript: splitting a class list across a `+`
// hides every class after the operator, which compiles to nothing and fails
// silently — measured here, where only the one class that stayed inline in JSX
// survived into the stylesheet.
export const PAIR_ROW = "flex w-full min-w-0 flex-col items-stretch gap-0.5 @min-[267px]:flex-row @min-[267px]:items-start @min-[267px]:gap-2";

/** The question side. Capped, never allowed to eat the row. */
export const PAIR_LABEL = "min-w-0 text-left @min-[267px]:max-w-[40%] @min-[267px]:shrink-0";

/** The answer side. Floored, and it is the only side allowed to grow. */
export const PAIR_VALUE = "w-full min-w-0 text-left @min-[267px]:w-auto @min-[267px]:flex-1 @min-[267px]:min-w-[160px]";

/** A schema row: name, type and key in fixed tracks, the note in what is left. */
export const SCHEMA_ROW =
  "grid w-full grid-cols-[minmax(0,var(--name))_minmax(0,var(--type))_2.25rem] gap-x-4 px-3 text-left @min-[300px]:grid-cols-[minmax(0,var(--name))_minmax(0,var(--type))_2.25rem_minmax(0,1fr)]";

/** Shared row chrome: lit fill, dimmed-when-others-are-lit, click to trace. */
export function rowClass(id: string, ctx: RowCtx, extra?: string) {
  const isLit = ctx.traced === id;
  return cn(
    "w-full text-left transition-[background-color,opacity] duration-150",
    isLit && "bg-accent-surface",
    ctx.traced !== null && !isLit && "opacity-55",
    ctx.traced === null && "hover:bg-surface-container",
    extra,
  );
}
