"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useBlueprint } from "@/components/blueprint/blueprint-context";
import { openReview } from "@/components/review/diff";
import { openFiles, useFiles } from "@/components/blueprint/files";
import { openPalette } from "@/components/chrome/palette";
import { openProjects, remakeBlueprint } from "@/components/projects/projects";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { projectAction } from "@/lib/client/api";
import { claudePath } from "@/lib/client/claude";
import { UNFOLLOWED, claudeMidTurnIn, followTurn } from "@/lib/agent/turns";
import type { Node } from "@/lib/blueprint/schema";
import { STATIC_BLUEPRINT } from "@/lib/blueprint/source";
import { onCreditChanged, percent, readCredit, resetsAt, type Credit } from "@/lib/client/credit";
import { openSettings } from "@/lib/client/settings";
import { cn } from "@/lib/client/utils";
import { isDesktop, useDesktop } from "@/lib/client/platform";
import { openable } from "@/components/blueprint/nodes";
import { UpdatePill, setUpdateView, type RowState, type UpdateRow, type UpdateView } from "@/components/chrome/update-progress";
import type { Explain, UpdateSection } from "@/lib/server/vault";
import { invoke } from "@tauri-apps/api/core";

/**
 * The line along the bottom of the window: what is true of the whole blueprint,
 * whatever level is open. Which commit it describes, the problems it found,
 * whether an update is running, and the two keys that get you
 * anywhere. It is the one place this lives, so no level has to repeat it.
 */
export function StatusBar() {
  const { name, blueprints, RUN, L0, TOP } = useBlueprint();
  const local = blueprints.some((m) => m.id === name && m.local);
  const [project, reread] = useProject(name, local);

  const problems = useMemo(() => {
    let problems = 0;
    const walk = (nodes: Node[]) => {
      for (const n of nodes) {
        problems += n.issues?.length ?? 0;
        walk(n.children ?? []);
      }
    };
    walk(L0);
    // The repository is a level too (D60): its problems count, as the list this opens includes them.
    problems += TOP.issues?.length ?? 0;
    return problems;
  }, [L0, TOP]);
  const files = useFiles();

  return (
    <footer data-chrome="bar" className="flex h-6 shrink-0 select-none items-center gap-0.5 border-t border-border-gray bg-surface-container-low px-2 text-[11.5px] text-muted-slate">
      {project ? (
        <BlueprintMenu id={name} commit={RUN.commit?.slice(0, 7)} p={project} onChanged={reread} />
      ) : (
        <Item title="The commit this blueprint describes" mono>
          <CommitIcon />
          {RUN.commit?.slice(0, 7) ?? "no commit"}
        </Item>
      )}
      {files?.added.length ? (
        <Item title="Files added since the blueprint was made — click to list them" onClick={() => openFiles("added")} className="text-amber-ink">
          {files.added.length} not on the blueprint yet
        </Item>
      ) : null}
      {problems ? (
        <Item title="Problems the blueprint found in the code — click to list them" onClick={() => openPalette("problems")} className="text-clay-ink">
          <span aria-hidden>⚠</span>
          {problems} {problems === 1 ? "problem" : "problems"}
        </Item>
      ) : null}
      <span className="min-w-0 flex-1" />
      <BlueprintUpdates key={name} id={name} p={project} root={RUN.root} local={local} />
      {STATIC_BLUEPRINT ? null : <UpdateReady />}
      {STATIC_BLUEPRINT ? null : <CreditLeft />}
    </footer>
  );
}

/** What is left of this 5-hour session's Blueprint credit, while tabs run on it (lib/server/credit.ts). */
/** A newer Blueprint, downloaded and staged (lib/server/update.ts); it goes in when the app next quits, or now. */
function UpdateReady() {
  const [ready, setReady] = useState<string | null>(null);
  useEffect(() => {
    if (!isDesktop()) return;
    const read = () =>
      void fetch("/api/update")
        .then((r) => r.json() as Promise<{ ready: string | null }>)
        .then((s) => setReady(s.ready), () => {});
    read();
    // Asking is local and cheap; the server looks for a release at most every 6 hours.
    const t = setInterval(read, 60_000);
    return () => clearInterval(t);
  }, []);
  if (!ready) return null;
  return (
    <Item title={`Blueprint ${ready} is downloaded. Restart to use it now, or it's used the next time Blueprint opens.`} onClick={() => void invoke("update_restart")} className="text-ink">
      Restart to update
    </Item>
  );
}

function CreditLeft() {
  const [c, setC] = useState<Credit | null>(null);
  useEffect(() => {
    const read = () => void readCredit().then(setC);
    read();
    // The window fills as tabs work, and it is cheap to ask.
    const t = setInterval(read, 60_000);
    const off = onCreditChanged(read);
    return () => {
      clearInterval(t);
      off();
    };
  }, []);
  const session = c?.available && c.on ? c.meters?.session : undefined;
  const used = session && percent(session);
  if (!c?.meters || !session || used == null) return null;
  const ends = resetsAt(session);
  const week = percent(c.meters.week);
  return (
    <Item
      title={`Blueprint credit: ${used}% of this session used${ends ? `, until ${ends}` : ""}${week != null ? `; ${week}% of the week` : ""}. Change it in Settings.`}
      onClick={openSettings}
    >
      Credit {100 - used}%{ends ? ` · ${ends}` : ""}
    </Item>
  );
}

function CommitIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <circle cx="8" cy="8" r="2.5" />
      <path d="M1 8h4.5M10.5 8H15" />
    </svg>
  );
}

/** The open project as the vault has it (app/api/projects/route.ts, GET with an id). */
interface ProjectState {
  status: "empty" | "generating" | "ready" | "failed" | "cancelled";
  paused: boolean;
  explain: Explain;
  update: Update | null;
  /** A running update's sections, as its log has them so far. */
  updating?: { found: boolean; sections: UpdateSection[] } | null;
}

/**
 * Follows the open project every 2 seconds, for its updates and for what its
 * blueprint menu offers. Only the user's own projects: an example is no project.
 * The second value reads it again at once, after an action changed it.
 */
function useProject(id: string, local: boolean): [ProjectState | null, () => void] {
  const [got, setGot] = useState<{ id: string; p: ProjectState | null } | null>(null);
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    if (!local) return;
    let live = true;
    const read = () =>
      fetch(`/api/projects?id=${encodeURIComponent(id)}`)
        .then((r) => r.json())
        .then((p: ProjectState | null) => live && setGot({ id, p }))
        .catch(() => {});
    void read();
    const timer = setInterval(read, 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [id, local, asked]);
  const reread = useCallback(() => setAsked((n) => n + 1), []);
  return [local && got?.id === id ? got.p : null, reread];
}

/**
 * The commit the blueprint describes, and what to do with the blueprint itself:
 * bring it up to the code, make it again, or stop it following the code. They
 * act on the blueprint that is open, so they are here rather than in Projects.
 */
function BlueprintMenu({ id, commit, p, onChanged }: { id: string; commit?: string; p: ProjectState; onChanged: () => void }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (body: () => Promise<Record<string, unknown>>) => {
    setError(null);
    try {
      await projectAction(await body());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    onChanged();
  };
  const generating = p.status === "generating";
  const updating = p.update?.status === "running";
  const items: MenuItem[] = [
    {
      label: "Update Blueprint",
      disabled: generating || updating || p.status !== "ready",
      onClick: () => void run(async () => ({ action: "regenerate", id, claude: await claudePath(), explain: p.explain })),
    },
    { label: "Remake Blueprint", disabled: generating, onClick: () => remakeBlueprint(id) },
    {
      label: p.paused ? "Start Auto-Updates" : "Stop Auto-Updates",
      disabled: generating,
      separated: true,
      onClick: () => void run(async () => ({ action: "pause", id, paused: !p.paused, claude: p.paused ? await claudePath() : undefined })),
    },
  ];
  return (
    <>
      <Item
        title={`The commit this blueprint describes${p.paused ? ". It no longer follows the code" : ""}. Update, remake, or stop updating it`}
        menu={Boolean(at)}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAt(at ? null : { x: r.left, y: r.top - 4 });
        }}
        className="mr-1 text-ink"
      >
        <CommitIcon />
        <span className="font-medium">Blueprint</span>
        <span className="font-mono text-[11px] text-muted-slate">{commit ?? "no commit"}</span>
        {p.paused ? <span className="text-amber-ink">· paused</span> : null}
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-muted-slate">
          <path d="m1.5 5 2.5-2.5L6.5 5" />
        </svg>
      </Item>
      {at ? <Menu x={at.x} y={at.y} up title={commit ? `Built from ${commit}` : "Not built from a commit"} items={items} onClose={() => setAt(null)} /> : null}
      {error ? (
        <Item title={`${error} Click to dismiss.`} onClick={() => setError(null)} className="min-w-0 text-clay-ink">
          <span className="truncate">✗ {error}</span>
        </Item>
      ) : null}
    </>
  );
}

function Item({
  children,
  title,
  onClick,
  menu,
  mono,
  className,
}: {
  children: React.ReactNode;
  title: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  /** Opens a menu; true while it is open. */
  menu?: boolean;
  mono?: boolean;
  className?: string;
}) {
  const cls = cn(
    "flex h-full shrink-0 items-center gap-1.5 rounded px-1.5 transition-colors duration-150",
    mono && "font-mono text-[11px]",
    onClick && "cursor-pointer hover:bg-surface-container hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
    menu && "bg-surface-container text-ink",
    className,
  );
  return onClick ? (
    <button type="button" title={title} onClick={onClick} aria-haspopup={menu === undefined ? undefined : "menu"} aria-expanded={menu} className={cls}>
      {children}
    </button>
  ) : (
    <span title={title} className={cls}>
      {children}
    </span>
  );
}

interface Update {
  status: "running" | "done" | "failed";
  startedAt?: string;
  finishedAt?: string;
  changed?: string[];
  sections?: string[];
  outcome?: UpdateSection[];
  error?: string;
}

/** Where a section sits on the blueprint: its nodes from the top, or null when it has none. */
function locate(roots: Node[], id: string): Node[] | null {
  for (const n of roots) {
    if (n.id === id) return [n];
    const below = locate(n.children ?? [], id);
    if (below) return [n, ...below];
  }
  return null;
}

/** A row of the update's list, placed on the blueprint. */
function rowOf(roots: Node[], id: string, state: RowState, title?: string): UpdateRow {
  const nodes = locate(roots, id);
  if (!nodes) return { id, title: title ?? id, trail: "", path: null, open: null, state };
  const path = nodes.map((n) => n.id);
  let shown = nodes.length;
  while (shown > 0 && !openable(nodes[shown - 1])) shown--;
  return {
    id,
    title: nodes[nodes.length - 1].title,
    trail: nodes.slice(0, -1).map((n) => n.title).join(" › "),
    path,
    open: path.slice(0, shown),
    state,
  };
}

/**
 * Follows the open blueprint while an agent changes its code, and says so in
 * the title bar's pill (components/chrome/update-progress.tsx), or here in a
 * browser, which has no title bar. Between commits: how many sections the code
 * moved past (lib/server/live.ts, followed with the blueprint each second).
 * While an update runs (lib/server/vault.ts): each section it took on, as it
 * lands. After: what it did, until the reader dismisses it or looks. The
 * blueprint takes each section as it lands by itself
 * (components/blueprint/blueprint-context.tsx). Only the user's own projects
 * update; an example describes some other copy of its code, so when an agent
 * edits its checkout this says so and offers to import it.
 *
 * The blueprint updates once per commit, and asks for one when HEAD moves. Not
 * while Claude is mid-turn in the checkout: its turn asks when it ends, with its
 * account of what it did. A commit is never retried after it failed, since each
 * try is a paid run; Update now runs regardless.
 */
const putKey = (id: string) => `blueprint:update-seen:${id}`;
function readPut(id: string): string | undefined {
  try {
    return localStorage.getItem(putKey(id)) ?? undefined;
  } catch {
    return undefined;
  }
}
function writePut(id: string, at?: string) {
  try {
    if (at) localStorage.setItem(putKey(id), at);
    else localStorage.removeItem(putKey(id));
  } catch {
    /* storage off: it is put away until the page reloads */
  }
}

function BlueprintUpdates({ id, p, root, local }: { id: string; p: ProjectState | null; root?: string; local: boolean }) {
  const u = p?.update ?? null;
  const desktop = useDesktop();
  const { live, L0 } = useBlueprint();
  const [unfollowed, setUnfollowed] = useState(false);

  useEffect(() => {
    const on = (e: Event) => (e as CustomEvent<string>).detail === root && setUnfollowed(true);
    window.addEventListener(UNFOLLOWED, on);
    return () => window.removeEventListener(UNFOLLOWED, on);
  }, [root]);

  // A finished update the reader dismissed or looked at, kept with the project
  // so a restart does not bring it back. Until then it stays.
  const [put, setPut] = useState<string | undefined>(() => readPut(id));
  const putAway = useCallback(
    (at?: string) => {
      setPut(at);
      writePut(id, at);
    },
    [id],
  );

  const behind = local ? (live?.files ?? []) : [];
  const head = local ? live?.head : undefined;
  // Updating by hand runs whatever is committed.
  const follow = useCallback(() => {
    if (root) void followTurn(root, { transcript: null, corrections: [] }, true);
  }, [root]);
  // A new commit updates the blueprint; the server runs it only for a HEAD it
  // has not updated at (lib/server/vault.ts). Claude mid-turn asks with its turn when it ends.
  // Paused, nothing follows: turning updates back on catches up (lib/server/vault.ts, setPaused).
  const paused = Boolean(p?.paused);
  useEffect(() => {
    if (!head || !root || paused || claudeMidTurnIn(root)) return;
    void followTurn(root, { transcript: null, corrections: [] });
  }, [head, root, paused]);

  const view = useMemo((): UpdateView | null => {
    if (!p) return null;
    const dismiss = () => putAway(u?.finishedAt);
    if (u?.status === "running") {
      const found = p.updating?.found ?? false;
      return {
        phase: found ? "running" : "finding",
        rows: (p.updating?.sections ?? []).map((s) => rowOf(L0, s.id, s.state, s.title)),
        startedAt: u.startedAt,
      };
    }
    if (u && u.finishedAt !== put && (u.status === "failed" || u.outcome?.length || u.sections?.length)) {
      const rows = u.outcome?.length ? u.outcome.map((s) => rowOf(L0, s.id, s.state, s.title)) : (u.sections ?? []).map((t) => ({ id: t, title: t, trail: "", path: null, open: null, state: "updated" as const }));
      return u.status === "done"
        ? { phase: "done", rows, startedAt: u.startedAt, finishedAt: u.finishedAt, dismiss, review: () => (dismiss(), openReview("turn:latest")) }
        : { phase: "failed", rows, startedAt: u.startedAt, finishedAt: u.finishedAt, error: u.error, dismiss, update: root ? follow : undefined };
    }
    if (!behind.length || !root) return null;
    // Deepest only: a section above another that moved is on the way to it, not behind itself.
    const touched = (live?.touched ?? []).filter((t) => !(live?.touched ?? []).some((o) => o !== t && o.path.length > t.path.length && t.path.every((id, i) => o.path[i] === id)));
    return {
      phase: "behind",
      rows: touched.map((t) => rowOf(L0, t.path[t.path.length - 1], "behind")),
      paused,
      update: paused ? undefined : follow,
    };
  }, [p, u, put, putAway, L0, live, behind.length, root, paused, follow]);

  useEffect(() => setUpdateView(view), [view]);
  useEffect(() => () => setUpdateView(null), []);

  if (unfollowed && root)
    return (
      <span className="mr-2 flex min-w-0 items-center gap-2 text-amber-ink">
        <span className="truncate" title="This blueprint was made from another copy of the code, so it cannot follow edits here.">
          This blueprint doesn&apos;t follow edits
        </span>
        <button
          type="button"
          onClick={() => {
            setUnfollowed(false);
            openProjects(root);
          }}
          className="shrink-0 cursor-pointer text-accent underline"
        >
          Import to keep it updated
        </button>
        <button type="button" onClick={() => setUnfollowed(false)} aria-label="Dismiss" className="shrink-0 cursor-pointer text-faint hover:text-ink">
          ×
        </button>
      </span>
    );
  return desktop ? null : <UpdatePill place="status" />;
}
