"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { buildMap, LIVE_SEP, type BuiltMap, type MapFile } from "@/lib/map";
import type { Live as CodeLive } from "@/lib/live";
import type { MapEntry } from "@/lib/maps";
import type { Node } from "@/lib/data";
import type { Progress } from "@/lib/vault";
import { changedPaths } from "@/lib/share";
import { updateMap } from "@/lib/update-map";

/**
 * What the last rewrite of the map changed: the paths of every node it added
 * or altered (lib/share.ts), and when, so components/flash.tsx can light each
 * one that is on screen once.
 */
export interface Fresh {
  at: number;
  paths: ReadonlySet<string>;
}

const NONE: Fresh = { at: 0, paths: new Set() };

/** The maps this page load has asked to catch up with their code. */
const asked = new Set<string>();

/**
 * `progress`: the run making this map, while there is one (D69). `live`: how
 * far the code has moved past the map while it is open (lib/live.ts).
 * `pending`: an update's rewrite of the level on screen, held back so the
 * picture does not change under the reader; `onScreen` says which level that
 * is, and `apply` takes the rewrite in.
 */
const MapContext = createContext<
  | (BuiltMap & {
      maps: MapEntry[];
      fresh: Fresh;
      progress?: Progress;
      live?: CodeLive;
      pending: boolean;
      onScreen: (path: string[]) => void;
      apply: () => void;
    })
  | null
>(null);

/** How often the open map looks for a newer file of itself. */
const POLL_MS = 1000;

interface Live {
  /** The file the server last rendered, to tell a new one from a re-render. */
  prop: MapFile;
  map: BuiltMap;
  fresh: Fresh;
  progress?: Progress;
  code?: CodeLive;
  /** An update's newer map, not yet shown because it changes the level on screen. */
  held?: MapFile;
}

/** A node as its level draws it: its own content, and which parts it has, not what is inside them. */
const own = (n: Node | null) => (n ? JSON.stringify({ ...n, children: n.children?.map((c) => c.id) }) : "");

/** Whether `next` changes what the level at `path` draws: its own content, or a part's row or box. */
function redraws(prev: BuiltMap, next: BuiltMap, path: string[]) {
  const a = prev.nodeAt(path);
  const b = next.nodeAt(path);
  if (a === b) return false;
  if (own(a) !== own(b)) return true;
  return (b?.children ?? []).some((c) => {
    const was = a?.children?.find((x) => x.id === c.id);
    return was !== c && own(was ?? null) !== own(c);
  });
}

/**
 * `map` rebuilt from `file`, keeping what did not change, and what did. With
 * `moved` only the code moved, not the map: its lines shifted, which is not a
 * rewrite to light.
 */
function adopt(live: Live, file: MapFile, moved = false): Live {
  const map = buildMap(file, live.map.name, live.map);
  const paths = moved ? [] : changedPaths(live.map.TOP, map.TOP);
  if (map.TOP === live.map.TOP && map.RUN === live.map.RUN) return live;
  return { ...live, map, fresh: paths.length ? { at: Date.now(), paths: new Set(paths) } : live.fresh };
}

/** The part of a version that is the map on disk (lib/maps.ts, mapVersion). */
const diskOf = (version: string | undefined) => version?.split(LIVE_SEP)[0];

/**
 * The map on screen. Read on the server, built here, and followed while the
 * generator or an update rewrites it: a project's map polls `/api/map` and
 * takes each new file in place, so the sections being written appear as they
 * land and nothing else on the page moves.
 */
export function MapProvider({
  name,
  file,
  version,
  progress,
  maps,
  children,
}: {
  name: string;
  file: MapFile;
  /** The file's version as the server read it; absent for a map that never changes (a demo, a static export). */
  version?: string;
  progress?: Progress;
  maps: MapEntry[];
  children: React.ReactNode;
}) {
  const [live, setLive] = useState<Live>(() => ({ prop: file, map: buildMap(file, name), fresh: NONE, progress, code: file.LIVE }));
  // A new render from the server — a refresh, or another map — is taken the
  // same way a poll is; another map starts over.
  if (live.prop !== file) {
    const next = live.map.name === name ? adopt(live, file) : { map: buildMap(file, name), fresh: NONE };
    setLive({ ...next, prop: file, progress, code: file.LIVE });
  }

  // Opened, a project's map catches up with code that moved while it was
  // closed: a pull, an editor, a terminal outside the app. Only the sections
  // whose cited code changed are redone, and the poll below brings them in.
  // Once per map a page load, so a remount does not ask again.
  const root = file.RUN.root;
  useEffect(() => {
    if (version === undefined || !root || asked.has(name)) return;
    asked.add(name);
    void updateMap(root);
  }, [name, version, root]);

  // The level the reader has open (components/canvas.tsx), read when an update lands.
  const view = useRef<string[]>([]);

  const since = useRef(version);
  useEffect(() => {
    since.current = version;
    if (version === undefined) return;
    let busy = false;
    const tick = () => {
      if (busy || document.hidden) return;
      busy = true;
      fetch(`/api/map?id=${encodeURIComponent(name)}&since=${encodeURIComponent(since.current ?? "")}`)
        .then((r) => r.json())
        .then((r: { version?: string; file?: MapFile; progress?: Progress | null } | null) => {
          const was = diskOf(since.current)?.split(":");
          const now = diskOf(r?.version)?.split(":");
          const moved = was?.join(":") === now?.join(":");
          // An update rewrote the map (map.json moved, the reader's own edits did not):
          // taken quietly, and held back where it would redraw the open level.
          const rewrote = !moved && !r?.progress && was?.length === 2 && now?.length === 2 && was[0] !== now[0] && was[1] === now[1];
          const file = r?.file;
          if (file)
            setLive((l) => {
              if (l.map.name !== name) return l;
              const base = { code: file.LIVE, progress: r.progress ?? undefined };
              // The reader's own change, or a map being made, shows at once; the file carries any held rewrite too.
              if (!rewrote && (!moved || !l.held)) return { ...adopt(l, file, moved), ...base, held: undefined };
              const next = buildMap(file, l.map.name, l.map);
              if (redraws(l.map, next, view.current)) return { ...l, ...base, held: file };
              return { ...l, ...base, map: next, held: undefined };
            });
          if (r?.version) since.current = r.version;
        })
        .catch(() => {})
        .finally(() => (busy = false));
    };
    const timer = setInterval(tick, POLL_MS);
    return () => clearInterval(timer);
  }, [name, version]);

  const onScreen = useCallback((path: string[]) => {
    view.current = path;
  }, []);
  const apply = useCallback(() => setLive((l) => (l.held ? { ...l, map: buildMap(l.held, l.map.name, l.map), held: undefined } : l)), []);

  const code = live.code;
  const pending = Boolean(live.held);
  const value = useMemo(
    () => ({ ...live.map, maps, fresh: live.fresh, progress: live.progress, live: code, pending, onScreen, apply }),
    [live.map, live.fresh, live.progress, maps, code, pending, onScreen, apply],
  );
  return <MapContext.Provider value={value}>{children}</MapContext.Provider>;
}

export function useMap() {
  const m = useContext(MapContext);
  if (!m) throw new Error("useMap outside MapProvider");
  return m;
}

/** Each section whose code moved past the map, and every section on the way down to it, with the changed files. */
export function useChangedCode(): Map<string, string[]> {
  const live = useContext(MapContext)?.live;
  return useMemo(() => {
    const out = new Map<string, string[]>();
    for (const t of live?.touched ?? []) for (const id of t.path) out.set(id, [...new Set([...(out.get(id) ?? []), ...t.files])]);
    return out;
  }, [live]);
}

/** The map on screen, or null before the reader has any project to open. */
export function useMaybeMap() {
  return useContext(MapContext);
}
