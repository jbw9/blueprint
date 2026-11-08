"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AgentIcon } from "@/components/agent/agents";
import { Kbd, keys } from "@/components/ui/button";
import { useBluprint } from "@/components/bluprint/bluprint-context";
import { openReview } from "@/components/review/diff";
import { openFiles, useFiles } from "@/components/bluprint/files";
import { openPalette } from "@/components/chrome/palette";
import { openProjects } from "@/components/projects/projects";
import { UNFOLLOWED, claudeMidTurnIn, followTurn } from "@/lib/agent/turns";
import { toggleWorkspace } from "@/lib/agent/workspace-toggle";
import type { Node } from "@/lib/bluprint/schema";
import { STATIC_BLUPRINT } from "@/lib/bluprint/source";
import { cn } from "@/lib/client/utils";
import { useMac } from "@/lib/client/platform";

/**
 * The line along the bottom of the window: what is true of the whole bluprint,
 * whatever level is open. Which commit it describes, the problems it found,
 * whether an update is running, and the two keys that get you
 * anywhere. It is the one place this lives, so no level has to repeat it.
 */
export function StatusBar() {
  const { name, bluprints, RUN, L0, TOP } = useBluprint();
  const local = bluprints.some((m) => m.id === name && m.local);

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
      <Item title="The commit this bluprint describes" mono>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <circle cx="8" cy="8" r="2.5" />
          <path d="M1 8h4.5M10.5 8H15" />
        </svg>
        {RUN.commit?.slice(0, 7) ?? "no commit"}
      </Item>
      {files?.added.length ? (
        <Item title="Files added since the bluprint was made — click to list them" onClick={() => openFiles("added")} className="text-amber-ink">
          {files.added.length} not on the bluprint yet
        </Item>
      ) : null}
      {problems ? (
        <Item title="Problems the bluprint found in the code — click to list them" onClick={() => openPalette("problems")} className="text-clay-ink">
          <span aria-hidden>⚠</span>
          {problems} {problems === 1 ? "problem" : "problems"}
        </Item>
      ) : null}
      <span className="min-w-0 flex-1" />
      <BluprintUpdates key={name} id={name} root={RUN.root} local={local} />
      <Item title="Go to a level, or run an action" onClick={() => openPalette()}>
        Go to <Kbd className={KEY}>{keys(mac, "P")}</Kbd>
      </Item>
      {STATIC_BLUPRINT ? (
        <Item title="Ask Claude about this code" onClick={toggleWorkspace}>
          <AgentIcon id="claude" />
          {/* A published page takes Control+` only (components/agent/claude-web.tsx). */}
          Claude <Kbd className={KEY}>{keys(mac, "`", { ctrl: true })}</Kbd>
        </Item>
      ) : (
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

/** How long the changed files must stay as they are before the bluprint follows them by itself. */
const SETTLE = 3_000;

interface Update {
  status: "running" | "done" | "failed";
  finishedAt?: string;
  changed?: string[];
  sections?: string[];
  error?: string;
}

/**
 * The section ids an update is rewriting right now, for the open level to say
 * so where the reader is looking (components/bluprint/canvas.tsx): the status bar alone
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
 * Follows the open bluprint while an agent changes its code: an update redoing
 * the touched sections (lib/server/vault.ts) shows here while it runs. The bluprint takes
 * each section as it lands by itself (components/bluprint/bluprint-context.tsx); this only
 * says what is happening. Only the user's own projects update; an
 * example describes some other copy of its code, so when an agent edits its
 * checkout this says so and offers to import it.
 *
 * Edits made outside a Bluprint tab (another editor, a pull) never ask for an
 * update, so between updates this says how far the code has moved from what
 * the bluprint describes (lib/server/live.ts, followed with the bluprint each second), and
 * updates it once those files have stopped changing for SETTLE. Not while
 * Claude is mid-turn in the checkout: its turn updates the bluprint when it ends,
 * with its account of what it did. The same change is never retried after it
 * failed, since each try is a paid run.
 */
function BluprintUpdates({ id, root, local }: { id: string; root?: string; local: boolean }) {
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

  const { live } = useBluprint();
  const behind = local ? (live?.files ?? []) : [];
  const sig = local ? (live?.sig ?? "") : "";
  // The change last updated for, so a failed one is not paid for again.
  const [tried, setTried] = useState("");
  const follow = (sig: string) => {
    setTried(sig);
    if (root) void followTurn(root, { transcript: null, corrections: [] });
  };
  // Each save starts the wait again; one that runs out with the code still
  // ahead updates. An update already running takes it after (lib/server/vault.ts, `again`).
  useEffect(() => {
    if (!sig || !root || sig === tried) return;
    const t = setTimeout(() => {
      if (claudeMidTurnIn(root)) return;
      setTried(sig);
      void followTurn(root, { transcript: null, corrections: [] });
    }, SETTLE);
    return () => clearTimeout(t);
  }, [sig, root, tried]);

  useEffect(() => {
    if (!fresh) return;
    const t = setTimeout(() => setFresh(false), 15000);
    return () => clearTimeout(t);
  }, [fresh]);

  if (unfollowed && root)
    return (
      <span className="mr-2 flex min-w-0 items-center gap-2 text-amber-ink">
        <span className="truncate" title="This bluprint was made from another copy of the code, so it cannot follow edits here.">
          This bluprint doesn&apos;t follow edits
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
  // A turn that changed nothing the bluprint covers passes silently.
  if (!u || (u.status === "done" && (!fresh || !u.sections?.length)))
    return behind.length && root ? (
      <span className="mr-2 flex min-w-0 items-center gap-2 text-amber-ink">
        <span className="truncate" title={behind.map((f) => `${f.path} +${f.add} −${f.del}`).join("\n")}>
          Editing · {live?.touched.length ?? 0} {live?.touched.length === 1 ? "section" : "sections"} affected
          {tried === sig ? "" : " · bluprint follows when edits settle"}
        </span>
        <button
          type="button"
          onClick={() => follow(sig)}
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
          ? "Updating the bluprint to match the code…"
          : u.status === "failed"
            ? "✗ Bluprint update failed"
            : `✓ Bluprint updated: ${u.sections!.join(", ")}`}
      </span>
      {u.status === "done" ? (
        <button type="button" onClick={() => (setFresh(false), openReview("turn:latest"))} className="shrink-0 cursor-pointer underline">
          see what changed
        </button>
      ) : null}
    </span>
  );
}
