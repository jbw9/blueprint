"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, keys } from "@/components/ui/button";
import { cn } from "@/lib/client/utils";
import { useDesktop, useMac } from "@/lib/client/platform";
import { mention } from "@/lib/agent/context";
import { ago } from "@/components/review/ago";
import { Avatar } from "@/components/review/commit-detail";
import { TINT } from "@/components/review/diff";
import type { CloseReason, FullIssue, Issue, IssueState } from "@/lib/server/issues";

/**
 * The Issues tab of the commits panel (components/review/diff-panel.tsx): the
 * checkout's open GitHub issues on the left, the one picked on the right in
 * full, and Give to Claude, which names it in Claude's prompt and sends its
 * text with that prompt (lib/agent/context.ts `mention`), as a picked section is.
 */

const NAME = 60;
const STATES: { value: IssueState; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
];

export function IssuesTab({ blueprint, onGiven }: { blueprint: string; onGiven: () => void }) {
  const desktop = useDesktop();
  const [state, setState] = useState<IssueState>("open");
  const [lists, setLists] = useState<Partial<Record<IssueState, { issues?: Issue[]; why?: string }>>>({});
  const [again, setAgain] = useState(0);
  const list = lists[state] ?? null;
  const setList = (f: (l: { issues?: Issue[]; why?: string }) => { issues?: Issue[]; why?: string }) =>
    setLists((all) => (all[state] ? { ...all, [state]: f(all[state]) } : all));
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<number | null>(null);
  const [full, setFull] = useState<Record<number, FullIssue | { error: string }>>({});
  const rows = useRef<HTMLDivElement>(null);

  // Both lists are read together, so each switch shows its count and opens at once.
  useEffect(() => {
    let live = true;
    for (const st of ["open", "closed"] as const) {
      const got = (l: { issues?: Issue[]; why?: string }) => live && setLists((all) => ({ ...all, [st]: l }));
      fetch(`/api/issues?blueprint=${encodeURIComponent(blueprint)}&state=${st}`)
        .then((r) => r.json())
        .then((j: { issues?: Issue[]; why?: string; error?: string }) => got({ issues: j.issues, why: j.why ?? j.error }))
        .catch(() => got({ why: "Could not reach the app's server." }));
    }
    return () => {
      live = false;
    };
  }, [blueprint, again]);

  const q = query.trim().toLowerCase().replace(/^#/, "");
  const shown = useMemo(
    () =>
      (list?.issues ?? []).filter(
        (i) => !q || String(i.number).startsWith(q) || i.title.toLowerCase().includes(q) || i.labels.some((l) => l.toLowerCase().includes(q)),
      ),
    [list, q],
  );
  const at = picked ?? shown[0]?.number ?? null;
  const one = at === null ? undefined : full[at];

  useEffect(() => {
    if (at === null || full[at]) return;
    let live = true;
    fetch(`/api/issues?blueprint=${encodeURIComponent(blueprint)}&n=${at}`)
      .then((r) => r.json())
      .then((j: FullIssue & { error?: string }) => live && setFull((f) => ({ ...f, [at]: j.error ? { error: j.error } : j })))
      .catch(() => live && setFull((f) => ({ ...f, [at]: { error: "Could not reach the app's server." } })));
    return () => {
      live = false;
    };
  }, [at, blueprint, full]);

  useEffect(() => {
    rows.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [at]);

  const give = (i: FullIssue) => {
    const name = `#${i.number} ${i.title.length > NAME ? `${i.title.slice(0, NAME - 1)}…` : i.title}`;
    mention({ key: `issue:${i.number}`, title: name, text: i.text });
    onGiven();
  };

  // Asked first, as completed or not planned, which is also the guard against a stray click.
  const [closing, setClosing] = useState<{ n: number; busy?: boolean; error?: string } | null>(null);
  /** Closes `n` with a reason, or opens it again; it leaves this list, and both lists are read again. */
  async function move(n: number, to: CloseReason | "reopen") {
    setClosing({ n, busy: true });
    const r = await fetch("/api/issues", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(to === "reopen" ? { blueprint, n, reopen: true } : { blueprint, n, reason: to }),
    })
      .then((r) => r.json() as Promise<{ error?: string }>)
      .catch(() => ({ error: "Could not reach the app's server." }));
    if (r.error) return setClosing({ n, error: r.error });
    setClosing(null);
    setPicked(null);
    setList((l) => ({ ...l, issues: l.issues?.filter((i) => i.number !== n) }));
    setFull((f) => {
      const rest = { ...f };
      delete rest[n];
      return rest;
    });
    setAgain((k) => k + 1);
  }

  const summary = at === null ? undefined : list?.issues?.find((i) => i.number === at);

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-border-gray">
        <div className="flex shrink-0 flex-col gap-2 border-b border-border-gray p-2">
          <div role="radiogroup" aria-label="Open or closed issues" className="flex items-center gap-3 px-1">
            {STATES.map((o) => {
              const on = o.value === state;
              const count = lists[o.value]?.issues?.length;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    setState(o.value);
                    setPicked(null);
                    setClosing(null);
                  }}
                  className={cn(
                    "flex cursor-pointer items-center gap-1.5 text-[12px] transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent/70",
                    on ? "font-semibold text-ink" : "font-medium text-muted-slate hover:text-ink",
                  )}
                >
                  <StateMark state={o.value} />
                  {count === undefined ? null : <span className="tnum">{count}</span>}
                  {o.label}
                </button>
              );
            })}
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={list?.issues ? `Filter ${list.issues.length} ${state} ${list.issues.length === 1 ? "issue" : "issues"}` : "Filter issues"}
            title="By number, title or label"
            aria-label="Filter issues"
            className="w-full rounded-md border border-border-gray bg-card px-2.5 py-1.5 text-[12px] text-ink placeholder:text-faint focus:border-accent focus:outline-none"
          />
        </div>
        <div
          ref={rows}
          role="listbox"
          aria-label={state === "open" ? "Open issues" : "Closed issues"}
          tabIndex={0}
          onKeyDown={(e) => {
            if ((e.key !== "ArrowDown" && e.key !== "ArrowUp") || !shown.length) return;
            e.preventDefault();
            const now = shown.findIndex((i) => i.number === at);
            const next = Math.max(0, Math.min(shown.length - 1, (now < 0 ? 0 : now) + (e.key === "ArrowDown" ? 1 : -1)));
            setPicked(shown[next].number);
          }}
          className="min-h-0 flex-1 overflow-y-auto p-1 outline-none"
        >
          {shown.map((i) => {
            const on = i.number === at;
            return (
              <div
                key={i.number}
                role="option"
                aria-selected={on}
                data-active={on}
                onClick={() => setPicked(i.number)}
                title={`#${i.number} ${i.title}\n${i.author} · ${new Date(i.at).toLocaleString()}`}
                className={cn("flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1.5", on ? "bg-accent/15" : "hover:bg-surface-container-low/60")}
              >
                <span className="tnum w-9 shrink-0 font-mono text-[11px] text-faint">#{i.number}</span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{i.title}</span>
                <span className="shrink-0 text-[11px] text-faint">{ago(i.at)}</span>
              </div>
            );
          })}
          {!list ? <p className="px-3 py-2 text-[12px] text-muted-slate">Reading the issues…</p> : null}
          {list?.why ? <p className="px-3 py-2 text-[12px] leading-snug text-muted-slate">{list.why}</p> : null}
          {list?.issues && !list.issues.length ? <p className="px-3 py-2 text-[12px] text-muted-slate">No {state} issues.</p> : null}
          {list?.issues?.length && !shown.length ? <p className="px-3 py-2 text-[12px] text-muted-slate">No issue matches “{query}”.</p> : null}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {summary ? (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <StatePill state={state} />
                {summary.labels.map((l) => (
                  <span key={l} className="rounded-full border border-border-strong px-2 text-[11px] leading-[18px] text-on-surface-variant">
                    {l}
                  </span>
                ))}
              </div>
              <h3 className="mt-2 text-[18px] font-semibold leading-snug tracking-[-0.01em] text-ink">
                {summary.title}
                <span className="ml-2 font-normal text-faint">#{summary.number}</span>
              </h3>
              <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                {desktop ? (
                  <TextAction strong disabled={!one || !("text" in one)} onClick={() => one && "text" in one && give(one)}>
                    ✦ Give to Claude
                  </TextAction>
                ) : null}
                {state === "closed" ? (
                  <TextAction disabled={closing?.busy} onClick={() => void move(summary.number, "reopen")}>
                    {closing?.n === summary.number && closing.busy ? "Reopening…" : "Reopen"}
                  </TextAction>
                ) : closing?.n === summary.number ? (
                  <span className="flex items-center gap-3">
                    <span className="text-[12.5px] text-faint">{closing.busy ? "Closing…" : "Close as"}</span>
                    <TextAction disabled={closing.busy} onClick={() => void move(summary.number, "completed")}>
                      Completed
                    </TextAction>
                    <TextAction disabled={closing.busy} onClick={() => void move(summary.number, "not planned")}>
                      Not planned
                    </TextAction>
                    <TextAction disabled={closing.busy} onClick={() => setClosing(null)}>
                      Cancel
                    </TextAction>
                  </span>
                ) : (
                  <TextAction onClick={() => setClosing({ n: summary.number })}>Close</TextAction>
                )}
                <a href={summary.url} target="_blank" rel="noreferrer" className={ACTION}>
                  GitHub ↗
                </a>
              </div>
              {closing?.n === summary.number && closing.error ? (
                <p className="mt-2 text-[12px]" style={{ color: TINT.removed.ink }}>
                  {closing.error}
                </p>
              ) : null}
              {!one ? <p className="mt-5 text-[13px] text-muted-slate">Reading the issue…</p> : null}
              {one && "error" in one ? <p className="mt-5 text-[13px] text-muted-slate">{one.error}</p> : null}
              {one && "text" in one ? (
                // The thread hangs on one line, as the commit list does: the description, each comment, then the box.
                <ol className="relative mt-5 flex flex-col gap-4 before:absolute before:bottom-4 before:left-[13.5px] before:top-7 before:w-px before:bg-border-strong">
                  <Post author={one.author} at={one.at} body={one.body || "No description."} />
                  {one.comments.map((c, k) => (
                    <Post key={k} author={c.author} at={c.at} body={c.body} />
                  ))}
                  <li className="relative flex gap-3">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border-strong bg-card text-faint">
                      <svg aria-hidden width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                        <path d="M8 3.5v9M3.5 8h9" />
                      </svg>
                    </span>
                    <CommentBox
                      key={one.number}
                      blueprint={blueprint}
                      n={one.number}
                      onPosted={() =>
                        setFull((f) => {
                          const rest = { ...f };
                          delete rest[one.number];
                          return rest;
                        })
                      }
                    />
                  </li>
                </ol>
              ) : null}
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}

/** GitHub's marks: a ring with a dot for open, a tick for closed. */
function StateMark({ state }: { state: IssueState }) {
  return (
    <svg aria-hidden width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="shrink-0">
      {state === "open" ? (
        <>
          <circle cx="8" cy="8" r="6.2" />
          <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
        </>
      ) : (
        <path d="M3 8.5l3.2 3.2L13 4.8" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

const ACTION =
  "cursor-pointer rounded-sm text-[12.5px] font-medium text-muted-slate transition-colors duration-150 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent/70 disabled:cursor-default disabled:opacity-45 disabled:hover:text-muted-slate";

/** An action as words alone, with no box: `strong` is the one the issue is mostly here for, in Claude's colour. */
function TextAction({ strong, disabled, onClick, children }: { strong?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(ACTION, strong && "font-semibold text-claude-ink hover:text-claude disabled:hover:text-claude-ink")}
    >
      {children}
    </button>
  );
}

/** Open in green, closed in purple, as GitHub marks them. */
function StatePill({ state }: { state: IssueState }) {
  const ink = state === "open" ? "var(--color-diff-add-ink)" : "var(--color-issue-closed-ink)";
  const surface = state === "open" ? "var(--color-diff-add-surface)" : "var(--color-issue-closed-surface)";
  return (
    <span className="inline-flex items-center gap-1 rounded-full py-0.5 pl-1.5 pr-2.5 text-[11.5px] font-semibold" style={{ color: ink, background: surface }}>
      <StateMark state={state} />
      {state === "open" ? "Open" : "Closed"}
    </span>
  );
}

/** One post in the thread: the description or a comment, under its author's initials. */
function Post({ author, at, body }: { author: string; at: string; body: string }) {
  return (
    <li className="relative flex gap-3">
      <Avatar name={author || "?"} size={28} />
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-[12px] text-muted-slate">
          <span className="font-semibold text-ink">{author}</span> · {ago(at)}
        </p>
        <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-on-surface-variant">{body}</p>
      </div>
    </li>
  );
}

/**
 * A comment on the issue, posted as the signed-in GitHub user. One line until it
 * is used, then it grows; Ctrl/⌘+Enter posts it.
 */
function CommentBox({ blueprint, n, onPosted }: { blueprint: string; n: number; onPosted: () => void }) {
  const [text, setText] = useState("");
  const mac = useMac();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  async function post() {
    if (!text.trim() || sending) return;
    setSending(true);
    setError(null);
    const r = await fetch("/api/issues", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ blueprint, n, comment: text }),
    })
      .then((r) => r.json() as Promise<{ error?: string }>)
      .catch(() => ({ error: "Could not reach the app's server." }));
    setSending(false);
    if (r.error) return setError(r.error);
    setText("");
    onPosted();
  }
  const open = focused || !!text;
  return (
    <div className="min-w-0 flex-1">
      <div
        className={cn(
          "flex gap-2 rounded-md border bg-card pl-2.5 pr-1 transition-colors duration-150",
          open ? "flex-col items-stretch border-accent/60 py-1.5" : "items-center border-border-gray py-1",
        )}
      >
        <textarea
          id={`issue-${n}-comment`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void post();
            }
          }}
          rows={open ? 4 : 1}
          placeholder="Leave a comment"
          aria-label={`Comment on issue #${n}`}
          className="min-w-0 flex-1 resize-none bg-transparent py-0.5 text-[12.5px] leading-relaxed text-ink placeholder:text-faint focus:outline-none"
        />
        <div className="flex shrink-0 items-center justify-end gap-2">
          {open ? <span className="text-[11px] text-faint">{keys(mac, "Enter")}</span> : null}
          <Button
            variant="outline"
            size="sm"
            disabled={!text.trim() || sending}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void post()}
          >
            {sending ? "Commenting…" : "Comment"}
          </Button>
        </div>
      </div>
      {error ? (
        <p className="mt-1.5 text-[12px]" style={{ color: TINT.removed.ink }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
