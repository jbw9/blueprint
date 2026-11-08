/**
 * A diagram's arrows cut to what a reader can follow. Drawn from the call
 * graph, a level of N parts gets an arrow for every pair with any call
 * between them: up to N(N-1), and a part the others all lean on (a context, a
 * helpers module) pulls a line from every box. Past the cap below that is a
 * tangle, so:
 * - a box most of the others call is `shared`: its incoming arrows are left
 *   out and the box says it is used by all. The most-called goes first, and
 *   no more are marked once the rest fit the cap, or a quarter of the boxes
 *   are shared;
 * - each other box keeps its strongest arrow, so none is left unconnected;
 * - the rest of the cap goes to the strongest arrows left: most call sites,
 *   then a call the source states over one inferred, then by id.
 * A diagram at or under the cap is left as it is. An arrow weighed Infinity
 * (one an author drew to something the graph cannot see, such as the user or
 * a database) is always kept and never makes a box shared.
 */

type Thinnable = { from: string; to: string; inferred?: boolean };

/** The most arrows a diagram of this many boxes keeps. */
export const arrowCap = (boxes: number) => Math.min(Math.ceil(1.5 * boxes), 15);

/** How many other boxes must call a box for it to be shared. */
export const sharedAt = (boxes: number) => Math.max(3, Math.ceil(0.6 * (boxes - 1)));

/** The most boxes one diagram marks shared: past a quarter of them the tag says nothing. */
export const maxShared = (boxes: number) => Math.max(1, Math.floor(boxes / 4));

export function thinArrows<A extends Thinnable>(boxes: string[], arrows: A[], weight: (a: A) => number): { arrows: A[]; shared: string[] } {
  const cap = arrowCap(boxes.length);
  if (arrows.length <= cap) return { arrows, shared: [] };
  const w = new Map(arrows.map((a) => [a, weight(a)]));
  const fixed = arrows.filter((a) => w.get(a) === Infinity);
  const callers = new Map<string, Set<string>>();
  for (const a of arrows)
    if (a.from !== a.to && !fixed.includes(a)) (callers.get(a.to) ?? callers.set(a.to, new Set()).get(a.to)!).add(a.from);
  const hubs = [...callers]
    .filter(([, s]) => s.size >= sharedAt(boxes.length))
    .sort(([x, s], [y, t]) => t.size - s.size || x.localeCompare(y))
    .map(([id]) => id);
  const shared = new Set<string>();
  for (const id of hubs) {
    if (shared.size >= maxShared(boxes.length) || arrows.filter((a) => !shared.has(a.to)).length <= cap) break;
    shared.add(id);
  }
  const ranked = arrows
    .filter((a) => !fixed.includes(a) && !shared.has(a.to))
    .sort((x, y) => w.get(y)! - w.get(x)! || Number(!!x.inferred) - Number(!!y.inferred) || `${x.from}>${x.to}`.localeCompare(`${y.from}>${y.to}`));
  const keep = new Set<A>(fixed);
  for (const id of boxes) {
    if (shared.has(id) || [...keep].some((a) => a.from === id || a.to === id)) continue;
    const top = ranked.find((a) => a.from === id || a.to === id);
    if (top) keep.add(top);
  }
  for (const a of ranked) {
    if (keep.size >= cap) break;
    keep.add(a);
  }
  return { arrows: arrows.filter((a) => keep.has(a)), shared: boxes.filter((id) => shared.has(id)) };
}
