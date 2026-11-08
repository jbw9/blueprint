"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useBluprint } from "@/components/bluprint/bluprint-context";
import type { Node, Origin } from "@/lib/bluprint/schema";
import type { BluprintEntry } from "@/lib/server/bluprints";
import { cn } from "@/lib/client/utils";
import { useDesktop } from "@/lib/client/platform";

/**
 * Where you are, and the way back — one line across the top of the page.
 *
 * This is the sentence you say out loud when someone asks what you are looking
 * at — "explorify, Sign Up, Student Sign-Up". It used to be a 232px rail down
 * the left, which spent a whole column on two or three names and boxed the
 * page in. Now it sits on the page's own background, sticks while you scroll,
 * and WRAPS rather than eliding when the path gets deep, so no stop is ever
 * hidden — the reason the rail existed.
 */

/** One stop on the way down: a level below the repo, outermost first. */
export interface Crumb {
  id: string;
  title: string;
}

/**
 * Where you are: the open path, root-first, read from the URL
 * (`?at=engine&at=eng-math`), and its levels as crumbs. `[]` is the repo.
 *
 * The URL rather than state because every level is then a history entry:
 * the browser's back button and the trackpad's two-finger swipe step back
 * the way they do everywhere else, and a level can be linked or reloaded.
 * The bluprint and the title bar both read it, so they always agree.
 */
export function useLocation(): { path: string[]; crumbs: Crumb[] } {
  const { nodeAt } = useBluprint();
  const params = useSearchParams();
  // The deepest level asked for that the bluprint still has: an update can take
  // a section away while it is open.
  const path = useMemo(() => {
    const asked = params.getAll("at");
    let n = asked.length;
    while (n && !nodeAt(asked.slice(0, n))) n--;
    return asked.slice(0, n);
  }, [params, nodeAt]);
  const crumbs = useMemo(
    () =>
      path
        .map((_, i) => nodeAt(path.slice(0, i + 1)))
        .filter((n): n is Node => n !== null)
        .map((n) => ({ id: n.id, title: n.title })),
    [path, nodeAt],
  );
  return { path, crumbs };
}

type Redone = { at: string; sections?: { id: string; ok: boolean }[] }[];

/**
 * Whether an update redid the open level, or a section it is inside, after
 * this was kept. An update rewrites the generator's words from the code, never
 * the reader's (lib/server/overlay.ts), so what they kept can now describe code that
 * is no longer there; it is marked, not removed, because it may still be true.
 */
export function useMayBeStale(origin?: Origin): boolean {
  const { name, L0 } = useBluprint();
  const { path } = useLocation();
  const [turns, setTurns] = useState<Redone>([]);
  useEffect(() => {
    if (!origin) return;
    let live = true;
    fetch(`/api/diff?bluprint=${encodeURIComponent(name)}&turns=1`)
      .then((r) => r.json())
      .then((j: { turns?: Redone }) => live && setTurns(j.turns ?? []))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [name, L0, origin]);
  return useMemo(
    () => Boolean(origin) && turns.some((t) => t.at > origin!.at && t.sections?.some((s) => s.ok && path.includes(s.id))),
    [turns, origin, path],
  );
}

/**
 * Opens a level. Native pushState is integrated with the App Router:
 * `useSearchParams` follows it, and so does back/forward.
 */
export function goTo(next: string[]) {
  const q = new URLSearchParams();
  const now = new URLSearchParams(window.location.search);
  const bluprint = now.get("bluprint");
  if (bluprint) q.set("bluprint", bluprint);
  // The landing page's frame stays an embed as the visitor goes deeper.
  if (now.has("embed")) q.set("embed", "");
  for (const id of next) q.append("at", id);
  window.history.pushState(null, "", q.size ? `?${q}` : window.location.pathname);
}

/** Which bluprint is open, and every other one of the reader's projects to switch to. */
function BluprintSwitcher({ bluprint, bluprints, className }: { bluprint: string; bluprints: BluprintEntry[]; className?: string }) {
  const router = useRouter();
  return (
    <select
      value={bluprint}
      aria-label="Bluprint"
      onChange={(e) => router.push(`?bluprint=${encodeURIComponent(e.target.value)}`)}
      className={className}
    >
      {bluprints.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
        </option>
      ))}
    </select>
  );
}

export function Crumbs({
  repo,
  crumbs,
  onJump,
  bluprint,
  bluprints,
}: {
  repo: string;
  /** The open bluprint and every bluprint on disk; outside the desktop app a switcher shows when there are two. */
  bluprint: string;
  bluprints: BluprintEntry[];
  /** One entry per level below the repo, outermost first. */
  crumbs: { id: string; title: string }[];
  /** Jump to depth `n` — 0 is the repo. */
  onJump: (depth: number) => void;
}) {
  const desktop = useDesktop();
  const stops = [{ id: "", title: repo }, ...crumbs];
  const switcher = !desktop && bluprints.length >= 2;
  // At the top, a trail of one is the repo's name standing alone.
  if (!crumbs.length && !switcher) return null;
  return (
    <nav
      aria-label="Location"
      className="sticky left-0 top-0 z-20 bg-paper/85 backdrop-blur-sm"
    >
      {/* The level's own width and gutter (components/bluprint/canvas.tsx), so the trail starts where its title does. */}
      <div className="mx-auto flex max-w-[1680px] items-start gap-6 px-10 py-3">
        {/* In the desktop app the switcher lives in the title bar. */}
        {switcher ? (
          <label className="flex shrink-0 items-center gap-2">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-faint">bluprint</span>
            <BluprintSwitcher
              bluprint={bluprint}
              bluprints={bluprints}
              className="cursor-pointer border border-border-strong bg-card px-2 py-1 text-[12.5px] text-ink focus-visible:outline-2 focus-visible:outline-accent"
            />
          </label>
        ) : null}
        {/* Pulled out by the first stop's padding, so its word lines up with the title's. */}
        <ol className={cn("flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-1", !switcher && "-ml-1.5")}>
          {stops.map((c, i) => {
            const here = i === stops.length - 1;
            return (
              <Fragment key={c.id || "repo"}>
                {i > 0 ? (
                  <li aria-hidden className="text-[13px] text-faint">
                    ›
                  </li>
                ) : null}
                <li>
                  <button
                    onClick={() => onJump(i)}
                    disabled={here}
                    aria-current={here ? "page" : undefined}
                    className={cn(
                      "px-1.5 py-0.5 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-accent",
                      !here && "cursor-pointer",
                      i === 0 && "font-mono text-[12.5px]",
                      here ? "font-semibold text-ink" : "text-muted-slate hover:bg-surface-container-low hover:text-ink",
                    )}
                  >
                    {c.title}
                  </button>
                </li>
              </Fragment>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
