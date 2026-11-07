/**
 * The map following the code as it is typed, before any model has looked.
 *
 * While a project's map is open (app/api/map polls it each second), its
 * checkout is watched. Each save works out, with no model call, what an
 * update would start from: which files differ from what the map describes,
 * which sections cite the lines that changed, and where every cited line has
 * moved to. The page marks those sections at once and reads its code at the
 * moved lines; the update that rewrites them (lib/vault.ts, updateMap) is
 * asked for once the edits settle (components/statusbar.tsx).
 *
 * What the map describes: base.json after updates, the map's commit before
 * the first. While an update runs, moved.json once it has written the map:
 * that map cites the code as the update found it (scripts/generate/update.ts).
 */
import { createHash } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Node } from "@/lib/data";
import type { MapFile } from "@/lib/map";
import { diffOf, git, moved, readText, refs, touches, type Base, type Change } from "@/scripts/generate/gitdiff";
import { sourcePath } from "@/scripts/generate/inventory";
import { getProject, mapFileOf, projectDir } from "@/lib/vault";

/** What the open page is told: the files that moved and the sections they touch. */
export interface Live {
  seq: number;
  /** Changes with every save of a changed file, so the page can tell when the edits have stopped. */
  sig: string;
  files: { path: string; add: number; del: number }[];
  /** Each touched section, as its path of ids from the top, with the changed files it cites; deepest first. */
  touched: { path: string[]; files: string[] }[];
}

interface Watch {
  root: string;
  watcher?: FSWatcher;
  /** When the page last asked; a watch nobody asks about is closed. */
  seen: number;
  /** Something under the checkout changed since the last look. */
  dirty: boolean;
  timer?: ReturnType<typeof setTimeout>;
  /** The stamps of the map and its base when last worked out, so an update landing is a change too. */
  stamp: string;
  looked: number;
  changes: Map<string, Change>;
  live: Live;
}

/** Kept on globalThis, so a hot reload of this module in dev does not leave its watchers running unowned. */
const watches: Map<string, Watch> = ((globalThis as { __bluprintLive?: Map<string, Watch> }).__bluprintLive ??= new Map());

const IDLE_MS = 30_000;
const DEBOUNCE_MS = 150;
/** Without a watcher (a platform fs.watch cannot recurse on), the poll looks this often instead. */
const UNWATCHED_MS = 5_000;
/** Never worth a git call: the repository's own bookkeeping, and installed packages. */
const NOISE = /(^|[\\/])(\.git|node_modules)([\\/]|$)/;

const mtime = (f: string) => statSync(f, { throwIfNoEntry: false })?.mtimeMs ?? 0;

function readJson<T>(f: string, empty: T): T {
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return empty;
  }
}

/** What the map describes, per path, where it is not the map's commit. */
function baseOf(id: string): Base {
  const dir = projectDir(id);
  const base = readJson<Base>(join(dir, "base.json"), {});
  // A running update's moved lines are in the map once it has written the map
  // since; one left by a run that died describes nothing.
  const m = join(dir, "moved.json");
  const moving = getProject(id)?.update?.status === "running" && mtime(join(dir, "map.json")) > mtime(m);
  return moving ? { ...base, ...readJson<Base>(m, {}) } : base;
}

const stampOf = (id: string) => {
  const dir = projectDir(id);
  return [mtime(join(dir, "map.json")), mtime(join(dir, "base.json")), mtime(join(dir, "moved.json"))].join(":");
};

function walk(nodes: Node[], at: string[] = [], out: { node: Node; path: string[] }[] = []) {
  for (const n of nodes) {
    out.push({ node: n, path: [...at, n.id] });
    walk(n.children ?? [], [...at, n.id], out);
  }
  return out;
}

/**
 * Every file that differs from what the map describes, as an update would
 * take it (update.ts `found`; the files list `?behind=1`), against the map as
 * it is on disk. A diff already worked out for the same text is kept.
 */
function work(id: string, w: Watch) {
  const file = mapFileOf(id);
  if (!file) return;
  const map: MapFile = readJson(file, { RUN: { commit: "" }, AUTHORED: [] } as unknown as MapFile);
  const base = baseOf(id);
  const all = walk(map.AUTHORED);
  const cited = new Set(all.flatMap((p) => refs(p.node).map((r) => r.file)));
  const commit = map.RUN.commit;
  const paths = new Set([
    ...(commit ? git(w.root, "diff", "--name-only", "--relative", commit).split("\n") : []),
    ...git(w.root, "ls-files", "--others", "--exclude-standard").split("\n"),
    ...Object.keys(base),
  ]);
  paths.delete("");
  const changes = new Map<string, Change>();
  for (const path of [...paths].sort()) {
    const after = readText(join(w.root, path));
    if (!(after === null ? cited.has(path) : sourcePath(path) || cited.has(path))) continue;
    const before = path in base ? base[path] : commit && hasAt(w.root, commit, path) ? git(w.root, "show", `${commit}:./${path}`) : null;
    if (before === after) continue;
    const had = w.changes.get(path);
    changes.set(path, had && had.before === before && had.after === after ? had : { path, before, after, ...diffOf(path, before, after) });
  }

  const touched = all
    .map((p) => ({ path: p.path, files: [...new Set(refs(p.node).filter((r) => changes.has(r.file) && touches(changes.get(r.file)!, r.s, r.e)).map((r) => r.file))] }))
    .filter((t) => t.files.length)
    .sort((a, b) => b.path.length - a.path.length);
  const files = [...changes.values()].map((c) => ({
    path: c.path,
    add: c.hunks.reduce((n, h) => n + h.nl, 0),
    del: c.hunks.reduce((n, h) => n + h.ol, 0),
  }));
  w.changes = changes;
  const hash = createHash("sha1");
  for (const c of changes.values()) hash.update(`${c.path}\0${c.after ?? "\u0000gone"}\0`);
  const next = { sig: changes.size ? hash.digest("hex").slice(0, 16) : "", files, touched };
  if (JSON.stringify(next) !== JSON.stringify({ sig: w.live.sig, files: w.live.files, touched: w.live.touched })) w.live = { seq: w.live.seq + 1, ...next };
}

/** Whether `path` exists at `commit`, quietly: `git` here swallows the failure as empty output. */
function hasAt(root: string, commit: string, path: string) {
  return git(root, "rev-parse", "--verify", "--quiet", `${commit}:./${path}`).trim() !== "";
}

/** A burst of events, once it stops: anything git does not ignore makes the next look work it out again. */
function settle(w: Watch, names: Set<string>) {
  clearTimeout(w.timer);
  w.timer = setTimeout(() => {
    const list = [...names];
    names.clear();
    const ignored = new Set(
      git(w.root, "check-ignore", "--", ...list)
        .split("\n")
        .filter(Boolean),
    );
    if (list.some((n) => !ignored.has(n))) w.dirty = true;
  }, DEBOUNCE_MS);
}

function open(id: string, root: string): Watch {
  const w: Watch = { root, seen: Date.now(), dirty: true, stamp: "", looked: 0, changes: new Map(), live: { seq: 0, sig: "", files: [], touched: [] } };
  const names = new Set<string>();
  try {
    w.watcher = watch(root, { recursive: true }, (_event, name) => {
      if (!name || NOISE.test(name)) return;
      names.add(name.split("\\").join("/"));
      settle(w, names);
    });
    w.watcher.on("error", () => {
      w.watcher?.close();
      w.watcher = undefined;
    });
  } catch {
    // No recursive watching here: the poll looks every UNWATCHED_MS instead.
  }
  watches.set(id, w);
  return w;
}

/** Closes the watches no page has asked about lately. */
function sweep() {
  for (const [id, w] of watches)
    if (Date.now() - w.seen > IDLE_MS) {
      clearTimeout(w.timer);
      w.watcher?.close();
      watches.delete(id);
    }
}
const g = globalThis as { __bluprintLiveSweep?: ReturnType<typeof setInterval> };
g.__bluprintLiveSweep ??= setInterval(sweep, IDLE_MS / 3);
g.__bluprintLiveSweep.unref?.();

/**
 * The open page asking: starts watching the checkout if nothing was, and
 * brings what is known up to date when the code, the map or its base moved.
 */
export function followLive(id: string, root: string): Watch | undefined {
  if (!existsSync(root) || !mapFileOf(id)) return undefined;
  let w = watches.get(id);
  if (w && w.root !== root) {
    w.watcher?.close();
    w = undefined;
  }
  w ??= open(id, root);
  w.seen = Date.now();
  if (!w.watcher && Date.now() - w.looked >= UNWATCHED_MS) w.dirty = true;
  const stamp = stampOf(id);
  if (w.dirty || stamp !== w.stamp) {
    w.dirty = false;
    w.stamp = stamp;
    w.looked = Date.now();
    try {
      work(id, w);
    } catch {
      // A file mid-write: the next save, or the next poll, looks again.
      w.dirty = true;
    }
  }
  return w;
}

/** What is known of a project's live changes, without looking again. */
export function liveOf(id: string): Live | undefined {
  return watches.get(id)?.live;
}

/** Every cited line in `map` moved to where its code is now, so the page reads the right lines while the code is ahead. */
export function shiftRefs(id: string, map: MapFile): MapFile {
  const changes = watches.get(id)?.changes;
  if (!changes?.size) return map;
  for (const p of walk(map.AUTHORED)) refs(p.node, (f, line) => (changes.has(f) ? moved(changes.get(f)!, line) : line));
  return map;
}
