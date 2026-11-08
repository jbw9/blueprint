"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { buildBluprint, LIVE_SEP, type BuiltBluprint, type BluprintFile } from "@/lib/bluprint/build";
import type { Live as CodeLive } from "@/lib/server/live";
import type { BluprintEntry } from "@/lib/server/bluprints";
import type { Node } from "@/lib/bluprint/schema";
import type { Progress } from "@/lib/server/vault";
import { changedPaths } from "@/lib/bluprint/share";
import { updateBluprint } from "@/lib/agent/update-bluprint";

/**
 * What the last rewrite of the bluprint changed: the paths of every node it added
 * or altered (lib/bluprint/share.ts), and when, so components/bluprint/flash.tsx can light each
 * one that is on screen once.
 */
export interface Fresh {
  at: number;
  paths: ReadonlySet<string>;
}

const NONE: Fresh = { at: 0, paths: new Set() };

/** The bluprints this page load has asked to catch up with their code. */
const asked = new Set<string>();

/**
 * `progress`: the run making this bluprint, while there is one (D69). `live`: how
 * far the code has moved past the bluprint while it is open (lib/server/live.ts).
 * `pending`: an update's rewrite of the level on screen, held back so the
 * picture does not change under the reader; `onScreen` says which level that
 * is, and `apply` takes the rewrite in.
 */
const BluprintContext = createContext<
  | (BuiltBluprint & {
      bluprints: BluprintEntry[];
      fresh: Fresh;
      progress?: Progress;
      live?: CodeLive;
      pending: boolean;
      onScreen: (path: string[]) => void;
      apply: () => void;
    })
  | null
>(null);

/** How often the open bluprint looks for a newer file of itself. */
const POLL_MS = 1000;

interface Live {
  /** The file the server last rendered, to tell a new one from a re-render. */
  prop: BluprintFile;
  bluprint: BuiltBluprint;
  fresh: Fresh;
  progress?: Progress;
  code?: CodeLive;
  /** An update's newer bluprint, not yet shown because it changes the level on screen. */
  held?: BluprintFile;
}

/** A node as its level draws it: its own content, and which parts it has, not what is inside them. */
const own = (n: Node | null) => (n ? JSON.stringify({ ...n, children: n.children?.map((c) => c.id) }) : "");

/** Whether `next` changes what the level at `path` draws: its own content, or a part's row or box. */
function redraws(prev: BuiltBluprint, next: BuiltBluprint, path: string[]) {
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
 * `bluprint` rebuilt from `file`, keeping what did not change, and what did. With
 * `moved` only the code moved, not the bluprint: its lines shifted, which is not a
 * rewrite to light.
 */
function adopt(live: Live, file: BluprintFile, moved = false): Live {
  const bluprint = buildBluprint(file, live.bluprint.name, live.bluprint);
  const paths = moved ? [] : changedPaths(live.bluprint.TOP, bluprint.TOP);
  if (bluprint.TOP === live.bluprint.TOP && bluprint.RUN === live.bluprint.RUN) return live;
  return { ...live, bluprint, fresh: paths.length ? { at: Date.now(), paths: new Set(paths) } : live.fresh };
}

/** The part of a version that is the bluprint on disk (lib/server/bluprints.ts, bluprintVersion). */
const diskOf = (version: string | undefined) => version?.split(LIVE_SEP)[0];

/**
 * The bluprint on screen. Read on the server, built here, and followed while the
 * generator or an update rewrites it: a project's bluprint polls `/api/bluprint` and
 * takes each new file in place, so the sections being written appear as they
 * land and nothing else on the page moves.
 */
export function BluprintProvider({
  name,
  file,
  version,
  progress,
  bluprints,
  children,
}: {
  name: string;
  file: BluprintFile;
  /** The file's version as the server read it; absent for a bluprint that never changes (a demo, a static export). */
  version?: string;
  progress?: Progress;
  bluprints: BluprintEntry[];
  children: React.ReactNode;
}) {
  const [live, setLive] = useState<Live>(() => ({ prop: file, bluprint: buildBluprint(file, name), fresh: NONE, progress, code: file.LIVE }));
  // A new render from the server — a refresh, or another bluprint — is taken the
  // same way a poll is; another bluprint starts over.
  if (live.prop !== file) {
    const next = live.bluprint.name === name ? adopt(live, file) : { bluprint: buildBluprint(file, name), fresh: NONE };
    setLive({ ...next, prop: file, progress, code: file.LIVE });
  }

  // Opened, a project's bluprint catches up with code that moved while it was
  // closed: a pull, an editor, a terminal outside the app. Only the sections
  // whose cited code changed are redone, and the poll below brings them in.
  // Once per bluprint a page load, so a remount does not ask again.
  const root = file.RUN.root;
  useEffect(() => {
    if (version === undefined || !root || asked.has(name)) return;
    asked.add(name);
    void updateBluprint(root, undefined, true);
  }, [name, version, root]);

  // The level the reader has open (components/bluprint/canvas.tsx), read when an update lands.
  const view = useRef<string[]>([]);

  const since = useRef(version);
  useEffect(() => {
    since.current = version;
    if (version === undefined) return;
    let busy = false;
    const tick = () => {
      if (busy || document.hidden) return;
      busy = true;
      fetch(`/api/bluprint?id=${encodeURIComponent(name)}&since=${encodeURIComponent(since.current ?? "")}`)
        .then((r) => r.json())
        .then((r: { version?: string; file?: BluprintFile; progress?: Progress | null } | null) => {
          const was = diskOf(since.current)?.split(":");
          const now = diskOf(r?.version)?.split(":");
          const moved = was?.join(":") === now?.join(":");
          // An update rewrote the bluprint (bluprint.json moved, the reader's own edits did not):
          // taken quietly, and held back where it would redraw the open level.
          const rewrote = !moved && !r?.progress && was?.length === 2 && now?.length === 2 && was[0] !== now[0] && was[1] === now[1];
          const file = r?.file;
          if (file)
            setLive((l) => {
              if (l.bluprint.name !== name) return l;
              const base = { code: file.LIVE, progress: r.progress ?? undefined };
              // The reader's own change, or a bluprint being made, shows at once; the file carries any held rewrite too.
              if (!rewrote && (!moved || !l.held)) return { ...adopt(l, file, moved), ...base, held: undefined };
              const next = buildBluprint(file, l.bluprint.name, l.bluprint);
              if (redraws(l.bluprint, next, view.current)) return { ...l, ...base, held: file };
              return { ...l, ...base, bluprint: next, held: undefined };
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
  const apply = useCallback(() => setLive((l) => (l.held ? { ...l, bluprint: buildBluprint(l.held, l.bluprint.name, l.bluprint), held: undefined } : l)), []);

  const code = live.code;
  const pending = Boolean(live.held);
  const value = useMemo(
    () => ({ ...live.bluprint, bluprints, fresh: live.fresh, progress: live.progress, live: code, pending, onScreen, apply }),
    [live.bluprint, live.fresh, live.progress, bluprints, code, pending, onScreen, apply],
  );
  return <BluprintContext.Provider value={value}>{children}</BluprintContext.Provider>;
}

export function useBluprint() {
  const m = useContext(BluprintContext);
  if (!m) throw new Error("useBluprint outside BluprintProvider");
  return m;
}

/** Each section whose code moved past the bluprint, and every section on the way down to it, with the changed files. */
export function useChangedCode(): Map<string, string[]> {
  const live = useContext(BluprintContext)?.live;
  return useMemo(() => {
    const out = new Map<string, string[]>();
    for (const t of live?.touched ?? []) for (const id of t.path) out.set(id, [...new Set([...(out.get(id) ?? []), ...t.files])]);
    return out;
  }, [live]);
}

/** The bluprint on screen, or null before the reader has any project to open. */
export function useMaybeBluprint() {
  return useContext(BluprintContext);
}
