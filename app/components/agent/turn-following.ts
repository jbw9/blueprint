"use client";

import { invoke } from "@tauri-apps/api/core";
import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { Plan } from "@/components/agent/plan";
import { inFront } from "@/components/agent/strip";
import type { Tab } from "@/components/agent/workspace-tab";
import { announceAct, type Act } from "@/lib/agent/act";
import { followTurn, midTurn } from "@/lib/agent/turns";
import type { Turn } from "@/lib/agent/update-blueprint";
import type { Status } from "@/lib/client/open-projects";

// What is in front in each tab: Claude (the launcher keeps a marker), some
// other program, or the shell at its prompt. Polled, since programs start
// and quit inside the shell, unseen.
// A turn of Claude's that edited the checkout, or found the blueprint wrong,
// updates that project's blueprint.
export function useTurnFollowing({
  tabs,
  setTabs,
  planning,
  opening,
  closedPlans,
  printed,
  rang,
  latest,
}: {
  tabs: Tab[];
  setTabs: Dispatch<SetStateAction<Tab[]>>;
  /** Opens a file Claude asked to show in an editor tab (the workspace's openFile, as of the latest render). */
  opening: RefObject<(cwd: string, file: string, line?: number) => void>;
  /** Opens a plan Claude wrote beside it (the workspace's showPlan, as of the latest render). */
  planning: RefObject<(from: number, cwd: string, got: { text: string; file: string | null }) => void>;
  closedPlans: RefObject<Record<number, Plan>>;
  /** When each tab last printed, and whether it rang the bell since the user typed. */
  printed: RefObject<Record<number, number>>;
  rang: RefObject<Record<number, boolean>>;
  /** The project in front: only a Claude working there moves its blueprint. */
  latest: RefObject<{ here: string }>;
}) {
  const started = JSON.stringify(tabs.filter((t) => t.pty !== undefined).map((t) => [t.key, t.pty, t.cwd]));
  useEffect(() => {
    const ids: [number, number, string][] = JSON.parse(started);
    if (!ids.length) return;
    let stopped = false;
    const tick = () =>
      ids.forEach(([key, pty, cwd]) =>
        invoke<{
          claude: boolean;
          agent: string | null;
          busy: boolean;
          status: Status | null;
          turn: Turn | null;
          acts: Act[];
          plan: { text: string; file: string | null } | null;
          approved: boolean;
          steps: NonNullable<Plan["steps"]>;
          session: string | null;
        }>("pty_state", { id: pty })
          .then(({ claude: live, agent, busy, status: said, turn, acts, plan, approved, steps = [], session }) => {
            if (turn && cwd) void followTurn(cwd, turn);
            // Not once stopped: a poll answered after its tab closed would leave the project
            // mid-turn for good, and its commits would never update the blueprint (statusbar.tsx).
            if (!stopped && live && cwd && (said === "working" || said === "waiting")) midTurn.set(pty, cwd);
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
            // Mid-turn, deliberately: Claude shows a section while it is still
            // explaining it (lib/agent/act.ts). One in a project not in front would move
            // another project's blueprint, so its acts are dropped.
            // A file opens beside its own Claude, whichever project is in front.
            acts?.forEach((a) => (a.verb === "file" ? opening.current(cwd, a.file, a.line ?? undefined) : cwd === latest.current.here && announceAct(a)));
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
              all.some((x) => x.key === key && (x.live !== live || x.agent !== (agent ?? undefined) || x.busy !== busy || x.status !== statusOf(x) || x.session !== (session ?? undefined)))
                ? all.map((x) => (x.key === key ? { ...x, live, agent: agent ?? undefined, busy, status: statusOf(x), session: session ?? undefined } : x))
                : all,
            );
          })
          .catch(() => {}),
      );
    tick();
    const timer = setInterval(tick, 1000);
    return () => ((stopped = true), clearInterval(timer), ids.forEach(([, pty]) => midTurn.delete(pty)));
    // The rest are the workspace's refs and state setter, the same on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);
}

