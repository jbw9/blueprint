"use client";

import { useEffect, useState } from "react";
import { undoTurn } from "@/lib/agent/undo";
import { cn } from "@/lib/client/utils";
import type { BlueprintDiff } from "@/lib/server/diff";
import type { Branch, Pull, Review } from "@/lib/server/review";
import { claudePath } from "@/lib/client/claude";
import { ago } from "@/components/review/ago";

/* ── reviews ─────────────────────────────────────────────────── */

const SELECT =
  "w-full border border-border-gray bg-card px-2 py-1.5 text-[12px] text-ink focus:border-accent focus:outline-none";

/**
 * Something to review as one change: a pull request or a branch, from where
 * it left its base (lib/server/review.ts), or one turn of the agent in the app, as
 * the blueprint saw it before and after (scripts/generate/update.ts).
 */
export function ReviewPicker({ blueprint, value, onPick }: { blueprint: string; value?: string; onPick: (spec?: string) => void }) {
  const [got, setGot] = useState<{ branches: Branch[]; base: string; pulls?: Pull[]; why?: string; turns: { id: string; prompt: string; at: string }[] } | null>(null);
  useEffect(() => {
    let live = true;
    const read = (q: string) => fetch(`/api/diff?blueprint=${encodeURIComponent(blueprint)}&${q}`).then((r) => r.json());
    Promise.all([read("branches=1"), read("turns=1")])
      .then(([b, t]) => live && setGot({ branches: b.branches ?? [], base: b.base ?? "", pulls: b.pulls, why: b.why, turns: t.turns ?? [] }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [blueprint]);
  return (
    <>
      <select value={value ?? ""} aria-label="Review a pull request, branch or agent turn" onChange={(e) => onPick(e.target.value || undefined)} className={SELECT}>
        <option value="">{got ? "Review a pull request, branch or turn…" : "Reading branches…"}</option>
        {got?.turns.length ? (
          <optgroup label="What the agent changed, turn by turn">
            {got.turns.map((t) => (
              <option key={t.id} value={`turn:${t.id}`}>
                {ago(t.at)} · {t.prompt.slice(0, 70) || "a correction"}
              </option>
            ))}
          </optgroup>
        ) : null}
        {got?.pulls?.length ? (
          <optgroup label="Pull requests">
            {got.pulls.map((p) => (
              <option key={p.number} value={`pr:${p.number}`}>
                #{p.number} {p.title.slice(0, 70)} — {p.author}
              </option>
            ))}
          </optgroup>
        ) : null}
        {got?.branches.length ? (
          <optgroup label={`Branches, since they left ${got.base}`}>
            {got.branches
              .filter((b) => b.name !== got.base)
              .map((b) => (
                <option key={b.name} value={`${got.base}...${b.name}`}>
                  {b.name}
                </option>
              ))}
          </optgroup>
        ) : null}
      </select>
      {got?.why ? <p className="mt-1 text-[11px] leading-snug text-faint">{got.why}</p> : null}
    </>
  );
}

/** What is under review: the pull request as its author described it, the branch and its base, or the turn's prompt. */
export function ReviewCard({ r, blueprint, spec, onMade }: { r: Review; blueprint: string; spec?: string; onMade: () => void }) {
  return (
    <div className="mt-3 border border-border-gray px-3 py-2">
      {r.kind !== "turn" && spec ? <BlueprintAfter key={spec} blueprint={blueprint} spec={spec} commit={r.to} pr={r.kind === "pr"} onMade={onMade} /> : null}
      {r.kind === "pr" ? (
        <>
          <p className="text-[13px] font-semibold text-ink">
            #{r.number} {r.title}
          </p>
          <p className="mt-0.5 text-[11.5px] text-muted-slate">
            {r.author ? `${r.author} wants to merge ` : "Merging "}
            <span className="font-mono">{r.head}</span> into <span className="font-mono">{r.base}</span>
            {r.url ? (
              <>
                {" · "}
                <a href={r.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                  on GitHub
                </a>
              </>
            ) : null}
          </p>
          {r.body ? <p className="mt-1 line-clamp-3 whitespace-pre-line text-[12px] leading-snug text-on-surface-variant">{r.body}</p> : null}
        </>
      ) : r.kind === "turn" ? (
        <>
          <p className="text-[12.5px] text-ink">
            The agent, asked: <span className="italic">{r.title || "to correct the blueprint"}</span>
            <span className="ml-1.5 text-[11.5px] text-muted-slate">· the blueprint before and after it</span>
          </p>
          {spec ? <UndoTurn key={spec} blueprint={blueprint} turn={spec.slice(5)} onUndone={onMade} /> : null}
        </>
      ) : (
        <p className="text-[12.5px] text-ink">
          What <span className="font-mono">{r.head}</span> did since it left <span className="font-mono">{r.base}</span>
          <span className="ml-1.5 font-mono text-[10.5px] text-faint">
            {r.from.slice(0, 7)}…{r.to.slice(0, 7)}
          </span>
        </p>
      )}
    </div>
  );
}

/**
 * Puts back every file the turn edited (lib/agent/undo.ts), after asking once. Only
 * when nothing has touched those files since: otherwise it names them, and
 * changes nothing.
 */
function UndoTurn({ blueprint, turn, onUndone }: { blueprint: string; turn: string; onUndone: () => void }) {
  const [stage, setStage] = useState<"idle" | "confirm" | "busy" | "done">("idle");
  const [said, setSaid] = useState<string | null>(null);
  const go = async () => {
    setStage("busy");
    const r = await undoTurn(blueprint, turn);
    if (r.ok) {
      setStage("done");
      setSaid(`Put back ${r.restored.length} file${r.restored.length === 1 ? "" : "s"}. The blueprint is catching up.`);
      onUndone();
    } else {
      setStage("idle");
      setSaid(
        r.conflicts?.length
          ? `Not undone: changed since this turn — ${r.conflicts.join(", ")}.`
          : r.refused?.length
            ? `Not undone: cannot write ${r.refused.join(", ")}.`
            : (r.error ?? "Not undone."),
      );
    }
  };
  const btn = "cursor-pointer px-2 py-0.5 text-[12px]";
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2">
      {stage === "idle" ? (
        <button type="button" onClick={() => setStage("confirm")} className={cn(btn, "border border-border-gray text-ink hover:bg-surface-container-low")}>
          ↶ Undo this turn
        </button>
      ) : stage === "confirm" ? (
        <>
          <span className="text-[12px] text-ink">Put every file this turn edited back as it was?</span>
          <button type="button" onClick={() => void go()} className={cn(btn, "bg-accent text-card hover:opacity-90")}>
            Undo
          </button>
          <button type="button" onClick={() => setStage("idle")} className={cn(btn, "text-muted-slate hover:text-ink")}>
            Cancel
          </button>
        </>
      ) : stage === "busy" ? (
        <span className="text-[12px] text-muted-slate">Undoing…</span>
      ) : null}
      {said ? <span className="text-[11.5px] text-muted-slate">{said}</span> : null}
    </div>
  );
}

/**
 * The blueprint as it would be after the review (app/api/review): until it is made
 * the diff shows which levels the change reaches; once it is, their boxes,
 * arrows and rows diff too. Made only when asked, since it is a paid run.
 */
function BlueprintAfter({ blueprint, spec, commit, pr, onMade }: { blueprint: string; spec: string; commit: string; pr: boolean; onMade: () => void }) {
  const [s, setS] = useState<{ status: "none" | "running" | "done" | "failed"; error?: string }>();
  const q = `blueprint=${encodeURIComponent(blueprint)}&commit=${commit}`;
  useEffect(() => {
    if (s && s.status !== "running") return;
    let live = true;
    const t = setTimeout(
      () =>
        fetch(`/api/review?${q}`)
          .then((r) => r.json())
          .then((j) => {
            if (!live) return;
            if (s?.status === "running" && j.status === "done") onMade();
            setS(j);
          })
          .catch(() => {}),
      s ? 4000 : 0,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, s, onMade]);
  const start = async () => {
    setS({ status: "running" });
    const j = await fetch("/api/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ blueprint, review: spec, claude: await claudePath() }),
    })
      .then((r) => r.json())
      .catch(() => ({ status: "failed", error: "Could not start it." }));
    setS(j);
  };
  if (!s) return null;
  return (
    <p className="mb-1.5 flex items-center gap-2 text-[11.5px] text-muted-slate">
      {s.status === "done" ? (
        <span className="text-accent">The blueprint after {pr ? "this PR" : "this branch"} is drawn: its levels diff box by box.</span>
      ) : s.status === "running" ? (
        <span className="text-amber-ink">Making the blueprint of {pr ? "this PR" : "this branch"}… a few minutes</span>
      ) : (
        <>
          <button type="button" onClick={() => void start()} className="cursor-pointer text-accent underline">
            Make the blueprint of {pr ? "this PR" : "this branch"}
          </button>
          <span>to see its new and changed boxes, not only which levels it reaches (an update run)</span>
          {s.error ? <span className="text-clay-ink">{s.error}</span> : null}
        </>
      )}
    </p>
  );
}

/** Changed code no level's lines reach: listed with the level nearest it, never dropped. */
export function Outside({ outside, title, onOpen }: { outside: NonNullable<BlueprintDiff["outside"]>; title: (path: string[]) => string; onOpen: (path: string[]) => void }) {
  return (
    <>
      <h3 className="mt-6 text-[12px] font-medium text-muted-slate">Changed where no level&apos;s lines reach</h3>
      <ul className="mt-1.5 flex flex-col gap-1">
        {outside.map((o) => (
          <li key={o.path} className="flex items-baseline gap-2 text-[11.5px]">
            <span className="min-w-0 flex-1 truncate font-mono text-on-surface">{o.path}</span>
            {o.near ? (
              <button type="button" onClick={() => onOpen(o.near!)} className="max-w-[50%] shrink-0 cursor-pointer truncate text-accent hover:underline">
                near {o.near.map((_, i) => title(o.near!.slice(0, i + 1))).join(" › ")}
              </button>
            ) : (
              <span className="shrink-0 text-amber-ink">not on the blueprint yet</span>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
