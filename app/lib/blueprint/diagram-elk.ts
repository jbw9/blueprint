import type { ElkNode } from "elkjs/lib/elk-api";
import type { Anatomy, DiagramArrow, DiagramBox } from "@/lib/blueprint/schema";
import { BOX_H, layoutDiagram, type Rect } from "@/lib/blueprint/diagram";
import { layoutDagre } from "@/lib/blueprint/dagre";

/**
 * The diagram laid out by ELK's layered algorithm, top to bottom, with three
 * things ELK does not do on its own: a pair of boxes that call each other both
 * ways is one line with a head at each end; the parts only a hub links to sit
 * in one column fed by a single trunk, so a hub with eight leaves is not eight
 * columns wide; and boxes no arrow touches go in a free corner, a column on
 * the right, or a row below. About forty layouts are tried per diagram and the
 * one with the fewest crossings, bends and overlaps in the smallest area wins,
 * so it runs off the main thread (diagram-elk.worker.ts).
 */

type Block = Extract<Anatomy, { kind: "diagram" }>;
type Pt = { x: number; y: number };
type Tone = NonNullable<DiagramArrow["tone"]>;
export type LabelLine = { text: string; from: string; to: string };
export type LaidBox = { x: number; y: number; w: number; h: number; b: DiagramBox };
export type LaidArrow = {
  from: string;
  to: string;
  d: string;
  tone: Tone;
  start: boolean;
  end: boolean;
  label?: Rect & { lines: LabelLine[]; pill?: boolean };
};
export type DiagramLayout = { W: number; H: number; boxes: LaidBox[]; arrows: LaidArrow[]; rules: { x1: number; y1: number; x2: number; y2: number }[]; frames: Rect[] };
export type Elk = { layout(graph: ElkNode): Promise<ElkNode> };

const TITLE_CHAR = 8.4;
const LABEL_CHAR = 6.6;
const LINE_H = 16;
const LABEL_PAD = 6;
const HEAD = 8;
const RADIUS = 6;
const MAX_W = 1300;
const MAX_H = 900;
const MIN_W = 220;
const TRUNK = 12;
const STACK_GAP = 12;
const BRANCH_PAD = 12;
const M = 4;

const BASE: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.direction": "DOWN",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.padding": "[top=8,left=8,bottom=8,right=8]",
  "elk.spacing.nodeNode": "28",
  "elk.spacing.edgeNode": "14",
  "elk.spacing.edgeEdge": "14",
  "elk.spacing.edgeLabel": "3",
  "elk.spacing.componentComponent": "32",
  "elk.layered.spacing.nodeNodeBetweenLayers": "32",
  "elk.layered.spacing.edgeNodeBetweenLayers": "14",
  "elk.layered.spacing.edgeEdgeBetweenLayers": "10",
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  "elk.layered.cycleBreaking.strategy": "MODEL_ORDER",
  "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
  "elk.layered.nodePlacement.bk.fixedAlignment": "LEFTUP",
  "elk.layered.nodePlacement.favorStraightEdges": "true",
  "elk.edgeLabels.inline": "true",
  "elk.edgeLabels.placement": "CENTER",
};
const LABEL_OPTS = { "elk.edgeLabels.inline": "true", "elk.edgeLabels.placement": "CENTER" };

type Edge = { from: string; to: string; tone: Tone; fwd: string; back: string; both: boolean };
type Label = Rect & { lines: string[] };
type Routed = { e: Edge; from: string; to: string; pts: Pt[]; label: Label | null; heads: { start: boolean; end: boolean }; fixed?: boolean };
type Stack = { id: string; parent: string; out: boolean; items: { e: Edge; leaf: string; label: Label; w: number }[]; branch: number; w: number; h: number };
type Opts = { stack: boolean; wrapLabels: boolean; elk: Record<string, string>; stackEdge?: boolean };
type Layout = { placed: LaidBox[]; routed: Routed[]; W: number; H: number; score: number; order: string[]; opts: Opts };

function splitTwo(t: string) {
  let best = -1;
  for (let i = 0; i < t.length; i++)
    if (t[i] === " " && (best < 0 || Math.abs(i - t.length / 2) < Math.abs(best - t.length / 2))) best = i;
  return best < 0 ? [t] : [t.slice(0, best), t.slice(best + 1)];
}

const boxWidth = (b: DiagramBox) => Math.ceil(Math.max(MIN_W, b.label.length * TITLE_CHAR + 32, (b.sub?.length ?? 0) * LABEL_CHAR + 32));

const labelBox = (lines: string[]): Label => ({
  x: 0,
  y: 0,
  w: Math.max(...lines.map((l) => l.length * LABEL_CHAR)) + 2 * LABEL_PAD,
  h: LINE_H * lines.length + 4,
  lines,
});

function prepare(block: Block): Edge[] {
  const ids = new Set(block.boxes.map((b) => b.id));
  const byKey = new Map<string, { from: string; to: string; tone: Tone; labels: string[] }>();
  for (const a of block.arrows) {
    if (a.from === a.to || !ids.has(a.from) || !ids.has(a.to)) continue;
    const k = `${a.from}>${a.to}`;
    const seen = byKey.get(k);
    if (seen) {
      if (a.label && !seen.labels.includes(a.label)) seen.labels.push(a.label);
      continue;
    }
    byKey.set(k, { from: a.from, to: a.to, tone: a.tone ?? "plain", labels: a.label ? [a.label] : [] });
  }
  const edges: Edge[] = [];
  const used = new Set<string>();
  for (const [k, e] of byKey) {
    if (used.has(k)) continue;
    used.add(k);
    const bk = `${e.to}>${e.from}`;
    const back = byKey.get(bk);
    const fwd = e.labels.join(" · ");
    if (back && !used.has(bk)) {
      used.add(bk);
      edges.push({ from: e.from, to: e.to, tone: e.tone, fwd, back: back.labels.join(" · "), both: true });
    } else edges.push({ from: e.from, to: e.to, tone: e.tone, fwd, back: "", both: false });
  }
  return edges;
}

function edgeLines(e: Edge, wrap: boolean) {
  if (e.both) return [`↓ ${e.fwd}`, `↑ ${e.back}`];
  if (!e.fwd) return [];
  return wrap && e.fwd.length > 14 ? splitTwo(e.fwd) : [e.fwd];
}

function stackPlan(edges: Edge[], width: Map<string, number>, rank: Map<string, number>, wrap: boolean): Stack[] {
  const deg = new Map<string, number>();
  for (const e of edges) for (const id of [e.from, e.to]) deg.set(id, (deg.get(id) ?? 0) + 1);
  const groups = new Map<string, { id: string; parent: string; out: boolean; items: { e: Edge; leaf: string }[] }>();
  for (const e of edges) {
    if (e.both) continue;
    for (const [leaf, parent, out] of [[e.to, e.from, true], [e.from, e.to, false]] as const) {
      if (deg.get(leaf) !== 1 || (deg.get(parent) ?? 0) < 3) continue;
      const k = `${parent}~${out ? "out" : "in"}`;
      if (!groups.has(k)) groups.set(k, { id: `stack~${k}`, parent, out, items: [] });
      groups.get(k)!.items.push({ e, leaf });
    }
  }
  return [...groups.values()]
    .filter((g) => g.items.length >= 2)
    .map((g) => {
      const items = [...g.items]
        .sort((a, b) => rank.get(a.leaf)! - rank.get(b.leaf)!)
        .map((it) => {
          const lines = edgeLines(it.e, wrap);
          return { ...it, label: labelBox(lines.length ? lines : [" "]), w: width.get(it.leaf)! };
        });
      const branch = Math.max(48, ...items.map((it) => it.label.w + 2 * BRANCH_PAD + HEAD));
      const w = TRUNK + branch + Math.max(...items.map((it) => it.w));
      const h = items.length * BOX_H + STACK_GAP * (items.length - 1);
      return { ...g, items, branch, w, h };
    });
}

function greedyOrder(nodes: string[], edges: { from: string; to: string }[], key: (n: string) => number, first?: string) {
  const out = new Map(nodes.map((n) => [n, new Set<string>()]));
  const inn = new Map(nodes.map((n) => [n, new Set<string>()]));
  for (const e of edges) {
    out.get(e.from)?.add(e.to);
    inn.get(e.to)?.add(e.from);
  }
  const left = new Set(nodes);
  const s1: string[] = [];
  const s2: string[] = [];
  const drop = (n: string) => {
    left.delete(n);
    for (const m of out.get(n)!) inn.get(m)!.delete(n);
    for (const m of inn.get(n)!) out.get(m)!.delete(n);
  };
  if (first) {
    s1.push(first);
    drop(first);
  }
  while (left.size) {
    let moved = true;
    while (moved) {
      moved = false;
      for (const n of [...left])
        if (!out.get(n)!.size) {
          s2.unshift(n);
          drop(n);
          moved = true;
        }
      for (const n of [...left])
        if (!inn.get(n)!.size) {
          s1.push(n);
          drop(n);
          moved = true;
        }
    }
    if (!left.size) break;
    const best = [...left].sort(
      (a, b) => out.get(b)!.size - inn.get(b)!.size - (out.get(a)!.size - inn.get(a)!.size) || key(a) - key(b),
    )[0];
    s1.push(best);
    drop(best);
  }
  return [...s1, ...s2];
}

function candidateOrders(nodes: string[], edges: { from: string; to: string }[], rank: (n: string) => number) {
  const deg = (n: string, dir: "out" | "in") => edges.filter((e) => (dir === "out" ? e.from : e.to) === n).length;
  const keys = [
    (n: string) => rank(n),
    (n: string) => -(deg(n, "out") - deg(n, "in")) * 100 + rank(n),
    (n: string) => -deg(n, "out") * 100 + rank(n),
    (n: string) => -(deg(n, "out") + deg(n, "in")) * 100 + rank(n),
    (n: string) => deg(n, "in") * 100 + rank(n),
  ];
  const orders = keys.map((k) => greedyOrder(nodes, edges, k));
  for (const n of nodes) if (deg(n, "out") >= 2) orders.push(greedyOrder(nodes, edges, keys[1], n));
  const seen = new Set<string>();
  return orders.filter((o) => {
    const s = o.join("|");
    if (seen.has(s)) return false;
    seen.add(s);
    return true;
  });
}

type Ctx = { edges: Edge[]; width: Map<string, number>; byId: Map<string, DiagramBox>; stacksFor: (wrap: boolean) => Stack[] };

async function layoutOnce(elk: Elk, ctx: Ctx, order: string[], opts: Opts) {
  const stacks = opts.stack ? ctx.stacksFor(opts.wrapLabels) : [];
  const hiddenLeaf = new Set(stacks.flatMap((g) => g.items.map((it) => it.leaf)));
  const hiddenEdge = new Set(stacks.flatMap((g) => g.items.map((it) => it.e)));
  const stackById = new Map(stacks.map((g) => [g.id, g]));
  const nodeIds = order.filter((id) => !hiddenLeaf.has(id));
  const pos = new Map(nodeIds.map((id, i) => [id, i]));
  type GraphEdge = { e?: Edge; stack?: Stack; from: string; to: string; lines: string[] };
  const graphEdges: GraphEdge[] = [];
  for (const e of ctx.edges) if (!hiddenEdge.has(e)) graphEdges.push({ e, from: e.from, to: e.to, lines: edgeLines(e, opts.wrapLabels) });
  for (const g of stacks) graphEdges.push({ stack: g, from: g.out ? g.parent : g.id, to: g.out ? g.id : g.parent, lines: [] });
  graphEdges.sort((a, b) => pos.get(a.from)! - pos.get(b.from)! || pos.get(a.to)! - pos.get(b.to)!);
  const graph: ElkNode = {
    id: "root",
    layoutOptions: { ...BASE, ...opts.elk },
    children: nodeIds.map((id) => {
      const g = stackById.get(id);
      if (!g) return { id, width: ctx.width.get(id)!, height: BOX_H };
      return {
        id,
        width: g.w,
        height: g.h,
        layoutOptions: {
          "elk.portConstraints": "FIXED_POS",
          ...(opts.stackEdge ? { "elk.layered.layering.layerConstraint": g.out ? "LAST" : "FIRST" } : {}),
        },
        ports: [{ id: `${id}.p`, x: TRUNK, y: g.out ? 0 : g.h, width: 0, height: 0, layoutOptions: { "elk.port.side": g.out ? "NORTH" : "SOUTH" } }],
      };
    }),
    edges: graphEdges.map((ge, i) => {
      const lb = ge.lines.length ? labelBox(ge.lines) : null;
      return {
        id: `e${i}`,
        sources: [ge.stack && !ge.stack.out ? `${ge.from}.p` : ge.from],
        targets: [ge.stack && ge.stack.out ? `${ge.to}.p` : ge.to],
        labels: lb ? [{ id: `l${i}`, text: ge.lines.join("\n"), width: lb.w, height: lb.h, layoutOptions: LABEL_OPTS }] : [],
      };
    }),
  };
  const out = await elk.layout(graph);
  const placed: LaidBox[] = [];
  const routed: Routed[] = [];
  const nodePos = new Map((out.children ?? []).map((n) => [n.id, n]));
  for (const n of out.children ?? [])
    if (!stackById.has(n.id)) placed.push({ x: n.x ?? 0, y: n.y ?? 0, w: n.width ?? 0, h: BOX_H, b: ctx.byId.get(n.id)! });
  (out.edges ?? []).forEach((oe, i) => {
    const ge = graphEdges[i];
    const s = oe.sections?.[0];
    if (!s) return;
    const pts = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((p) => ({ x: p.x, y: p.y }));
    const l = oe.labels?.[0];
    if (ge.e) {
      routed.push({
        e: ge.e,
        from: ge.from,
        to: ge.to,
        pts,
        label: l ? { x: l.x ?? 0, y: l.y ?? 0, w: l.width ?? 0, h: l.height ?? 0, lines: ge.lines } : null,
        heads: { start: ge.e.both, end: true },
      });
      return;
    }
    const g = ge.stack!;
    const n = nodePos.get(g.id)!;
    const tx = (n.x ?? 0) + TRUNK;
    const lx = tx + g.branch;
    let y = n.y ?? 0;
    const rows = g.items.map((it) => {
      placed.push({ x: lx, y, w: it.w, h: BOX_H, b: ctx.byId.get(it.leaf)! });
      const row = { it, cy: y + BOX_H / 2 };
      y += BOX_H + STACK_GAP;
      return row;
    });
    const lab = (row: (typeof rows)[number]): Label => ({
      ...row.it.label,
      x: (tx + lx) / 2 - row.it.label.w / 2,
      y: row.cy - row.it.label.h / 2,
    });
    if (g.out) {
      const last = rows.at(-1)!;
      routed.push({ e: last.it.e, from: g.parent, to: last.it.leaf, pts: [...pts, { x: tx, y: last.cy }, { x: lx, y: last.cy }], fixed: true, label: lab(last), heads: { start: false, end: true } });
      for (const row of rows.slice(0, -1))
        routed.push({ e: row.it.e, from: g.parent, to: row.it.leaf, pts: [{ x: tx, y: row.cy }, { x: lx, y: row.cy }], fixed: true, label: lab(row), heads: { start: false, end: true } });
    } else {
      const first = rows[0];
      routed.push({ e: first.it.e, from: first.it.leaf, to: g.parent, pts: [{ x: lx, y: first.cy }, { x: tx, y: first.cy }, ...pts], fixed: true, label: lab(first), heads: { start: false, end: true } });
      for (const row of rows.slice(1))
        routed.push({ e: row.it.e, from: row.it.leaf, to: g.parent, pts: [{ x: lx, y: row.cy }, { x: tx, y: row.cy }], fixed: true, label: lab(row), heads: { start: false, end: false } });
    }
  });
  straighten(placed, routed);
  return { placed, routed, W: out.width ?? 0, H: out.height ?? 0 };
}

const JOG = 24;

/**
 * Straight lines where ELK draws steps. A line that steps across between two
 * boxes that overlap side to side runs straight down where they overlap. And
 * ELK spreads the lines leaving one side of a box along that side, then steps
 * each over to its own channel, which leaves a small kink just outside the
 * box: where the box edge has room, the line leaves straight down its channel.
 * A change is kept only where the new line meets no box, label or other line's
 * end. A stack's lines are drawn by hand.
 */
function straighten(placed: LaidBox[], routed: Routed[]) {
  const at = new Map(placed.map((p) => [p.b.id, p]));
  const ends = (o: Routed) => [o.pts[0], o.pts.at(-1)!];
  const inside = (box: LaidBox | undefined, x: number) => Boolean(box) && x >= box!.x + 8 && x <= box!.x + box!.w - 8;
  const crowded = (r: Routed, x: number, y: number) =>
    routed.some((o) => o !== r && ends(o).some((q) => Math.abs(q.y - y) < 1 && Math.abs(q.x - x) < 10));
  const vertical = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < 0.5;
  for (const r of routed) {
    if (r.fixed) continue;
    const [p0, p1, p2, p3] = r.pts;
    if (r.pts.length === 4 && vertical(p0, p1) && !vertical(p1, p2) && vertical(p2, p3)) {
      const from = at.get(r.from), to = at.get(r.to);
      const x = inside(from, p3.x) ? p3.x : inside(to, p0.x) ? p0.x : null;
      if (x !== null && !crowded(r, x, p0.y) && !crowded(r, x, p3.y)) {
        const a = { x, y: p0.y }, b = { x, y: p3.y };
        const blocked =
          placed.some((p) => p !== from && p !== to && segHitsRect(a, b, p, 2)) ||
          routed.some((o) => o !== r && o.label && segHitsRect(a, b, o.label, 1));
        if (!blocked) {
          r.pts = [a, b];
          if (r.label) r.label.x = x - r.label.w / 2;
          continue;
        }
      }
    }
    for (const first of [true, false]) {
      const pts = first ? r.pts : [...r.pts].reverse();
      if (pts.length < 4) continue;
      const [q0, q1, q2, q3] = pts;
      if (!vertical(q0, q1) || Math.abs(q1.y - q2.y) > 0.5 || !vertical(q2, q3)) continue;
      const dx = q2.x - q1.x;
      if (Math.abs(dx) < 0.5 || Math.abs(dx) > JOG) continue;
      if (!inside(at.get(first ? r.from : r.to), q2.x) || crowded(r, q2.x, q0.y)) continue;
      const l = r.label;
      if (l && Math.abs(l.x + l.w / 2 - q0.x) < 1 && l.y + l.h / 2 > Math.min(q0.y, q1.y) && l.y + l.h / 2 < Math.max(q0.y, q1.y)) l.x += dx;
      const out = [{ x: q2.x, y: q0.y }, ...pts.slice(3)];
      r.pts = first ? out : out.reverse();
    }
  }
}

const segs = (r: Routed) => r.pts.slice(1).map((p, i) => [r.pts[i], p] as const);
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function crossings(routed: Routed[]) {
  const all = routed.map(segs);
  let c = 0;
  for (let a = 0; a < all.length; a++)
    for (let b = a + 1; b < all.length; b++)
      for (const [p, q] of all[a])
        for (const [r, s] of all[b]) {
          const d = (q.x - p.x) * (s.y - r.y) - (q.y - p.y) * (s.x - r.x);
          if (Math.abs(d) < 1e-9) continue;
          const t = ((r.x - p.x) * (s.y - r.y) - (r.y - p.y) * (s.x - r.x)) / d;
          const u = ((r.x - p.x) * (q.y - p.y) - (r.y - p.y) * (q.x - p.x)) / d;
          if (t > 0.01 && t < 0.99 && u > 0.01 && u < 0.99) c++;
        }
  return c;
}

const bends = (routed: Routed[]) => routed.reduce((s, r) => s + Math.max(0, r.pts.length - 2), 0);

function segHitsRect(a: Pt, b: Pt, r: Rect, inset: number) {
  const x0 = r.x + inset, y0 = r.y + inset, x1 = r.x + r.w - inset, y1 = r.y + r.h - inset;
  for (let k = 0; k <= 40; k++) {
    const t = k / 40, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    if (x > x0 && x < x1 && y > y0 && y < y1) return true;
  }
  return false;
}

function labelIssues(placed: LaidBox[], routed: Routed[]) {
  let n = 0;
  const labs = routed.filter((r) => r.label);
  for (let i = 0; i < labs.length; i++) for (let j = i + 1; j < labs.length; j++) if (overlap(labs[i].label!, labs[j].label!)) n++;
  for (const r of labs) for (const p of placed) if (overlap(r.label!, p)) n++;
  for (const r of routed) {
    for (const p of placed) if (segs(r).some(([a, b]) => segHitsRect(a, b, p, 2))) n++;
    for (const o of labs) if (o !== r && segs(r).some(([a, b]) => segHitsRect(a, b, o.label!, 1))) n++;
  }
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) if (overlap(placed[i], placed[j])) n++;
  return n;
}

const FRAME = 10;
const CLEAR = 14;
const LONE_GAP = 16;

function fitLone(lone: DiagramBox[], width: Map<string, number>, placed: LaidBox[], routed: Routed[]) {
  if (!lone.length || !placed.length) return null;
  const obs: Rect[] = [...placed.map(({ x, y, w, h }) => ({ x, y, w, h })), ...routed.flatMap((r) => (r.label ? [r.label] : []))];
  for (const r of routed)
    for (const [a, b] of segs(r))
      obs.push({ x: Math.min(a.x, b.x) - 1, y: Math.min(a.y, b.y) - 1, w: Math.abs(b.x - a.x) + 2, h: Math.abs(b.y - a.y) + 2 });
  const minX = Math.min(...obs.map((o) => o.x)), minY = Math.min(...obs.map((o) => o.y));
  const maxX = Math.max(...obs.map((o) => o.x + o.w)), maxY = Math.max(...obs.map((o) => o.y + o.h));
  for (let cols = lone.length; cols >= 1; cols--) {
    const rows: DiagramBox[][] = [];
    for (let i = 0; i < lone.length; i += cols) rows.push(lone.slice(i, i + cols));
    const rw = rows.map((r) => r.reduce((s, b) => s + width.get(b.id)!, 0) + LONE_GAP * (r.length - 1));
    const w = Math.max(...rw);
    const h = rows.length * BOX_H + LONE_GAP * (rows.length - 1);
    for (const [cx, cy] of [[0, 1], [1, 1], [0, 0], [1, 0]]) {
      const x = cx ? maxX - FRAME - w : minX + FRAME;
      const y = cy ? maxY - FRAME - h : minY + FRAME;
      if (x < minX + FRAME - 0.5 || y < minY + FRAME - 0.5) continue;
      const pad = FRAME + CLEAR;
      if (obs.some((o) => overlap({ x: x - pad, y: y - pad, w: w + 2 * pad, h: h + 2 * pad }, o))) continue;
      const boxes: LaidBox[] = [];
      rows.forEach((r, i) => {
        let xx = x + (w - rw[i]) / 2;
        for (const b of r) {
          boxes.push({ x: xx, y: y + i * (BOX_H + LONE_GAP), w: width.get(b.id)!, h: BOX_H, b });
          xx += width.get(b.id)! + LONE_GAP;
        }
      });
      return { boxes, frame: { x: x - FRAME, y: y - FRAME, w: w + 2 * FRAME, h: h + 2 * FRAME } };
    }
  }
  return null;
}

function loneRows(lone: DiagramBox[], width: Map<string, number>, maxW: number) {
  const rows: DiagramBox[][] = [[]];
  let rw = 0;
  for (const b of lone) {
    const w = width.get(b.id)!;
    if (rows.at(-1)!.length && rw + 20 + w > maxW) {
      rows.push([]);
      rw = 0;
    }
    rw += (rows.at(-1)!.length ? 20 : 0) + w;
    rows.at(-1)!.push(b);
  }
  return rows;
}

function score(L: Omit<Layout, "score" | "order" | "opts">, lone: DiagramBox[], width: Map<string, number>, loneH: number) {
  if (loneH && fitLone(lone, width, L.placed, L.routed)) loneH = 0;
  const H = L.H + loneH;
  const yOf = new Map(L.placed.map((p) => [p.b.id, p.y]));
  const up = L.routed.filter((r) => !r.e.both && yOf.get(r.from)! > yOf.get(r.to)!).length;
  const len = L.routed.reduce((s, r) => s + segs(r).reduce((t, [a, b]) => t + Math.abs(b.x - a.x) + Math.abs(b.y - a.y), 0), 0);
  return (
    labelIssues(L.placed, L.routed) * 1000 +
    up * 150 +
    crossings(L.routed) * 250 +
    bends(L.routed) * 14 +
    L.routed.filter((r) => r.label && !r.e.both && r.label.lines.length > 1).length * 25 +
    len / 100 +
    Math.max(0, L.W - MAX_W) * 3 +
    Math.max(0, H - MAX_H) * 2 +
    (L.W * H) / 10000
  );
}

export async function layoutDiagramElk(block: Block, elk: Elk): Promise<DiagramLayout> {
  const edges = prepare(block);
  const width = new Map(block.boxes.map((b) => [b.id, boxWidth(b)]));
  const byId = new Map(block.boxes.map((b) => [b.id, b]));
  const rank = new Map(block.boxes.map((b, i) => [b.id, i]));
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
  const connected = block.boxes.filter((b) => linked.has(b.id));
  const lone = block.boxes.filter((b) => !linked.has(b.id));
  const loneH = lone.length ? loneRows(lone, width, MAX_W).length * (BOX_H + 16) + 16 : 0;
  const stackCache = new Map<boolean, Stack[]>();
  const stacksFor = (wrap: boolean) => {
    if (!stackCache.has(wrap)) stackCache.set(wrap, stackPlan(edges, width, rank, wrap));
    return stackCache.get(wrap)!;
  };
  const ctx: Ctx = { edges, width, byId, stacksFor };

  let best: Layout | null = null;
  if (connected.length) {
    const tried: Layout[] = [];
    const attempt = async (order: string[], opts: Opts) => {
      const L = await layoutOnce(elk, ctx, order, opts);
      const done = { ...L, score: score(L, lone, width, loneH), order, opts };
      tried.push(done);
      if (!best || done.score < best.score) best = done;
    };
    const ordersFor = (stack: boolean) => {
      const stacks = stack ? stacksFor(false) : [];
      const hidden = new Set(stacks.flatMap((g) => g.items.map((it) => it.leaf)));
      const hiddenE = new Set(stacks.flatMap((g) => g.items.map((it) => it.e)));
      const nodes = [...connected.map((b) => b.id).filter((id) => !hidden.has(id)), ...stacks.map((g) => g.id)];
      const es = [
        ...edges.filter((e) => !hiddenE.has(e)),
        ...stacks.map((g) => ({ from: g.out ? g.parent : g.id, to: g.out ? g.id : g.parent })),
      ];
      const rankOf = (n: string) => rank.get(n) ?? rank.get(stacks.find((g) => g.id === n)!.items[0].leaf)!;
      return candidateOrders(nodes, es, rankOf);
    };
    const hasStacks = stacksFor(false).length > 0;
    for (const stack of hasStacks ? [true, false] : [false])
      for (const o of ordersFor(stack)) await attempt(o, { stack, wrapLabels: false, elk: {} });
    const top = [...tried].sort((a, b) => a.score - b.score).slice(0, 2);
    const avgW = connected.reduce((s, b) => s + width.get(b.id)!, 0) / connected.length;
    const bound = Math.max(2, Math.floor((MAX_W + 28) / (avgW + 60)));
    const CG = (n: number) => ({ "elk.layered.layering.strategy": "COFFMAN_GRAHAM", "elk.layered.layering.coffmanGraham.layerBound": String(n) });
    const NS = { "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX" };
    const TIGHT = { "elk.spacing.nodeNode": "20", "elk.spacing.edgeNode": "10", "elk.spacing.edgeEdge": "10" };
    const FREE = {
      "elk.layered.considerModelOrder.strategy": "NONE",
      "elk.layered.thoroughness": "40",
      "elk.layered.crossingMinimization.greedySwitch.type": "TWO_SIDED",
    };
    const variants: Omit<Opts, "stack">[] = [
      { wrapLabels: true, elk: {} },
      { wrapLabels: true, elk: NS },
      { wrapLabels: false, elk: NS },
      { wrapLabels: true, elk: CG(bound) },
      { wrapLabels: true, elk: { ...CG(bound), ...NS } },
      { wrapLabels: true, elk: { ...CG(bound + 1), ...NS } },
      { wrapLabels: false, elk: { ...CG(bound), ...NS } },
      { wrapLabels: true, elk: { ...FREE, ...NS } },
      { wrapLabels: true, elk: FREE },
      { wrapLabels: true, elk: { ...TIGHT, ...NS } },
      { wrapLabels: true, elk: { ...TIGHT, ...CG(bound), ...NS } },
      { wrapLabels: true, elk: NS, stackEdge: true },
      { wrapLabels: true, elk: {}, stackEdge: true },
    ];
    for (const T of top) for (const v of variants) if (!v.stackEdge || T.opts.stack) await attempt(T.order, { ...v, stack: T.opts.stack });
  }
  return finish(best ?? { placed: [], routed: [] }, lone, width);
}

function finish(L: { placed: LaidBox[]; routed: Routed[] }, lone: DiagramBox[], width: Map<string, number>): DiagramLayout {
  const placed = L.placed.map((p) => ({ ...p }));
  const routed = L.routed.map((r) => ({ ...r, pts: r.pts.map((p) => ({ ...p })), label: r.label && { ...r.label } }));
  const xs = [...placed.flatMap((p) => [p.x, p.x + p.w]), ...routed.flatMap((r) => [...r.pts.map((p) => p.x), ...(r.label ? [r.label.x, r.label.x + r.label.w] : [])])];
  const ys = [...placed.flatMap((p) => [p.y, p.y + p.h]), ...routed.flatMap((r) => [...r.pts.map((p) => p.y), ...(r.label ? [r.label.y, r.label.y + r.label.h] : [])])];
  const minX = xs.length ? Math.min(...xs) - M : 0;
  const minY = ys.length ? Math.min(...ys) - M : 0;
  let W = xs.length ? Math.max(...xs) + M - minX : 0;
  let H = ys.length ? Math.max(...ys) + M - minY : 0;
  const shift = (dx: number, dy: number) => {
    for (const p of placed) {
      p.x += dx;
      p.y += dy;
    }
    for (const r of routed) {
      r.pts = r.pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      if (r.label) {
        r.label.x += dx;
        r.label.y += dy;
      }
    }
  };
  shift(-minX, -minY);

  const rules: DiagramLayout["rules"] = [];
  const frames: Rect[] = [];
  const fit = fitLone(lone, width, placed, routed);
  const colW = lone.length ? Math.max(...lone.map((b) => width.get(b.id)!)) : 0;
  const colH = lone.length * BOX_H + 16 * Math.max(0, lone.length - 1);
  const side = lone.length > 0 && !fit && placed.length > 0 && W + 48 + colW + M <= MAX_W && colH + 30 <= Math.max(H, 300);
  if (fit) {
    placed.push(...fit.boxes);
    frames.push(fit.frame);
  } else if (side) {
    const x0 = W + 40;
    let y = M;
    for (const b of lone) {
      const w = width.get(b.id)!;
      placed.push({ x: x0 + (colW - w) / 2, y, w, h: BOX_H, b });
      y += BOX_H + 16;
    }
    W = x0 + colW + M;
    H = Math.max(H, y - 16 + M);
    rules.push({ x1: x0 - 20, y1: 0, x2: x0 - 20, y2: H });
  } else if (lone.length) {
    const rows = loneRows(lone, width, Math.max(MAX_W, colW));
    const rowW = rows.map((r) => r.reduce((s, b) => s + width.get(b.id)!, 0) + 20 * (r.length - 1));
    const full = Math.max(W, ...rowW.map((w) => w + 2 * M));
    const before = placed.length;
    let top = before ? H + 16 : M;
    rows.forEach((r, i) => {
      let x = (full - rowW[i]) / 2;
      for (const b of r) {
        placed.push({ x, y: top, w: width.get(b.id)!, h: BOX_H, b });
        x += width.get(b.id)! + 20;
      }
      top += BOX_H + 16;
    });
    if (full > W) shiftSome(placed.slice(0, before), routed, (full - W) / 2);
    if (before) rules.push({ x1: 0, y1: H + 8, x2: full, y2: H + 8 });
    W = full;
    H = top - 16 + M;
  }

  const arrows: LaidArrow[] = routed.map((r) => {
    const a = r.pts[0];
    const z = r.pts.at(-1)!;
    const across = Math.abs(z.y - a.y) < BOX_H / 2;
    const [go, back] = across ? (z.x >= a.x ? ["→", "←"] : ["←", "→"]) : z.y >= a.y ? ["↓", "↑"] : ["↑", "↓"];
    const lines: LabelLine[] = r.e.both
      ? [
          { text: `${go} ${r.e.fwd}`, from: r.e.from, to: r.e.to },
          { text: `${back} ${r.e.back}`, from: r.e.to, to: r.e.from },
        ]
      : (r.label?.lines ?? []).map((text) => ({ text, from: r.e.from, to: r.e.to }));
    const shown = lines.filter((l) => l.text.trim());
    return {
      from: r.e.from,
      to: r.e.to,
      d: pathD(r.pts),
      tone: r.e.tone,
      start: r.heads.start,
      end: r.heads.end,
      label: r.label && shown.length ? { x: r.label.x, y: r.label.y, w: r.label.w, h: r.label.h, lines: shown } : undefined,
    };
  });
  return { W: Math.ceil(W), H: Math.ceil(H), boxes: placed, arrows, rules, frames };
}

function shiftSome(boxes: LaidBox[], routed: Routed[], dx: number) {
  for (const p of boxes) p.x += dx;
  for (const r of routed) {
    r.pts = r.pts.map((p) => ({ x: p.x + dx, y: p.y }));
    if (r.label) r.label.x += dx;
  }
}

const r1 = (n: number) => Math.round(n * 10) / 10;

function pathD(pts: Pt[]) {
  let s = `M${r1(pts[0].x)},${r1(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i], a = pts[i - 1], b = pts[i + 1];
    const la = Math.hypot(p.x - a.x, p.y - a.y), lb = Math.hypot(b.x - p.x, b.y - p.y);
    const rr = Math.min(RADIUS, la / 2, lb / 2);
    if (rr < 0.5) {
      s += ` L${r1(p.x)},${r1(p.y)}`;
      continue;
    }
    const p1 = { x: p.x + ((a.x - p.x) / la) * rr, y: p.y + ((a.y - p.y) / la) * rr };
    const p2 = { x: p.x + ((b.x - p.x) / lb) * rr, y: p.y + ((b.y - p.y) / lb) * rr };
    s += ` L${r1(p1.x)},${r1(p1.y)} Q${r1(p.x)},${r1(p.y)} ${r1(p2.x)},${r1(p2.y)}`;
  }
  const z = pts.at(-1)!;
  return `${s} L${r1(z.x)},${r1(z.y)}`;
}

/** The landing's dagre-style layout (lib/blueprint/dagre.ts) in the same shape, labels in pills. */
export function dagreLayout(block: Block): DiagramLayout {
  const { W, H, boxes, arrows, band } = layoutDagre(block);
  return {
    W,
    H,
    boxes: boxes.map((p) => ({ ...p, h: BOX_H })),
    arrows: arrows.map(({ from, to, d, tone, label, both, pill, lines }) => {
      const base = { from, to, d, tone, start: Boolean(both), end: true };
      if (!label) return base;
      const rect = pill ?? labelRect(label);
      const texts = lines ?? [label.text];
      const ways = (k: number) => (both && texts.length === 2 && k === 1 ? { from: to, to: from } : { from, to });
      return { ...base, label: { ...rect, pill: Boolean(pill), lines: texts.map((text, k) => ({ text, ...ways(k) })) } };
    }),
    rules: band === undefined ? [] : [{ x1: 0, y1: band, x2: W, y2: band }],
    frames: [],
  };
}

function labelRect(label: { text: string; x: number; y: number; anchor: "start" | "middle" | "end" }): Rect {
  const w = label.text.length * LABEL_CHAR + 8;
  const x = label.anchor === "middle" ? label.x - w / 2 : label.anchor === "end" ? label.x - w + 4 : label.x - 4;
  return { x, y: label.y - 13, w, h: 18 };
}

/** The grid layout in the same shape, drawn while ELK works and wherever it fails. */
export function gridLayout(block: Block): DiagramLayout {
  const { W, H, boxes, arrows } = layoutDiagram(block);
  return {
    W,
    H,
    boxes: boxes.map((p) => ({ ...p, h: BOX_H })),
    arrows: arrows.map(({ from, to, d, tone, label }) =>
      label
        ? { from, to, d, tone, start: false, end: true, label: { ...labelRect(label), lines: [{ text: label.text, from, to }] } }
        : { from, to, d, tone, start: false, end: true },
    ),
    rules: [],
    frames: [],
  };
}
