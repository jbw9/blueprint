"use client";

import { cn } from "@/lib/client/utils";
import { rowId, type Anatomy } from "@/lib/map/schema";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Slice, WriteResult } from "@/lib/server/repo";
import { useMap } from "@/components/map/map-context";
import { readSource, SOURCE_URL } from "@/lib/map/source";
import { useLocation } from "@/components/chrome/crumbs";
import { openFileInTab } from "@/components/map/code";
import { CodeEditor } from "@/components/ui/editor";
import type { RowCtx } from "@/components/map/anatomy";
import { rowClass } from "@/components/map/anatomy/layout";
import { FileGlyph } from "@/components/map/anatomy/glyphs";

/**
 * The bottom of the map, read from the real repository.
 *
 * Three things are kept strictly apart, and the separation is the point:
 *
 *   the CODE       verbatim from a real file at a real line, read from disk
 *   the WHY        synthesized commentary, in its own tinted band
 *   the FINDING    when disk no longer says what the map quoted
 *
 * The fixture's text is still what renders first, so the card is readable
 * before any request finishes and readable at all if the repo is not there.
 * Once the read lands, disk wins — with a mark saying it drifted, if it did.
 * Silently swapping fresh code under a stale explanation is the exact failure
 * this project exists to study, so it is the one thing that cannot happen here.
 */
export function SourceView({
  owner,
  block,
  ctx,
}: {
  owner: string;
  block: Extract<Anatomy, { kind: "source" }>;
  ctx: RowCtx;
}) {
  const id = rowId(owner, "source");
  const isLit = ctx.traced === id;

  const quoted = block.code.replace(/\n$/, "");
  const end = block.start + quoted.split("\n").length - 1;

  const [slice, setSlice] = useState<Slice | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // Null until the reader types: the pane is always editable, and only a
  // change makes a draft (D74).
  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState<WriteResult | null>(null);
  const { name: map } = useMap();
  const { path } = useLocation();

  /**
   * One read of the repository, resolved to what the UI should show.
   *
   * Pure apart from the read: it sets no state, which is what lets the effect
   * below subscribe to it rather than call setState in its own body.
   */
  const read = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const r = await readSource({ map, file: block.file, start: block.start, end, fixture: quoted }, signal);
        return "slice" in r ? { slice: r.slice, failed: null } : { slice: null, failed: r.refused };
      } catch {
        return { slice: null, failed: "unreachable" };
      }
    },
    [map, block.file, block.start, end, quoted],
  );

  // Aborted on unmount and whenever the block changes, so a slow response for
  // one source block can never land as the state of a different one.
  useEffect(() => {
    const ac = new AbortController();
    read(ac.signal).then((r) => {
      if (ac.signal.aborted) return;
      setSlice(r.slice);
      setFailed(r.failed);
    });
    return () => ac.abort();
  }, [read]);

  // Disk is the truth once we have it; the fixture is the fallback.
  const shown = slice?.code ?? quoted;
  const dirty = draft !== null && draft !== shown;
  const drifted = slice != null && !slice.matchesFixture;

  // Nothing is ever written without an explicit act — the Save button or ⌘S.
  // Never a keystroke, a blur, a timer or navigation.
  async function save() {
    if (!dirty) return;
    const res = await fetch("/api/source", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        map,
        file: block.file,
        start: block.start,
        end,
        code: draft,
        // What we read is what we claim is there. A write built on anything
        // else is the stale-read clobber the contract exists to refuse.
        expected: shown,
      }),
    });
    const body = (await res.json()) as WriteResult;
    setSaved(body);
    if (body.ok) {
      setDraft(null);
      // Re-read rather than trusting the draft: what is now on disk is the
      // only thing this card is allowed to show as the file's contents.
      const r = await read();
      setSlice(r.slice);
      setFailed(r.failed);
    }
  }

  return (
    <div
      data-pick={`${block.file}:${block.start}`}
      data-pick-code={`${block.file}:${block.start}-${end}`}
      className={cn(
        "overflow-hidden border bg-card",
        drifted ? "border-amber-line" : isLit ? "border-accent" : "border-border-gray",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 border-b border-border-gray px-3 py-1.5",
          drifted ? "bg-amber-surface" : "bg-surface",
        )}
      >
        <button
          data-row={id}
          onClick={() => ctx.onTrace(id)}
          className={rowClass(id, ctx, "flex min-w-0 flex-1 items-center gap-2")}
        >
          <FileGlyph />
          {/* file:line as one addressable string, not a path with a number
              stranded on the far side of the row. */}
          <span
            className={cn(
              "min-w-0 truncate text-left font-mono text-[11px]",
              isLit ? "font-semibold text-accent" : "text-on-surface",
            )}
          >
            {block.file}
            <span className="text-faint">:{block.start}</span>
          </span>
        </button>
        {/* "733 of 779 lines" — where this sits in the file, which a quote
            with no denominator cannot say. */}
        {slice ? (
          <span className="tnum shrink-0 font-mono text-[9.5px] text-faint">
            {block.start.toLocaleString()} of {slice.total.toLocaleString()} lines
          </span>
        ) : null}
        <CopyPath text={`${block.file}:${block.start}`} />
        {/* A static export has no repository to write to: it links to the code host instead. */}
        {SOURCE_URL ? (
          <a
            href={`${SOURCE_URL}/${block.file}#L${block.start}-L${end}`}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 border border-border-strong px-1.5 py-0.5 font-mono text-[9px] text-muted-slate transition-colors hover:text-on-surface"
          >
            github ↗
          </a>
        ) : (
          /* The code here is a slice; the whole file opens in a tab of its own. */
          <button
            onClick={(e) => {
              e.stopPropagation();
              openFileInTab(map, path, block.file, block.start);
            }}
            title={`Open all of ${block.file} in a new tab, to read and edit`}
            className="shrink-0 border border-border-strong px-1.5 py-0.5 font-mono text-[9px] text-muted-slate transition-colors hover:text-on-surface"
          >
            open file ↗
          </button>
        )}
      </div>

      {/* The finding, stated before the code it is about. */}
      {drifted ? (
        <p className="border-b border-amber-line bg-amber-surface px-3 py-1.5 text-[10px] leading-relaxed text-amber-ink">
          <span className="font-semibold">Drifted.</span> The file no longer says
          what the map quoted here. The code below is what is on disk now; the
          explanation under it was written about the older text.
        </p>
      ) : null}
      {failed ? (
        <p className="border-b border-border-gray bg-surface-container-low px-3 py-1.5 text-[10px] leading-relaxed text-muted-slate">
          Could not read the repository ({failed}). Showing the quote the map
          was authored with, which nothing has verified against disk.
        </p>
      ) : null}

      {/* Real line numbers, counting from the file's own offset, coloured by
          lib/client/highlight.ts — and editable where it is read. */}
      <CodeEditor file={block.file} start={block.start} value={draft ?? shown} onChange={setDraft} onSave={() => void save()} readOnly={Boolean(SOURCE_URL)} />
      {/* The diff is shown BEFORE the write, and the write needs Save or ⌘S.
          There is no other path to disk. */}
      {dirty ? (
        <div className="border-t border-border-gray px-3 py-2">
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                void save();
              }}
              className=" bg-accent px-2 py-1 font-mono text-[10px] text-on-accent"
            >
              save to disk ⌘S
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDraft(null);
                setSaved(null);
              }}
              className=" border border-border-strong px-2 py-1 font-mono text-[10px] text-muted-slate hover:text-on-surface"
            >
              discard
            </button>
            <span className="font-mono text-[9.5px] text-faint">rewrites {block.file}:{block.start}-{end}</span>
          </div>
          <DraftDiff before={shown} after={draft!} />
        </div>
      ) : null}
      {saved && !saved.ok ? (
        <p className="border-t border-border-gray px-3 py-2 text-[10px] leading-relaxed text-clay-ink">
          Refused: {saved.refused}
          {saved.refused === "stale" ? " — the file changed since this was read. Discard and reopen to get the current text." : null}
        </p>
      ) : null}

      {/* Commentary, in its own band, below the code, labelled. It is
          synthesized and must never be able to read as something the file
          says. */}
      {block.why ? (
        <div className="flex gap-2 border-t border-border-gray bg-surface-container-low px-3 py-2">
          <span className="mt-[3px] shrink-0 font-mono text-[9px] uppercase tracking-[0.09em] text-faint">
            why
          </span>
          <p className="text-[10px] leading-relaxed text-on-surface-variant">
            {block.why}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** Line-wise diff of the pending edit, shown before anything is written. */
function DraftDiff({ before, after }: { before: string; after: string }) {
  // Only the lines between the first and last that differ: the pane is
  // always editable, so one typed character must not paint the whole slice.
  let b = before.split("\n");
  let a = after.split("\n");
  let head = 0;
  while (head < b.length && head < a.length && b[head] === a[head]) head++;
  let tail = 0;
  while (tail < b.length - head && tail < a.length - head && b[b.length - 1 - tail] === a[a.length - 1 - tail]) tail++;
  b = b.slice(head, b.length - tail);
  a = a.slice(head, a.length - tail);
  return (
    <pre className="mt-2 overflow-x-auto border border-border-gray bg-card py-1.5 font-mono text-[10.5px] leading-[1.5]">
      {b.map((l, i) => (
        <div key={`b${i}`} className="bg-clay-surface px-3 text-clay-ink">
          <span className="select-none">- </span>
          {l || " "}
        </div>
      ))}
      {a.map((l, i) => (
        <div key={`a${i}`} className="bg-accent-surface px-3 text-accent">
          <span className="select-none">+ </span>
          {l || " "}
        </div>
      ))}
    </pre>
  );
}

/** Copies `file:line`, the string you paste into an editor or a message. */
function CopyPath({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(text);
        setDone(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setDone(false), 1200);
      }}
      title={`Copy ${text}`}
      className="shrink-0 border border-border-strong px-1.5 py-0.5 font-mono text-[9px] text-muted-slate transition-colors hover:text-on-surface"
    >
      {done ? "copied" : "copy path"}
    </button>
  );
}
