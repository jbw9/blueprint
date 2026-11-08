"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Kbd, keys } from "@/components/ui/button";
import { useBlueprint } from "@/components/blueprint/blueprint-context";
import { openReview } from "@/components/review/diff";
import { openFiles, useFiles } from "@/components/blueprint/files";
import { openPalette } from "@/components/chrome/palette";
import { openProjects } from "@/components/projects/projects";
import { UNFOLLOWED, claudeMidTurnIn, followTurn } from "@/lib/agent/turns";
import { toggleWorkspace } from "@/lib/agent/workspace-toggle";
import type { Node } from "@/lib/blueprint/schema";
import { STATIC_BLUEPRINT } from "@/lib/blueprint/source";
import { onCreditChanged, readCredit, type Credit } from "@/lib/client/credit";
import { tokens } from "@/components/chrome/settings";
import { openSettings } from "@/lib/client/settings";
import { cn } from "@/lib/client/utils";
import { useMac } from "@/lib/client/platform";

/**
 * The line along the bottom of the window: what is true of the whole blueprint,
 * whatever level is open. Which commit it describes, the problems it found,
 * whether an update is running, and the two keys that get you
 * anywhere. It is the one place this lives, so no level has to repeat it.
 */
export function StatusBar() {
  const { name, blueprints, RUN, L0, TOP } = useBlueprint();
  const local = blueprints.some((m) => m.id === name && m.local);

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
  const mac = useMac();

  return (
    <footer data-chrome="bar" className="flex h-6 shrink-0 select-none items-center gap-0.5 border-t border-border-gray bg-surface-container-low px-2 text-[11.5px] text-muted-slate">
      <Item title="The commit this blueprint describes" mono>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <circle cx="8" cy="8" r="2.5" />
          <path d="M1 8h4.5M10.5 8H15" />
        </svg>
        {RUN.commit?.slice(0, 7) ?? "no commit"}
      </Item>
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
      <BlueprintUpdates key={name} id={name} root={RUN.root} local={local} />
      {STATIC_BLUEPRINT ? null : <CreditLeft />}
      <Item title="Go to a level, or run an action" onClick={() => openPalette()}>
        Go to <Kbd className={KEY}>{keys(mac, "P")}</Kbd>
      </Item>
      {STATIC_BLUEPRINT ? null : (
        <Item title="Claude Code & terminal" onClick={toggleWorkspace}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
            <path d="M4.5 6.5 6.5 8l-2 1.5M8.5 10h3" />
          </svg>
          Workspace <Kbd className={KEY}>{keys(mac, "`")}</Kbd>
        </Item>
      )}
    </footer>
  );
}

/** What is left of this window's Blueprint credit, while tabs run on it (lib/server/credit.ts). */
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
  if (!c?.available || !c.on || c.limit == null) return null;
  const left = Math.max(0, 1 - (c.used ?? 0) / c.limit);
  const ends = c.resets ? new Date(c.resets).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
  return (
    <Item title={`Blueprint credit: ${tokens(c.used ?? 0)} of ${tokens(c.limit)} tokens used${ends ? `; the window ends at ${ends}` : ""}. Change it in Settings.`} onClick={openSettings}>
      Credit {Math.round(left * 100)}%{ends ? ` · ${ends}` : ""}
    </Item>
  );
}

/** A key, sized to the bar. */
const KEY = "h-[15px] min-w-[15px] text-[10px]";

function Item({
  children,
  title,
  onClick,
  mono,
  className,
}: {
  children: React.ReactNode;
  title: string;
  onClick?: () => void;
  mono?: boolean;
  className?: string;
}) {
  const cls = cn(
    "flex h-full shrink-0 items-center gap-1.5 px-1.5",
    mono && "font-mono text-[11px]",
    onClick && "cursor-pointer hover:bg-surface-container hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
    className,
  );
  return onClick ? (
    <button type="button" title={title} onClick={onClick} className={cls}>
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
  finishedAt?: string;
  changed?: string[];
  sections?: string[];
  error?: string;
}

/**
 * The section ids an update is rewriting right now, for the open level to say
 * so where the reader is looking (components/blueprint/canvas.tsx): the status bar alone
 * was missed, and a minute with nothing changing read as the update not working.
 */
let redoing: string[] = [];
const redoListeners = new Set<() => void>();
function setRedoing(next: string[]) {
  if (next.join("\n") === redoing.join("\n")) return;
  redoing = next;
  redoListeners.forEach((l) => l());
}
const NONE: string[] = [];
export function useRedoing(): string[] {
  return useSyncExternalStore(
    (l) => (redoListeners.add(l), () => redoListeners.delete(l)),
    () => redoing,
    () => NONE,
  );
}

/**
 * Follows the open blueprint while an agent changes its code: an update redoing
 * the touched sections (lib/server/vault.ts) shows here while it runs. The blueprint takes
 * each section as it lands by itself (components/blueprint/blueprint-context.tsx); this only
 * says what is happening. Only the user's own projects update; an
 * example describes some other copy of its code, so when an agent edits its
 * checkout this says so and offers to import it.
 *
 * The blueprint updates once per commit. Between commits this says how far the
 * code has moved from what the blueprint describes (lib/server/live.ts, followed
 * with the blueprint each second), and asks for an update when HEAD moves. Not
 * while Claude is mid-turn in the checkout: its turn asks when it ends, with its
 * account of what it did. A commit is never retried after it failed, since each
 * try is a paid run; Update now runs regardless.
 */
function BlueprintUpdates({ id, root, local }: { id: string; root?: string; local: boolean }) {
  const [u, setU] = useState<Update | null>(null);
  const [unfollowed, setUnfollowed] = useState(false);

  useEffect(() => {
    const on = (e: Event) => (e as CustomEvent<string>).detail === root && setUnfollowed(true);
    window.addEventListener(UNFOLLOWED, on);
    return () => window.removeEventListener(UNFOLLOWED, on);
  }, [root]);
  // The last finished update already on screen, so only a new one reloads.
  const seen = useRef<string | undefined>(undefined);
  const [fresh, setFresh] = useState(false);

  useEffect(() => {
    if (!local) return;
    let first = true;
    const tick = () =>
      fetch(`/api/projects?id=${encodeURIComponent(id)}`)
        .then((r) => r.json())
        .then((p: { update: Update | null; redoing?: string[] } | null) => {
          const next = p?.update ?? null;
          setU(next);
          setRedoing(next?.status === "running" ? (p?.redoing ?? []) : []);
          const done = next?.status !== "running" ? next?.finishedAt : undefined;
          if (!first && done && done !== seen.current) setFresh(true);
          if (done) seen.current = done;
          first = false;
        })
        .catch(() => {});
    void tick();
    const timer = setInterval(tick, 2000);
    return () => (clearInterval(timer), setRedoing([]));
  }, [id, local]);

  const { live } = useBlueprint();
  const behind = local ? (live?.files ?? []) : [];
  const head = local ? live?.head : undefined;
  // Updating by hand runs whatever is committed.
  const follow = () => {
    if (root) void followTurn(root, { transcript: null, corrections: [] }, true);
  };
  // A new commit updates the blueprint; the server runs it only for a HEAD it
  // has not updated at (lib/server/vault.ts). Claude mid-turn asks with its turn when it ends.
  useEffect(() => {
    if (!head || !root || claudeMidTurnIn(root)) return;
    void followTurn(root, { transcript: null, corrections: [] });
  }, [head, root]);

  useEffect(() => {
    if (!fresh) return;
    const t = setTimeout(() => setFresh(false), 15000);
    return () => clearTimeout(t);
  }, [fresh]);

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
  // A turn that changed nothing the blueprint covers passes silently.
  if (!u || (u.status === "done" && (!fresh || !u.sections?.length)))
    return behind.length && root ? (
      <span className="mr-2 flex min-w-0 items-center gap-2 text-amber-ink">
        <span className="truncate" title={behind.map((f) => `${f.path} +${f.add} −${f.del}`).join("\n")}>
          Editing · {live?.touched.length ?? 0} {live?.touched.length === 1 ? "section" : "sections"} affected
 · blueprint follows on commit
        </span>
        <button
          type="button"
          onClick={follow}
          className="shrink-0 cursor-pointer text-accent underline"
        >
          Update now
        </button>
      </span>
    ) : null;
  const what = u.sections?.length ? u.sections.join(", ") : u.changed?.join(", ");
  return (
    <span
      title={u.status === "failed" ? u.error : what}
      className={cn(
        "mr-2 flex min-w-0 max-w-[420px] items-center gap-1.5 truncate",
        u.status === "failed" ? "text-clay-ink" : u.status === "running" ? "text-amber-ink" : "text-accent",
      )}
    >
      {u.status === "running" ? <span aria-hidden className="size-[7px] shrink-0 animate-pulse rounded-full bg-amber-ink" /> : null}
      <span className="truncate">
        {u.status === "running"
          ? "Updating the blueprint to match the code…"
          : u.status === "failed"
            ? "✗ Blueprint update failed"
            : `✓ Blueprint updated: ${u.sections!.join(", ")}`}
      </span>
      {u.status === "done" ? (
        <button type="button" onClick={() => (setFresh(false), openReview("turn:latest"))} className="shrink-0 cursor-pointer underline">
          see what changed
        </button>
      ) : null}
    </span>
  );
}
