"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DIALOG, Overlay, Segmented } from "@/components/ui/dialog";
import { IssuesTab } from "@/components/review/issues";
import { Button } from "@/components/ui/button";
import { PanelClose } from "@/components/ui/panel";
import { cn } from "@/lib/client/utils";
import { OPEN_DIFF, TINT, useDiff } from "@/components/review/diff";
import { goTo } from "@/components/chrome/crumbs";
import { useBlueprint } from "@/components/blueprint/blueprint-context";
import type { Commit, SectionDiff } from "@/lib/server/diff";
import { ReviewCard, ReviewPicker, Outside } from "@/components/review/reviews";
import { FileRow, PendingFileRow, Rail, Row } from "@/components/review/commits";
import { Comparing, Details, EndTag, OnTheBlueprint } from "@/components/review/commit-detail";
import { setDiffFile, useDiffFile } from "@/components/review/diff-file";
import { showBlueprint } from "@/lib/agent/workspace-toggle";
import { ago } from "@/components/review/ago";
import { openTimeline } from "@/components/review/timeline";

/**
 * The history and what each commit did, laid out the way a code editor's
 * source control is (D75): the commits down the left, one line each, and the
 * commit picked on the right — who, when, which sections of the blueprint it
 * moved, each opening its level where the red and green are drawn in place
 * (components/review/diff.tsx), and its files. A file picked opens in a tab
 * of the workspace window (components/review/diff-file.tsx) and the panel
 * closes, so the lines get the screen; opening it again comes back to the commit.
 *
 * A commit's line counts are given once, on its files: the list says only
 * what each commit is and when, so picking one never changes its height.
 *
 * ↑/↓ walk the commits, so reading a commit is the arrow key and nothing
 * else. Comparing is any two commits, as an editor's history does it:
 * "Compare" on a row, or ⇧/⌘-click it; the right side then names both ends
 * and can swap them. It opens on the newest commit — the blueprint keeps
 * itself current, so "since the blueprint was made" is not a question worth a
 * row (D76).
 *
 * Mounted once beside the other dialogs and opened by the same event that
 * turns diff mode on, so there is one way in. Leaving is `off`, in the header.
 */
type Tab = "commits" | "issues";
const TABS: { value: Tab; label: string }[] = [
  { value: "commits", label: "Commits" },
  { value: "issues", label: "Issues" },
];

export function DiffPanel() {
  const d = useDiff();
  const { nodeAt, name: blueprint } = useBlueprint();
  const [shown, setShown] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("commits");
  const reading = useDiffFile();
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
  // The file read in the workspace (components/review/diff-file.tsx), while it is one of this pick's.
  const open = reading && reading.files === files ? (files.find((f) => f.path === reading.path) ?? null) : null;
  // The file is what is read now, so the panel makes way for it.
  const setFile = (path: string) => {
    setDiffFile({ files, path });
    setShown(false);
  };

  /** The commit in view: the one picked, or the newer end of a comparison. */
  const anchor = picked ?? pair?.with;
  const active = anchor ? commits.indexOf(anchor) : -1;

  useEffect(() => {
    if (shown) list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [shown, active]);
  useEffect(() => {
    if (shown) list.current?.focus({ preventScroll: true });
  }, [shown]);

  if (!shown || !d) return null;
  // Issues are GitHub's: elsewhere the panel is its commits alone.
  const view: Tab = d.repo?.github ? tab : "commits";

  function pick(c: Commit) {
    if (c !== picked) d!.setRange(`${c.sha}~1`, c.sha);
  }

  /** The commit in view, compared with `c`: the older is the base. */
  function compare(c: Commit) {
    if (!anchor || anchor === c) return pick(c);
    const [newer, older] = all.indexOf(anchor) < all.indexOf(c) ? [anchor, c] : [c, anchor];
    d!.setRange(older.sha, newer.sha);
  }

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
    : single
      ? single
      : d.from || d.to
        ? `Comparing ${short(d.from) || "the start"} ⇄ ${short(d.to) || "your working tree"}`
        : "Reading the history…";

  const moved = !d.loading && diff?.basis === "sections" && diff.sections.some((s) => s.verdict !== "untouched");
  const onBlueprint =
    diff && !d.loading ? (
      <>
        {diff.basis === "files" ? <p className="mt-6 text-[12.5px] leading-snug text-on-surface-variant">{diff.why}</p> : null}
        {diff.basis === "sections" ? <OnTheBlueprint sections={diff.sections} trail={trail} onOpen={(s) => (goTo(s.path), setShown(false))} /> : null}
        {diff.outside?.length ? <Outside outside={diff.outside} title={(p) => nodeAt(p)?.title ?? p.at(-1)!} onOpen={(p) => (goTo(p), setShown(false))} /> : null}
      </>
    ) : null;
  const fileList = d.loading ? (
    picked ? (
      <>
        <FilesHeading files={picked.files.length} added={picked.added} removed={picked.removed} />
        <div className="mt-1.5 overflow-hidden rounded-md border border-border-gray">
          {picked.files.slice(0, 200).map((p) => (
            <PendingFileRow key={p} path={p} />
          ))}
        </div>
        <p className="mt-6 text-[12.5px] text-muted-slate">Reading what it changed on the blueprint…</p>
      </>
    ) : (
      <p className="mt-4 text-[13px] text-muted-slate">Reading what changed…</p>
    )
  ) : diff ? (
    <>
      <FilesHeading files={diff.files.length} added={diff.files.reduce((n, f) => n + f.added, 0)} removed={diff.files.reduce((n, f) => n + f.removed, 0)} />
      {diff.files.length ? (
        <div className="mt-1.5 overflow-hidden rounded-md border border-border-gray">
          {diff.files.map((f) => (
            <FileRow key={f.path} file={f} flat on={f === open} onPick={() => setFile(f.path)} />
          ))}
        </div>
      ) : (
        <p className="mt-1.5 text-[13px] text-muted-slate">Nothing changed.</p>
      )}
    </>
  ) : null;

  return (
    <Overlay
      onClose={() => setShown(false)}
      dim
    >
      <div className={DIALOG + " pop h-[min(620px,100%)] max-w-[940px]"}>
        <header className="flex shrink-0 items-center gap-1.5 border-b border-border-gray bg-surface-container-low px-5 py-3">
          {/* Issues are GitHub's, so a checkout elsewhere has only its commits. */}
          {d.repo?.github ? (
            <div className="mr-2">
              <Segmented label="Commits or issues" value={view} options={TABS} onChange={setTab} />
            </div>
          ) : (
            <h2 className="mr-2 text-[15px] font-semibold leading-tight tracking-[-0.01em] text-ink">Commits</h2>
          )}
          {/* The commit tools are about commits, so the Issues tab goes without them. */}
          {view === "commits" ? (
            <>
              <div className="flex min-w-0">
                <ReviewPicker blueprint={blueprint} value={d.review} onPick={d.setReview} />
              </div>
              <span className="flex-1" />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShown(false);
                  openTimeline();
                  // A tab docked in the main view would hide the timeline it opens on.
                  showBlueprint();
                }}
                title="How the code got here — every commit on the blueprint's sections, over time"
              >
                Timeline
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShown(false)}
                title="Close this and see the changes colored on the blueprint"
                className="text-accent"
              >
                Show on blueprint
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  d.off();
                  setShown(false);
                }}
              >
                Leave diff
              </Button>
            </>
          ) : (
            <span className="flex-1" />
          )}
          <PanelClose onClick={() => setShown(false)} className="my-0 ml-1" />
        </header>

        {view === "issues" ? (
          <IssuesTab blueprint={blueprint} onGiven={() => setShown(false)} />
        ) : (
        <div className="flex min-h-0 flex-1">
          {/* ── history ── */}
          <aside className="flex w-[300px] shrink-0 flex-col border-r border-border-gray">
            <div className="shrink-0 border-b border-border-gray p-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter commits"
                title="By message, author or sha"
                aria-label="Filter commits"
                className="w-full rounded-md border border-border-gray bg-card px-2.5 py-1.5 text-[12px] text-ink placeholder:text-faint focus:border-accent focus:outline-none"
              />
            </div>
            <div
              ref={list}
              role="listbox"
              aria-label="Commits"
              tabIndex={0}
              onKeyDown={(e) => {
                if ((e.key !== "ArrowDown" && e.key !== "ArrowUp") || !commits.length) return;
                e.preventDefault();
                const at = Math.max(0, Math.min(commits.length - 1, (active < 0 ? 0 : active) + (e.key === "ArrowDown" ? 1 : -1)));
                pick(commits[at]);
              }}
              className="min-h-0 flex-1 overflow-y-auto py-1 outline-none"
            >
              {commits.map((c, i) => {
                const on = c === anchor;
                const n = all.indexOf(c);
                const end = c === pair?.base ? "base" : c === pair?.with ? "compare" : null;
                const inPair = !!span && n >= span[0] && n <= span[1];
                return (
                  <Row
                    key={c.sha}
                    on={on || !!end}
                    soft={inPair}
                    onPick={(e) => (e.shiftKey || e.metaKey || e.ctrlKey ? compare(c) : pick(c))}
                    title={`${c.subject}\n${c.author} · ${new Date(c.at).toLocaleString()}\n${c.short} · +${c.added} −${c.removed}\n⇧ or ⌘-click to compare`}
                  >
                    <Rail dot={(c.parents?.length ?? 0) > 1 ? "merge" : on || inPair ? "on" : "off"} first={i === 0} last={i === commits.length - 1} />
                    <span className="flex min-w-0 flex-1 items-center gap-1 py-1.5">
                      {end ? <EndTag end={end} /> : null}
                      <span className="min-w-0 truncate text-[12.5px] text-ink">{c.subject}</span>
                    </span>
                    <span className={cn("shrink-0 py-1.5 text-[11px] text-faint", anchor && anchor !== c && "group-hover:invisible")}>{ago(c.at)}</span>
                    {anchor && anchor !== c ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          compare(c);
                        }}
                        title={`Compare ${c.short} with ${anchor.short}`}
                        className="absolute right-2 top-1/2 hidden -translate-y-1/2 cursor-pointer rounded border border-border-strong bg-card px-1.5 py-0.5 text-[10.5px] text-ink shadow-panel hover:border-accent group-hover:block"
                      >
                        ⇄ Compare
                      </button>
                    ) : null}
                  </Row>
                );
              })}
              {!all.length ? <p className="px-4 py-3 text-[12px] text-muted-slate">{d.listed ? "No commits yet." : "Reading the history…"}</p> : null}
              {q && !commits.length ? <p className="px-4 py-3 text-[12px] text-muted-slate">No commit matches “{query}”.</p> : null}
            </div>
          </aside>

          {/* ── what the pick changed ── */}
          <main className="flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              {picked ? (
                <Details key={picked.sha} blueprint={blueprint} commit={picked} all={all} onPick={pick} />
              ) : pair?.base && pair.with ? (
                <Comparing
                  base={pair.base}
                  other={pair.with}
                  between={span ? span[1] - span[0] : 0}
                  onSwap={() => d.setRange(d.to, d.from)}
                  onDone={() => pick(pair.with!)}
                />
              ) : (
                <h3 className="text-[17px] font-semibold leading-snug text-ink">{caption}</h3>
              )}
              {diff?.review ? <ReviewCard r={diff.review} blueprint={blueprint} spec={d.review} onMade={d.reload} /> : null}
              {d.error ? (
                <p className="mt-4 text-[13px]" style={{ color: TINT.removed.ink }}>
                  {d.error}
                </p>
              ) : null}
              {/* Where it changed on the blueprint leads when it moved anything there. */}
              {moved ? onBlueprint : null}
              {fileList}
              {moved ? null : onBlueprint}
            </div>
          </main>
        </div>
        )}
      </div>
    </Overlay>
  );
}

/** The commit's line counts, given once, over its files. */
function FilesHeading({ files, added, removed }: { files: number; added: number; removed: number }) {
  return (
    <h3 className="tnum mt-6 flex items-baseline gap-2 text-[12px] font-medium text-muted-slate">
      {files} {files === 1 ? "file" : "files"}
      <span className="font-mono text-[11px]">
        <span style={{ color: TINT.added.ink }}>+{added}</span> <span style={{ color: TINT.removed.ink }}>−{removed}</span>
      </span>
    </h3>
  );
}
