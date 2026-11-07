"use client";

import { invoke } from "@tauri-apps/api/core";
import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { Plan } from "@/components/agent/plan";
import { inFront } from "@/components/agent/strip";
import type { Tab } from "@/components/agent/workspace-tab";
import { announceAnswer, announceDraft } from "@/components/review/keep";
import { announceAct, type Act } from "@/lib/agent/act";
import type { Exchange } from "@/lib/agent/keep";
import { followTurn, midTurn } from "@/lib/agent/turns";
import type { Turn } from "@/lib/agent/update-map";
import type { Status } from "@/lib/client/open-projects";

// What is in front in each tab: Claude (the launcher keeps a marker), some
// other program, or the shell at its prompt. Polled, since programs start
// and quit inside the shell, unseen.
// A turn of Claude's that edited the checkout, or found the map wrong,
// updates that project's map. Separately, EVERY finished turn is offered to
// the map as an answer worth keeping (components/review/keep.tsx) — a turn that only
// explained something edits nothing, so `turn` never fires for the very case
// a reader most wants to keep.
export function useTurnFollowing({
  tabs,
  setTabs,
  planning,
  closedPlans,
  printed,
  rang,
}: {
  tabs: Tab[];
  setTabs: Dispatch<SetStateAction<Tab[]>>;
  /** Opens a plan Claude wrote beside it (the workspace's showPlan, as of the latest render). */
  planning: RefObject<(from: number, cwd: string, got: { text: string; file: string | null }) => void>;
  closedPlans: RefObject<Record<number, Plan>>;
  /** When each tab last printed, and whether it rang the bell since the user typed. */
  printed: RefObject<Record<number, number>>;
  rang: RefObject<Record<number, boolean>>;
}) {
  const started = JSON.stringify(tabs.filter((t) => t.pty !== undefined).map((t) => [t.key, t.pty, t.cwd]));
  useEffect(() => {
    const ids: [number, number, string][] = JSON.parse(started);
    if (!ids.length) return;
    const tick = () =>
      ids.forEach(([key, pty, cwd]) =>
        invoke<{
          claude: boolean;
          busy: boolean;
          status: Status | null;
          turn: Turn | null;
          ended: string | null;
          acts: Act[];
          plan: { text: string; file: string | null } | null;
          approved: boolean;
          steps: NonNullable<Plan["steps"]>;
          session: string | null;
        }>("pty_state", { id: pty })
          .then(({ claude: live, busy, status: said, turn, ended, acts, plan, approved, steps = [], session }) => {
            if (turn && cwd) void followTurn(cwd, turn);
            if (live && cwd && (said === "working" || said === "waiting")) midTurn.set(pty, cwd);
            else midTurn.delete(pty);
            if (plan) planning.current(key, cwd, plan);
            if (approved) {
              const shut = closedPlans.current[key];
              if (shut) closedPlans.current[key] = { ...shut, state: "approved", approvedAt: Date.now() };
              setTabs((all) => all.map((x) => (x.of === key && x.plan ? { ...x, plan: { ...x.plan, state: "approved", approvedAt: Date.now() } } : x)));
            }
            // Claude marking a step means the plan was accepted, however it was
            // answered: "Yes, clear context" never reports it (claude.rs, CLEARED).
            const marks = JSON.stringify(steps);
            setTabs((all) =>
              all.some((x) => x.of === key && x.plan && JSON.stringify(x.plan.steps ?? []) !== marks)
                ? all.map((x) =>
                    x.of === key && x.plan
                      ? { ...x, plan: { ...x.plan, steps, ...(steps.length && x.plan.state !== "approved" ? { state: "approved" as const, approvedAt: Date.now() } : {}) } }
                      : x,
                  )
                : all,
            );
            if (ended) void offerAnswer(ended);
            // Mid-turn, deliberately: Claude shows a section while it is still
            // explaining it (lib/agent/act.ts).
            acts?.forEach(announceAct);
            // Same array when nothing moved: a new one every tick would reset
            // the paste effect's timer below before it could ever fire.
            const statusOf = (x: Tab): Status | undefined =>
              live
                ? (said ?? undefined)
                : inFront({ ...x, live, busy })
                  ? rang.current[key]
                    ? "waiting"
                    : Date.now() - (printed.current[key] ?? 0) < 3000
                      ? "working"
                      : "done"
                  : undefined;
            setTabs((all) =>
              all.some((x) => x.key === key && (x.live !== live || x.busy !== busy || x.status !== statusOf(x) || x.session !== (session ?? undefined)))
                ? all.map((x) => (x.key === key ? { ...x, live, busy, status: statusOf(x), session: session ?? undefined } : x))
                : all,
            );
          })
          .catch(() => {}),
      );
    tick();
    const timer = setInterval(tick, 1000);
    return () => (clearInterval(timer), ids.forEach(([, pty]) => midTurn.delete(pty)));
    // The rest are the workspace's refs and state setter, the same on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);
}

/**
 * Reads back what Claude just asked and answered, and offers it to the map.
 *
 * A draft the reader asked for (components/review/keep.tsx) comes back as an ordinary
 * answer, so it is announced on its own channel first: the dialog is waiting
 * for one and the level is not.
 */
async function offerAnswer(transcript: string) {
  const r = await fetch(`/api/answer?transcript=${encodeURIComponent(transcript)}`)
    .then((x) => x.json())
    .catch(() => null);
  const e = r?.exchange as Exchange | null | undefined;
  if (!e?.said) return;
  if (!announceDraft(e.said)) announceAnswer(e);
}
