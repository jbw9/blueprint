import type { Anatomy } from "@/lib/blueprint/schema";
import { BOX_H, overlaps, type PlacedArrow, type PlacedBox, type Rect } from "@/lib/blueprint/diagram";

/**
 * The landing's diagrams, drawn the way dagre and React Flow draw a graph:
 * ranks top to bottom, curved lines from a box's bottom to the next one's top,
 * each label in a pill on its own line, and a pair of boxes that call each
 * other joined by one line with a head at each end. The boxes stay where the
 * blueprint puts them (`col`, `row`), which for the landing's demos is dagre's
 * own ranking snapped to the grid. The app keeps `layoutDiagram`.
 */

const ROW_GAP = 76;
const COL_GAP = 64;
const PAD = 18;
const CHAR = 6.6;
const LINE_H = 16;

type Block = Extract<Anatomy, { kind: "diagram" }>;
type Pt = [number, number];
export type DagreArrow = PlacedArrow & {
  /** Two boxes that call each other: one line, a head at each end. */
  both?: boolean;
  /** The label's pill, and its lines when the line runs both ways. */
  pill?: Rect;
  lines?: string[];
};

export function layoutDagre(block: Block) {
  const cols = Math.max(...block.boxes.map((b) => b.col)) + 1;
  const rows = Math.max(...block.boxes.map((b) => b.row)) + 1;
  const colW = Array.from({ length: cols }, (_, c) =>
    Math.max(150, ...block.boxes.filter((b) => b.col === c).map((b) => Math.max(b.label.length * 8.4, (b.sub?.length ?? 0) * CHAR) + 32)),
  );
  const colX = colW.map((_, c) => PAD + colW.slice(0, c).reduce((a, w) => a + w + COL_GAP, 0));
  const W = colX[cols - 1] + colW[cols - 1] + PAD;
  const H = PAD * 2 + rows * BOX_H + (rows - 1) * ROW_GAP;
  const at = new Map<string, PlacedBox>(
    block.boxes.map((b) => [b.id, { x: colX[b.col], y: PAD + b.row * (BOX_H + ROW_GAP), w: colW[b.col], b }]),
  );
  const boxRects: Rect[] = [...at.values()].map(({ x, y, w }) => ({ x, y, w, h: BOX_H }));

  // One line per pair of boxes: the same way twice joins its labels, both ways
  // is one line with a head at each end.
  type Edge = { from: string; to: string; tone: NonNullable<PlacedArrow["tone"]>; there: string[]; back: string[]; both: boolean };
  const edges: Edge[] = [];
  for (const a of block.arrows) {
    if (!at.has(a.from) || !at.has(a.to) || a.from === a.to) continue;
    const e = edges.find((x) => (x.from === a.from && x.to === a.to) || (x.from === a.to && x.to === a.from));
    if (!e) edges.push({ from: a.from, to: a.to, tone: a.tone ?? "plain", there: a.label ? [a.label] : [], back: [], both: false });
    else if (e.from === a.from) { if (a.label && !e.there.includes(a.label)) e.there.push(a.label); }
    else { e.both = true; if (a.label && !e.back.includes(a.label)) e.back.push(a.label); }
  }

  // Where each line leaves and enters: the bottom and top for a line between
  // rows, the facing sides within one. Lines sharing a side spread along it in
  // the order of their other ends, so they never start on top of each other.
  type Side = "top" | "bottom" | "left" | "right";
  const sides = edges.map((e) => {
    const f = at.get(e.from)!, t = at.get(e.to)!;
    if (t.y > f.y) return ["bottom", "top"] as Side[];
    if (t.y < f.y) return ["top", "bottom"] as Side[];
    return t.x > f.x ? (["right", "left"] as Side[]) : (["left", "right"] as Side[]);
  });
  const users = new Map<string, { i: number; end: 0 | 1 }[]>();
  edges.forEach((e, i) => [e.from, e.to].forEach((id, end) => {
    const k = `${id}:${sides[i][end]}`;
    users.set(k, [...(users.get(k) ?? []), { i, end: end as 0 | 1 }]);
  }));
  const port = (i: number, end: 0 | 1): Pt => {
    const e = edges[i];
    const p = at.get(end ? e.to : e.from)!;
    const side = sides[i][end];
    const list = users.get(`${p.b.id}:${side}`)!;
    const other = (u: { i: number; end: 0 | 1 }) => at.get(u.end ? edges[u.i].from : edges[u.i].to)!;
    const flat = side === "left" || side === "right";
    list.sort((a, b) => (flat ? other(a).y - other(b).y : other(a).x + other(a).w / 2 - (other(b).x + other(b).w / 2)));
    const k = list.findIndex((u) => u.i === i && u.end === end);
    const step = Math.min(flat ? 14 : 28, ((flat ? BOX_H : p.w) * 0.6) / Math.max(1, list.length - 1));
    const off = (k - (list.length - 1) / 2) * step;
    if (side === "bottom") return [p.x + p.w / 2 + off, p.y + BOX_H];
    if (side === "top") return [p.x + p.w / 2 + off, p.y - 2];
    if (side === "right") return [p.x + p.w + (end ? 2 : 0), p.y + BOX_H / 2 + off];
    return [p.x - (end ? 2 : 0), p.y + BOX_H / 2 + off];
  };

  // A line that skips rows runs straight down a lane no box sits in, curving
  // into it in the gap under its first box and out of it in the gap over its
  // last: dagre's long edge through its dummy nodes.
  // Each long line gets a lane of its own, as each dagre edge gets its own dummy nodes.
  const gaps = colX.slice(1).map((x) => x - COL_GAP / 2);
  const lanes: { x: number; y1: number; y2: number }[] = [];
  const clear = (x: number, y1: number, y2: number) =>
    boxRects.every((r) => x < r.x - 8 || x > r.x + r.w + 8 || r.y + r.h < Math.min(y1, y2) || r.y > Math.max(y1, y2)) &&
    // A row gap apart at least: two lanes curving in the same gap read as one line.
    lanes.every((l) => Math.abs(l.x - x) > 10 || l.y2 + ROW_GAP < Math.min(y1, y2) || l.y1 - ROW_GAP > Math.max(y1, y2));
  const curve = ([x1, y1]: Pt, [x2, y2]: Pt) => `C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`;
  const routes = edges.map((_, i) => {
    const s = port(i, 0), t = port(i, 1);
    const [fs] = sides[i];
    if (fs === "left" || fs === "right") return { d: `M${s[0]} ${s[1]}L${t[0]} ${t[1]}`, pts: [s, t] as Pt[] };
    const down = t[1] > s[1];
    const y1 = s[1] + (down ? ROW_GAP / 2 : -ROW_GAP / 2);
    const y2 = t[1] + (down ? -ROW_GAP / 2 : ROW_GAP / 2);
    if ((down ? y2 - y1 : y1 - y2) <= 1) return { d: `M${s[0]} ${s[1]}${curve(s, t)}`, pts: sample([s, t]) };
    const lane = [s[0], t[0], ...gaps.flatMap((g) => [g, g - 14, g + 14, g - 28, g + 28])]
      .filter((x) => clear(x, y1, y2))
      .sort((a, b) => Math.abs(a - s[0]) + Math.abs(a - t[0]) - (Math.abs(b - s[0]) + Math.abs(b - t[0])))[0] ?? s[0];
    lanes.push({ x: lane, y1: Math.min(y1, y2), y2: Math.max(y1, y2) });
    const a: Pt = [lane, y1], b: Pt = [lane, y2];
    return { d: `M${s[0]} ${s[1]}${curve(s, a)}L${b[0]} ${b[1]}${curve(b, t)}`, pts: [...sample([s, a]), ...sample([b, t])] };
  });

  // Each label in a pill on its own line, at the middle when that is clear of
  // boxes and other pills, else slid along the line until it is.
  const taken: Rect[] = [];
  const arrows: DagreArrow[] = edges.map((e, i) => {
    const vertical = sides[i][0] === "top" || sides[i][0] === "bottom";
    const down = at.get(e.to)!.y > at.get(e.from)!.y || (!vertical && at.get(e.to)!.x > at.get(e.from)!.x);
    const [fwd, rev] = vertical ? (down ? ["↓", "↑"] : ["↑", "↓"]) : down ? ["→", "←"] : ["←", "→"];
    const lines = e.both
      ? [e.there.length ? `${fwd} ${e.there.join(" · ")}` : "", e.back.length ? `${rev} ${e.back.join(" · ")}` : ""].filter(Boolean)
      : e.there.length ? [e.there.join(" · ")] : [];
    const out: DagreArrow = { from: e.from, to: e.to, d: routes[i].d, tone: e.tone, both: e.both };
    if (!lines.length) return out;
    const w = Math.max(...lines.map((l) => l.length)) * CHAR + 18;
    const h = lines.length * LINE_H + 6;
    const along = routes[i].pts;
    let best: Rect | null = null, least = Infinity;
    for (const f of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) {
      // Whole pixels: the server's and the browser's Math.hypot differ in the last bit.
      const [cx, cy] = pointAt(along, f).map(Math.round);
      const r = { x: cx - w / 2, y: cy - h / 2, w, h };
      const c = [...boxRects, ...taken].filter((o) => overlaps({ x: r.x - 3, y: r.y - 3, w: r.w + 6, h: r.h + 6 }, o)).length;
      if (c < least) [best, least] = [r, c];
      if (!c) break;
    }
    taken.push(best!);
    return { ...out, pill: best!, lines, label: { text: lines.join(" / "), x: best!.x + w / 2, y: best!.y + h / 2, anchor: "middle" } };
  });

  // Boxes no line touches sit in a band of their own under the rest, as dagre
  // lays out a graph's loose nodes; a faint rule sets the band off.
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
  const lastRow = [...at.values()].filter((p) => p.b.row === rows - 1);
  const band = rows > 1 && linked.size && lastRow.every((p) => !linked.has(p.b.id)) ? PAD + (rows - 1) * (BOX_H + ROW_GAP) - ROW_GAP / 2 : undefined;

  return { W, H, gap: COL_GAP, boxes: [...at.values()], boxRects, arrows, labels: taken, band };
}

/** Points along a cubic from a to b with vertical tangents at both ends. */
function sample([a, b]: [Pt, Pt], n = 16): Pt[] {
  const my = (a[1] + b[1]) / 2;
  return Array.from({ length: n + 1 }, (_, k) => {
    const t = k / n, u = 1 - t;
    const x = u * u * u * a[0] + 3 * u * u * t * a[0] + 3 * u * t * t * b[0] + t * t * t * b[0];
    const y = u * u * u * a[1] + 3 * u * u * t * my + 3 * u * t * t * my + t * t * t * b[1];
    return [x, y] as Pt;
  });
}

/** The point a fraction of the way along a polyline. */
function pointAt(pts: Pt[], f: number): Pt {
  const lens = pts.slice(1).map(([x, y], i) => Math.hypot(x - pts[i][0], y - pts[i][1]));
  let left = lens.reduce((a, b) => a + b, 0) * f;
  for (let i = 0; i < lens.length; i++) {
    if (left <= lens[i] || i === lens.length - 1) {
      const k = lens[i] ? Math.min(1, left / lens[i]) : 0;
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k];
    }
    left -= lens[i];
  }
  return pts[0];
}

