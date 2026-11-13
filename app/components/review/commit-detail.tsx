"use client";

import { useEffect, useMemo, useState } from "react";
import { TINT, WORD } from "@/components/review/diff";
import { hunksOf } from "@/lib/client/hunks";
import { cn } from "@/lib/client/utils";
import type { Commit, FileChange, SectionDiff, Verdict } from "@/lib/server/diff";
import type { Summary } from "@/lib/server/history";
import { claudePath } from "@/lib/client/claude";
import { STATUS } from "@/components/review/commits";
import { InlineDiff, SplitDiff, type View } from "@/components/review/diff-view";
import { ago } from "@/components/review/ago";

/* ── the right side ──────────────────────────────────────────── */

/** Initials on a colour of their own, the same for one email everywhere: no picture is fetched. */
function Avatar({ name, email, size = 32 }: { name: string; email?: string; size?: number }) {
  const key = email || name;
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.38, background: `hsl(${h % 360} 38% 42%)` }}
    >
      {initials}
    </span>
  );
}

/** Branches and tags at a commit, as chips: the checked-out branch first and marked. */
export function Refs({ refs, max }: { refs?: string[]; max?: number }) {
  if (!refs?.length) return null;
  const chips = refs
    .filter((r) => r !== "HEAD" && !r.endsWith("/HEAD"))
    .map((r) => (r.startsWith("HEAD -> ") ? { name: r.slice(8), head: true } : r.startsWith("tag: ") ? { name: r.slice(5), tag: true } : { name: r, remote: r.includes("/") }));
  const shown = max ? chips.slice(0, max) : chips;
  return (
    <>
      {shown.map((c) => (
        <span
          key={c.name}
          title={"head" in c ? `${c.name}, checked out` : "tag" in c ? `tag ${c.name}` : c.name}
          className={cn(
            "max-w-[110px] shrink-0 truncate rounded border px-1.5 font-mono text-[9.5px] leading-[15px]",
            "head" in c ? "border-accent bg-accent/15 text-ink" : "tag" in c ? "border-amber-line text-amber-ink" : "border-border-strong text-muted-slate",
          )}
        >
          {"tag" in c ? "◆ " : "head" in c ? "● " : ""}
          {c.name}
        </span>
      ))}
      {chips.length > shown.length ? <span className="shrink-0 font-mono text-[9.5px] text-faint">+{chips.length - shown.length}</span> : null}
    </>
  );
}

/** Which end of a comparison a row is. */
export function EndTag({ end }: { end: "base" | "compare" }) {
  return (
    <span className="shrink-0 rounded bg-accent px-1.5 font-mono text-[9.5px] uppercase leading-[15px] tracking-[0.04em] text-on-accent">
      {end}
    </span>
  );
}

function Sha({ sha }: { sha: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(sha);
        setCopied(true);
      }}
      title={`${sha} — copy`}
      className="cursor-pointer font-mono text-ink hover:underline"
    >
      {copied ? "copied" : sha.slice(0, 7)}
    </button>
  );
}

const longDate = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** One commit as an editor's commit details give it: who, when, where it sits, and the whole message. */
export function Details({ blueprint, commit, all, onPick }: { blueprint: string; commit: Commit; all: Commit[]; onPick: (c: Commit) => void }) {
  // A checkpoint hook writes the commit's paths into its message; the files are listed below already.
  const body = commit.body
    ?.split("\n")
    .filter((l) => !commit.files.includes(l.trim()))
    .join("\n")
    .trim();
  const byOther = commit.committer && (commit.committer !== commit.author || commit.committerEmail !== commit.email);
  const row = "grid grid-cols-[88px_1fr] gap-x-3 py-1 text-[12px]";
  return (
    <>
      <div className="flex items-start gap-3">
        <Avatar name={commit.author} email={commit.email} size={36} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-ink">
            <span className="font-semibold">{commit.author}</span>
            {commit.email ? <span className="ml-1.5 text-muted-slate">&lt;{commit.email}&gt;</span> : null}
          </p>
          <p className="mt-0.5 text-[12px] text-muted-slate" title={commit.at}>
            committed {ago(commit.at)} · {longDate(commit.at)}
          </p>
        </div>
      </div>
      {commit.refs?.length ? (
        <div className="mt-3 flex flex-wrap gap-1">
          <Refs refs={commit.refs} />
        </div>
      ) : null}
      <h3 className="mt-3 text-[17px] font-semibold leading-snug text-ink">{commit.subject}</h3>
      {body ? <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-relaxed text-on-surface-variant">{body}</p> : null}
      <InShort blueprint={blueprint} sha={commit.sha} />
      <div className="mt-4 border-t border-border-gray pt-2">
        <div className={row}>
          <span className="text-muted-slate">Commit</span>
          <span>
            <Sha sha={commit.sha} />
          </span>
        </div>
        <div className={row}>
          <span className="text-muted-slate">{(commit.parents?.length ?? 0) > 1 ? "Parents" : "Parent"}</span>
          <span className="flex flex-wrap gap-x-3">
            {commit.parents?.length
              ? commit.parents.map((p) => {
                  const c = all.find((x) => x.sha === p);
                  return c ? (
                    <button key={p} type="button" onClick={() => onPick(c)} title={c.subject} className="cursor-pointer font-mono text-accent hover:underline">
                      {p.slice(0, 7)}
                    </button>
                  ) : (
                    <span key={p} className="font-mono text-ink">
                      {p.slice(0, 7)}
                    </span>
                  );
                })
              : "none — the first commit"}
            {(commit.parents?.length ?? 0) > 1 ? <span className="text-muted-slate">a merge: changes shown against the first</span> : null}
          </span>
        </div>
        {byOther ? (
          <div className={row}>
            <span className="text-muted-slate">Committer</span>
            <span className="text-ink">
              {commit.committer}
              {commit.committerEmail ? <span className="ml-1.5 text-muted-slate">&lt;{commit.committerEmail}&gt;</span> : null}
              {commit.committed ? <span className="ml-1.5 text-muted-slate">· {longDate(commit.committed)}</span> : null}
            </span>
          </div>
        ) : null}
      </div>
    </>
  );
}

/**
 * What the commit did, in a few sentences from Claude, who reads its diff —
 * the answer a "wip: checkpoint" message does not give. Paid, so asked for
 * with a click; kept by sha, so a commit already told shows at once.
 */
function InShort({ blueprint, sha }: { blueprint: string; sha: string }) {
  const [got, setGot] = useState<{ summary?: Summary; error?: string; asking?: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/diff?blueprint=${encodeURIComponent(blueprint)}&summary=${sha}`)
      .then((r) => r.json())
      .then((j: { summary?: Summary }) => live && setGot({ summary: j.summary }))
      .catch(() => live && setGot({}));
    return () => {
      live = false;
    };
  }, [blueprint, sha]);

  async function ask() {
    setGot({ asking: true });
    let claude: string | undefined;
    try {
      claude = await claudePath();
    } catch (e) {
      // Thrown past the button, it would stay "reading" for good.
      return setGot({ error: (e as Error).message });
    }
    const r = await fetch(`/api/diff?blueprint=${encodeURIComponent(blueprint)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sha, claude }),
    })
      .then((r) => r.json() as Promise<{ summary?: Summary; error?: string }>)
      .catch(() => ({ error: "Could not reach the app's server." }));
    setGot(r);
  }

  if (!got) return null;
  if (got.summary) {
    return (
      <div className="mt-3 rounded-md border-l-2 border-accent bg-accent/[0.07] px-3 py-2">
        <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-accent">In short</p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink">{got.summary.text}</p>
      </div>
    );
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={got.asking}
        onClick={() => void ask()}
        className="cursor-pointer rounded-md border border-accent px-3 py-1.5 text-[12px] font-medium text-accent transition-colors duration-150 hover:bg-accent/10 disabled:cursor-default disabled:opacity-60"
      >
        {got.asking ? "Claude is reading the diff…" : "✦ Summarize this commit"}
      </button>
      {got.error ? (
        <span className="w-full text-[12px]" style={{ color: TINT.removed.ink }}>
          {got.error}
        </span>
      ) : null}
    </div>
  );
}

/** Two commits side by side, the base on the left, and the way to swap them. */
export function Comparing({ base, other, between, onSwap, onDone }: { base: Commit; other: Commit; between: number; onSwap: () => void; onDone: () => void }) {
  const card = (c: Commit, end: "base" | "compare") => (
    <div className="min-w-0 flex-1 rounded-md border border-border-gray px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <EndTag end={end} />
        <Sha sha={c.sha} />
        <Refs refs={c.refs} max={2} />
      </div>
      <p className="mt-1.5 line-clamp-2 text-[13px] font-semibold leading-snug text-ink">{c.subject}</p>
      <div className="mt-2 flex items-center gap-2">
        <Avatar name={c.author} email={c.email} size={22} />
        <span className="min-w-0 truncate text-[11.5px] text-muted-slate" title={`${c.author} <${c.email ?? ""}> · ${longDate(c.at)}`}>
          {c.author} · {ago(c.at)}
        </span>
      </div>
    </div>
  );
  return (
    <>
      <div className="flex items-stretch gap-2">
        {card(base, "base")}
        <button
          type="button"
          onClick={onSwap}
          title="Swap the two ends"
          className="shrink-0 cursor-pointer self-center rounded-md border border-border-strong px-2 py-1.5 text-[14px] text-ink hover:border-accent"
        >
          ⇄
        </button>
        {card(other, "compare")}
      </div>
      <p className="mt-2 text-[12px] text-muted-slate">
        What changed from <span className="font-mono">{base.short}</span> to <span className="font-mono">{other.short}</span>
        {between > 1 ? ` — ${between} commits apart` : ""}.{" "}
        <button type="button" onClick={onDone} className="cursor-pointer text-accent hover:underline">
          Stop comparing
        </button>
      </p>
    </>
  );
}

/** The sections the change moved, each opening its level. */
export function OnTheBlueprint({ sections, trail, onOpen }: { sections: SectionDiff[]; trail: (s: SectionDiff) => string; onOpen: (s: SectionDiff) => void }) {
  const moved = sections.filter((s) => s.verdict !== "untouched");
  return (
    <>
      <h3 className="mt-6 text-[12px] font-medium text-muted-slate">On the blueprint</h3>
      {moved.length ? (
        <ul className="mt-1.5 flex flex-col gap-1">
          {moved.map((s) => {
            const t = TINT[s.verdict as Exclude<Verdict, "untouched">];
            return (
              <li key={s.path.join("/")}>
                <button
                  type="button"
                  onClick={() => onOpen(s)}
                  className="flex w-full cursor-pointer items-baseline gap-2 border border-border-gray px-3 py-1.5 text-left hover:border-border-strong hover:bg-surface-container-low focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <span className="shrink-0 font-mono text-[12px]" style={{ color: t.ink }}>
                    {t.mark}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px]">
                    <span className="font-semibold text-ink">{s.title}</span>
                    {trail(s) ? <span className="ml-2 text-[11.5px] text-muted-slate">{trail(s)}</span> : null}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em]" style={{ color: t.ink }}>
                    {WORD[s.verdict]}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-1.5 text-[13px] text-muted-slate">No section of the blueprint changed.</p>
      )}
    </>
  );
}

export function FilePane({
  file,
  view,
  at,
  of,
  onStep,
  layout,
}: {
  file: FileChange;
  view: View;
  at: number;
  of: number;
  onStep: (k: 1 | -1) => void;
  /** The split/inline switch, drawn in the bar. */
  layout?: React.ReactNode;
}) {
  const hunks = useMemo(() => hunksOf(file.diff), [file.diff]);
  const step = "cursor-pointer px-1.5 py-0.5 text-[12px] text-muted-slate hover:bg-surface-container-low hover:text-ink disabled:cursor-default disabled:opacity-40";
  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b border-border-gray px-4 py-2">
        <span className="font-mono text-[11px] font-semibold" style={{ color: TINT[file.verdict].ink }}>
          {STATUS[file.verdict]}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">{file.path}</span>
        <span className="tnum shrink-0 font-mono text-[11px]">
          <span style={{ color: TINT.added.ink }}>+{file.added}</span> <span style={{ color: TINT.removed.ink }}>−{file.removed}</span>
        </span>
        <span className="tnum shrink-0 text-[11px] text-faint">
          {at + 1} of {of}
        </span>
        {layout}
        <button type="button" aria-label="Previous file" disabled={at <= 0} onClick={() => onStep(-1)} className={step}>
          ↑
        </button>
        <button type="button" aria-label="Next file" disabled={at >= of - 1} onClick={() => onStep(1)} className={step}>
          ↓
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-code">
        {hunks.length ? (
          view === "split" ? (
            <SplitDiff hunks={hunks} path={file.path} />
          ) : (
            <InlineDiff hunks={hunks} path={file.path} />
          )
        ) : (
          <p className="px-4 py-3 text-[12.5px] text-muted-slate">No lines to show: the file is binary, or only its mode changed.</p>
        )}
      </div>
    </>
  );
}
