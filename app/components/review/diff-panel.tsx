"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { DIALOG, Overlay } from "@/components/ui/dialog";
import { OPEN_DIFF, TINT, useDiff } from "@/components/review/diff";
import { goTo } from "@/components/chrome/crumbs";
import { useBluprint } from "@/components/bluprint/bluprint-context";
import { cn } from "@/lib/client/utils";
import type { Commit, SectionDiff } from "@/lib/server/diff";
import { ReviewCard, ReviewPicker, Outside } from "@/components/review/reviews";
import { FileRow, Rail, Row } from "@/components/review/commits";
import { Comparing, Details, EndTag, FilePane, OnTheBluprint, Refs } from "@/components/review/commit-detail";
import type { View } from "@/components/review/diff-view";
import { ago } from "@/components/review/ago";
import { openTimeline } from "@/components/review/timeline";

/**
 * The history and what each commit did, laid out the way a code editor's
 * source control is (D75): the commits down the left on one line, the one
 * picked opening onto its files beneath it, and the file picked drawn on the
 * right, side by side or inline. With no file picked the right side is the
 * commit itself — who, when, and which sections of the bluprint it moved, each
 * opening its level, where the red and green are drawn in place
 * (components/review/diff.tsx).
 *
 * ↑/↓ walk commits and files as one list, so reading a commit is the arrow
 * key and nothing else. Comparing is any two commits, as an editor's history
 * does it: "Compare with selected" on a row, or ⇧/⌘-click it; the right side
 * then names both ends and can swap them. It opens on the newest commit —
 * the bluprint keeps itself current, so "since the bluprint was made" is not a
 * question worth a row (D76).
 *
 * Mounted once beside the other dialogs and opened by the same event that
 * turns diff mode on, so there is one way in. Leaving is `off`, in the header.
 */

type Item = { k: "commit"; c: Commit } | { k: "file"; path: string };
const VIEW_KEY = "bluprint.diff.view";

export function DiffPanel() {
  const d = useDiff();
  const { nodeAt, name: bluprint } = useBluprint();
  const [shown, setShown] = useState(false);
  const [file, setFile] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === "inline" ? "inline" : "split";
    } catch {
      return "split";
    }
  });
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const on = () => setShown(true);
    window.addEventListener(OPEN_DIFF, on);
    return () => window.removeEventListener(OPEN_DIFF, on);
  }, []);

  const diff = d?.diff ?? null;
  const all = useMemo(() => d?.commits ?? [], [d?.commits]);
  const q = query.trim().toLowerCase();
  const commits = useMemo(
    () => (q ? all.filter((c) => c.subject.toLowerCase().includes(q) || c.author.toLowerCase().includes(q) || c.sha.startsWith(q)) : all),
    [all, q],
  );

  const is = (c: Commit, ref?: string) => !!ref && (c.sha === ref || c.short === ref || c.sha.startsWith(ref));
  const single = d?.to && d.from === `${d.to}~1` ? d.to : undefined;
  const picked = single ? all.find((c) => is(c, single)) : undefined;
  // Two commits compared: `from` is the base, `to` what it is compared with.
  const pair = !single && d && !d.review && d.from && d.to ? { base: all.find((c) => is(c, d.from)), with: all.find((c) => is(c, d.to)) } : null;
  const span = pair?.base && pair.with ? [all.indexOf(pair.base), all.indexOf(pair.with)].sort((a, b) => a - b) : null;
  const files = d && !d.loading ? (diff?.files ?? []) : [];
  const open = files.find((f) => f.path === file) ?? null;

  const items: Item[] = [];
  for (const c of commits) {
    items.push({ k: "commit", c });
    if (c === (picked ?? pair?.with)) for (const f of files) items.push({ k: "file", path: f.path });
  }
  const active = items.findIndex((it) =>
    open ? it.k === "file" && it.path === open.path : it.k === "commit" && it.c === (picked ?? pair?.with),
  );

  useEffect(() => {
    if (shown) list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [shown, active]);
  useEffect(() => {
    if (shown) list.current?.focus({ preventScroll: true });
  }, [shown]);

  if (!shown || !d) return null;

  function pick(it: Item) {
    if (it.k === "file") return setFile(it.path);
    setFile(null);
    if (it.c !== picked) d!.setRange(`${it.c.sha}~1`, it.c.sha);
  }

  /** The commit in view, compared with `c`: the older is the base. */
  const anchor = picked ?? pair?.with;
  function compare(c: Commit) {
    if (!anchor || anchor === c) return pick({ k: "commit", c });
    const [newer, older] = all.indexOf(anchor) < all.indexOf(c) ? [anchor, c] : [c, anchor];
    setFile(null);
    d!.setRange(older.sha, newer.sha);
  }

  const setViewKept = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  };

  /** The trail to a section, in the titles the reader sees rather than ids. */
  const trail = (s: SectionDiff) =>
    s.path
      .slice(0, -1)
      .map((_, i) => nodeAt(s.path.slice(0, i + 1))?.title ?? s.path[i])
      .join(" › ");

  const short = (ref?: string) => (ref ? (all.find((c) => is(c, ref))?.short ?? ref.slice(0, 7)) : "");
  const caption = d.review
    ? d.review.startsWith("turn:")
      ? "What one agent turn changed"
      : d.review.startsWith("pr:")
        ? `Reviewing pull request #${d.review.slice(3)}`
        : `Reviewing ${d.review.split("...")[1]} since it left ${d.review.split("...")[0]}`
    : picked
      ? `${picked.short} · ${picked.subject}`
      : single
        ? single
        : d.from || d.to
          ? `Comparing ${short(d.from) || "the start"} ⇄ ${short(d.to) || "your working tree"}`
          : "Reading the history…";

  return (
    <Overlay onClose={() => setShown(false)}>
      <div className={DIALOG + " h-full max-w-[1320px]"}>
        <header className="flex shrink-0 items-center gap-3 border-b border-border-gray px-4 py-2.5">
          <h2 className="text-[14px] font-semibold text-ink">History</h2>
          <span className="min-w-0 flex-1 truncate text-[12px] text-muted-slate">{caption}</span>
          <div role="group" aria-label="Diff layout" className="flex shrink-0 border border-border-gray p-0.5">
            {(["split", "inline"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setViewKept(v)}
                className={cn(
                  "cursor-pointer px-2 py-0.5 text-[11.5px]",
                  view === v ? "bg-accent/15 text-ink" : "text-muted-slate hover:text-ink",
                )}
              >
                {v === "split" ? "Side by side" : "Inline"}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setShown(false);
              openTimeline();
            }}
            title="How the code got here — every commit on the bluprint's sections, over time"
            className="shrink-0 cursor-pointer px-2 py-1 text-[12px] text-muted-slate hover:bg-surface-container-low hover:text-ink"
          >
            Timeline
          </button>
          <button
            type="button"
            onClick={() => setShown(false)}
            title="Close this and keep the bluprint coloured by what changed"
            className="shrink-0 cursor-pointer px-2 py-1 text-[12px] text-accent hover:bg-surface-container-low"
          >
            See it on the bluprint
          </button>
          <button
            type="button"
            onClick={() => {
              d.off();
              setShown(false);
            }}
            className="shrink-0 cursor-pointer px-2 py-1 text-[12px] text-muted-slate hover:bg-surface-container-low hover:text-ink"
          >
            Leave diff
          </button>
          <button
            type="button"
            aria-label="Close"
            onClick={() => setShown(false)}
            className="shrink-0 cursor-pointer px-1.5 py-0.5 text-[15px] leading-none text-muted-slate hover:bg-surface-container-low hover:text-ink"
          >
            ×
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          {/* ── history ── */}
          <aside className="flex w-[340px] shrink-0 flex-col border-r border-border-gray">
            <div className="shrink-0 border-b border-border-gray p-2">
              <ReviewPicker bluprint={bluprint} value={d.review} onPick={d.setReview} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter commits by message, author or sha"
                aria-label="Filter commits"
                className="mt-2 w-full border border-border-gray bg-card px-2.5 py-1.5 text-[12px] text-ink placeholder:text-faint focus:border-accent focus:outline-none"
              />
            </div>
            <div
              ref={list}
              role="listbox"
              aria-label="Commits and their files"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
                e.preventDefault();
                const at = Math.max(0, Math.min(items.length - 1, (active < 0 ? 0 : active) + (e.key === "ArrowDown" ? 1 : -1)));
                pick(items[at]);
              }}
              className="min-h-0 flex-1 overflow-y-auto py-1 outline-none"
            >
              {items.map((it, i) => {
                const on = i === active;
                const first = i === 0;
                const last = i === items.length - 1;
                if (it.k === "file") {
                  const f = files.find((x) => x.path === it.path)!;
                  return <FileRow key={`f:${it.path}:${i}`} file={f} on={on} last={last} onPick={() => pick(it)} />;
                }
                const c = it.c;
                const n = all.indexOf(c);
                const end = c === pair?.base ? "base" : c === pair?.with ? "compare" : null;
                const inPair = !!span && n >= span[0] && n <= span[1];
                return (
                  <Fragment key={c.sha}>
                    <Row
                      on={on || !!end}
                      soft={inPair}
                      onPick={(e) => (e.shiftKey || e.metaKey || e.ctrlKey ? compare(c) : pick(it))}
                      title={`${c.subject}\n${c.author} <${c.email ?? ""}> · ${new Date(c.at).toLocaleString()}\n${c.sha}`}
                    >
                      <Rail dot={(c.parents?.length ?? 0) > 1 ? "merge" : on || inPair ? "on" : "off"} first={first} last={last} />
                      <span className="min-w-0 flex-1 py-1.5">
                        <span className="flex items-center gap-1">
                          {end ? <EndTag end={end} /> : null}
                          <Refs refs={c.refs} max={2} />
                          <span className="min-w-0 truncate text-[12.5px] text-ink">{c.subject}</span>
                        </span>
                        <span className="block truncate text-[11px] text-muted-slate">
                          {ago(c.at)} · {c.author}
                        </span>
                      </span>
                      <span className="shrink-0 py-1.5 text-right font-mono text-[10.5px] leading-[1.55]">
                        <span className="block text-faint">{c.short}</span>
                        <span className="tnum block">
                          <span style={{ color: TINT.added.ink }}>+{c.added}</span> <span style={{ color: TINT.removed.ink }}>−{c.removed}</span>
                        </span>
                      </span>
                      {anchor && anchor !== c ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            compare(c);
                          }}
                          title={`Compare ${c.short} with ${anchor.short}`}
                          className="absolute right-2 top-1/2 hidden -translate-y-1/2 cursor-pointer border border-border-strong bg-card px-1.5 py-0.5 text-[10.5px] text-ink shadow-sm hover:border-accent group-hover:block"
                        >
                          ⇄ Compare with {anchor.short}
                        </button>
                      ) : null}
                    </Row>
                    {/* The commit's own paths, from the log, while its diff is read. */}
                    {c === picked && d.loading
                      ? c.files.slice(0, 200).map((p) => (
                          <div key={p} className="flex items-center gap-1.5 pr-3 text-faint">
                            <Rail />
                            <span className="min-w-0 flex-1 truncate pl-3 font-mono text-[11.5px]">{p}</span>
                          </div>
                        ))
                      : null}
                  </Fragment>
                );
              })}
              {!all.length ? <p className="px-4 py-3 text-[12px] text-muted-slate">Reading the history…</p> : null}
              {q && !commits.length ? <p className="px-4 py-3 text-[12px] text-muted-slate">No commit matches “{query}”.</p> : null}
            </div>
            <p className="shrink-0 border-t border-border-gray px-3 py-1.5 text-[11px] text-faint">↑↓ to move · ⇧ or ⌘-click a second commit to compare</p>
          </aside>

          {/* ── what the pick changed ── */}
          <main className="flex min-w-0 flex-1 flex-col">
            {open ? (
              <FilePane
                file={open}
                view={view}
                at={files.indexOf(open)}
                of={files.length}
                onStep={(k) => setFile(files[files.indexOf(open) + k]?.path ?? open.path)}
                onBack={() => setFile(null)}
              />
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                {picked ? (
                  <Details key={picked.sha} bluprint={bluprint} commit={picked} all={all} onPick={(c) => pick({ k: "commit", c })} />
                ) : pair?.base && pair.with ? (
                  <Comparing
                    base={pair.base}
                    other={pair.with}
                    between={span ? span[1] - span[0] : 0}
                    onSwap={() => (setFile(null), d.setRange(d.to, d.from))}
                    onDone={() => pick({ k: "commit", c: pair.with! })}
                  />
                ) : (
                  <h3 className="text-[17px] font-semibold leading-snug text-ink">{caption}</h3>
                )}
                {diff?.review ? <ReviewCard r={diff.review} bluprint={bluprint} spec={d.review} onMade={d.reload} /> : null}
                {d.loading ? <p className="mt-4 text-[13px] text-muted-slate">Reading what changed…</p> : null}
                {d.error ? (
                  <p className="mt-4 text-[13px]" style={{ color: TINT.removed.ink }}>
                    {d.error}
                  </p>
                ) : null}
                {diff && !d.loading ? (
                  <>
                    <p className="tnum mt-2 font-mono text-[11.5px] text-muted-slate">
                      {diff.files.length} {diff.files.length === 1 ? "file" : "files"} ·{" "}
                      <span style={{ color: TINT.added.ink }}>+{diff.files.reduce((n, f) => n + f.added, 0)}</span>{" "}
                      <span style={{ color: TINT.removed.ink }}>−{diff.files.reduce((n, f) => n + f.removed, 0)}</span>
                    </p>
                    {/* A file-level answer never pretends to be a section-level one. */}
                    <h3 className="mt-6 text-[12px] font-medium text-muted-slate">Files — pick one to read its lines</h3>
                    {diff.files.length ? (
                      <div className="mt-1.5 overflow-hidden border border-border-gray">
                        {diff.files.map((f) => (
                          <FileRow key={f.path} file={f} flat onPick={() => setFile(f.path)} />
                        ))}
                      </div>
                    ) : (
                      <p className="mt-1.5 text-[13px] text-muted-slate">Nothing changed.</p>
                    )}
                    {diff.basis === "files" ? <p className="mt-4 text-[12.5px] leading-snug text-on-surface-variant">{diff.why}</p> : null}
                    {diff.basis === "sections" ? <OnTheBluprint sections={diff.sections} trail={trail} onOpen={(s) => (goTo(s.path), setShown(false))} /> : null}
                    {diff.outside?.length ? <Outside outside={diff.outside} title={(p) => nodeAt(p)?.title ?? p.at(-1)!} onOpen={(p) => (goTo(p), setShown(false))} /> : null}
                  </>
                ) : null}
              </div>
            )}
          </main>
        </div>
      </div>
    </Overlay>
  );
}
