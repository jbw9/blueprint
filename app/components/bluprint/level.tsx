"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/client/utils";
import { AnatomyView, type RowCtx } from "@/components/bluprint/anatomy";
import { TableGlyph } from "@/components/bluprint/anatomy/glyphs";
import { DocsList, Example, ExplainedBlock, WatchOut, isExplained, sectionOrder } from "@/components/bluprint/blocks";
import { Building, DraftNote, Stages, NoBluprint, isBuilding, useDrawIn } from "@/components/projects/building";
import { CodePopup, ExplainToggle, Explainer, StartHere, parseAt, useExplain, type CodeFocus } from "@/components/bluprint/explain";
import { Glossary, SymbolLinks } from "@/components/ui/state";
import { Button } from "@/components/ui/button";
import { useBluprint } from "@/components/bluprint/bluprint-context";
import { openFile } from "@/components/bluprint/code";
import { AgentIcon, CLAUDE, useAgents } from "@/components/agent/agents";
import { handTo, sectionKey, usePicked } from "@/lib/agent/context";
import { FixAndKeep, onAnswer } from "@/components/review/keep";
import { BlockDiffView, RemovedSections, useBlockDiffs } from "@/components/review/diff";
import type { Exchange } from "@/lib/agent/keep";
import { codeAt, describeProblems, problemSpans } from "@/lib/bluprint/build";
import { STATIC_BLUPRINT, readSource } from "@/lib/bluprint/source";
import type { Anatomy, Node } from "@/lib/bluprint/schema";
import { citations, neighbours, nodesAt, symbolsOf } from "@/lib/bluprint/coverage";
import { useFiles } from "@/components/bluprint/files";
import { useDesktop } from "@/lib/client/platform";
import { projectAction } from "@/lib/client/api";
import { authored, nearBottom, setNote, siblingEdges } from "@/components/bluprint/nodes";
import { Header } from "@/components/bluprint/header";
import { BLOCK_NOUN, Caption, Grid, List, Note, Reach, Steps } from "@/components/bluprint/layouts";

/**
 * The last answer Claude gave, so any level can offer to keep it. Held here
 * rather than per level: the reader asks from one level and may well want it on
 * the one they moved to, and a level unmounting must not forget it.
 */
function useLatestAnswer(): Exchange | null {
  const [answer, setAnswer] = useState<Exchange | null>(null);
  useEffect(() => onAnswer(setAnswer), []);
  return answer;
}

/**
 * Asks the default agent (Settings) about a section's problems, all of them,
 * straight away: Claude takes them as context with the question, and the
 * button follows them there; another agent gets them in its prompt with the
 * question, sent. In the desktop app, where the agents run, and on a published
 * bluprint, to its Claude panel.
 */
function HandProblems({ node, path }: { node: Node; path: string[] }) {
  const bluprint = useBluprint();
  const { main } = useAgents();
  const desktop = useDesktop();
  const key = `${sectionKey(path)}#problems`;
  const status = usePicked(key);
  const [pasted, setPasted] = useState(false);
  useEffect(() => {
    if (!pasted) return;
    const timer = setTimeout(() => setPasted(false), 2500);
    return () => clearTimeout(timer);
  }, [pasted]);
  if (!desktop && !STATIC_BLUPRINT) return null;
  const claude = main.id === CLAUDE.id;
  const label = claude
    ? status === "queued"
      ? "Asking Claude…"
      : status === "sent"
        ? "Sent to Claude — ask again"
        : "Ask Claude"
    : pasted
      ? `Sent to ${main.label}`
      : `Ask ${main.label}`;
  return (
    <Button
      size="sm"
      tone="alarm"
      icon={<AgentIcon id={main.id} />}
      disabled={claude && status === "queued"}
      onClick={async () => {
        // The code goes along, so the agent answers from it instead of
        // spending calls finding it; a file it cannot read is left out.
        const read = await Promise.all(
          problemSpans(bluprint, path).map(async (s) => {
            const r = await readSource({ bluprint: bluprint.name, ...s }).catch(() => null);
            return r && "slice" in r ? { ...s, end: s.start + r.slice.code.split("\n").length - 1, code: r.slice.code } : null;
          }),
        );
        const source = read.filter((s) => s !== null);
        handTo(
          main.id,
          { key, title: `Problems in ${node.title}`, text: describeProblems(bluprint, path, source) },
          source.length
            ? `Look into the problems in "${node.title}" from the bluprint. The code each one points at is attached: check each against it, explain what goes wrong, and suggest a fix. Read more of the repo only if what is attached is not enough.`
            : `Look into the problems in "${node.title}" from the bluprint: check each against the code, explain what goes wrong, and suggest a fix.`,
        );
        if (!claude) setPasted(true);
      }}
      title={
        claude
          ? "Asks Claude about every problem here, with its section and code"
          : `Asks ${main.label} about every problem here, with its section and code`
      }
    >
      {label}
    </Button>
  );
}

/** What a whole block is called when it is handed over. */
function blockLabel(b: Anatomy): string {
  if ("caption" in b && b.caption) return b.caption;
  if (b.kind === "screen") return `The ${b.title} screen`;
  if (b.kind === "schema") return `The ${b.table} table`;
  if (b.kind === "source") return b.file;
  return BLOCK_NOUN[b.kind] ? `The ${BLOCK_NOUN[b.kind]}` : b.kind;
}

/* ── levels ──────────────────────────────────────────────────── */

/**
 * One open node, explained. Top to bottom: what it is (header), the picture of
 * how it fits together, its own data — tables, screens, who talks to whom —
 * then its parts to go deeper, what to watch out for, and last, folded, the
 * code (D34).
 *
 * A level still shows ONE step of depth: a part below is named, never opened
 * in place (D31). What changed is that the open level itself now carries
 * enough to be understood without reading the code.
 */
export function Level({
  node,
  path,
  ctx,
  onOpen,
}: {
  node: Node;
  path: string[];
  ctx: RowCtx;
  onOpen: (p: string[]) => void;
}) {
  const bluprint = useBluprint();
  const { RUN, nodeAt } = bluprint;
  const kids = authored(node);
  const parent = path.length > 1 ? nodeAt(path.slice(0, -1)) : null;
  // The empty path is the repository itself (D60): nothing above it to go back to.
  const top = path.length === 0;
  const note = setNote(node);
  const sequence = node.group?.ordering === "sequence";
  const blocks = node.anatomy ?? [];
  // Which parts a box on this level's diagram already opens — those drive the
  // list below down to a quiet index (D40).
  const onDiagram = new Set(
    blocks
      .flatMap((b) => (b.kind === "diagram" ? b.boxes : []))
      .map((box) => box.opens)
      .filter((id): id is string => Boolean(id) && kids.some((k) => k.id === id)),
  );
  // The order the picture assigns its section hues, so the list below can
  // carry the same ones. Taken from the first diagram that leads anywhere —
  // the same one whose boxes the reader just looked at.
  // A box may open a row-built child too (check.ts allows it), so owning is
  // tested against every child, not only the authored ones listed below.
  const owns = (id: string) => Boolean(node.children?.some((k) => k.id === id));
  const hueOrder = sectionOrder(
    blocks.find(
      (b): b is Extract<Anatomy, { kind: "diagram" }> =>
        b.kind === "diagram" && b.boxes.some((x) => x.opens && owns(x.opens)),
    ) ?? { kind: "diagram", caption: "", boxes: [], arrows: [] },
    owns,
  );
  // The code is the last layer: a level with parts below it points down at
  // them, and only a level with nothing below it shows its lines — opened
  // over the page from the step that explains them, or all at once from the
  // header, never listed under the level (D68).
  const code = node.children?.length ? [] : codeAt(bluprint, path);
  const [codeFocus, setCodeFocus] = useState<CodeFocus | null>(null);
  const showStep = (at: string, heading: string, detail?: string) => {
    const ref = parseAt(at);
    if (ref) setCodeFocus({ heading, detail, refs: [ref] });
  };
  const levelCtx: RowCtx = { ...ctx, onStepCode: showStep };
  const [explainOn] = useExplain();
  const index = useFiles()?.index ?? null;
  const key = path.join("/");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is `path` by value
  const reach = useMemo(() => neighbours(bluprint.L0, index, path), [bluprint.L0, index, key]);
  const walks = bluprint.OVERVIEW?.walkthroughs ?? (explainOn && bluprint.OVERVIEW?.walkthrough ? [bluprint.OVERVIEW.walkthrough] : []);
  // Each indexed symbol a level cites, by name, to the deepest level citing it;
  // a name two places define links nowhere rather than to the wrong one.
  const symbols = useMemo(() => {
    const cited = citations(bluprint.L0);
    const at = new Map<string, string[] | null>();
    for (const [file, f] of Object.entries(index?.files ?? {}))
      for (const s of symbolsOf(cited, file, f)) {
        const p = s.by[0]?.path;
        if (!p) continue;
        const prev = at.get(s.name);
        at.set(s.name, prev === undefined || prev?.join("/") === p.join("/") ? p : null);
      }
    return at;
  }, [bluprint.L0, index]);
  const linkOf = (name: string) => {
    const p = symbols.get(name.replace(/\(.*\)$/, "")) ?? symbols.get(name.replace(/\(.*\)$/, "").split(".").pop()!);
    return p && p.join("/") !== key ? () => onOpen(p) : undefined;
  };
  // A scenery box's code, opened at the section that explains it: the deepest
  // citing that line, else the root that owns the file, else the file itself.
  const openRef = (ref: string) => {
    const m = /^(.+?)(?::(\d+))?(?:-\d+)?$/.exec(ref);
    if (!m) return;
    const cited = citations(bluprint.L0);
    const hit = m[2] ? nodesAt(cited, m[1], +m[2])[0] : (cited.get(m[1]) ?? []).slice().sort((a, b) => a.path.length - b.path.length)[0];
    const root = index?.files[m[1]]?.roots.find((r) => bluprint.L0.some((n) => n.id === r));
    if (hit) onOpen(hit.path);
    else if (root) onOpen([root]);
    else openFile(path, m[1], m[2] ? +m[2] : undefined);
  };
  // Only a bluprint made with the plain-words layer offers the toggle.
  const explains = Boolean(bluprint.OVERVIEW?.explain || bluprint.L0.some((r) => r.explain));
  const trail = [RUN.repo, ...path.map((_, i) => nodeAt(path.slice(0, i + 1))?.title ?? "")];
  const answer = useLatestAnswer();
  // Empty outside diff mode, so the block render below is unchanged then.
  const blockDiffs = useBlockDiffs(path);
  // Two or more data shapes (a table, a file's fields, a stored value) are one
  // section of names, each opening its own body, instead of a stack of full
  // cards. Not in a diff that touches one: the red and green must be on screen.
  const shapes = blocks.flatMap((b, i) => (b.kind === "schema" || b.kind === "example" ? [i] : []));
  const grouped = shapes.length > 1 && !shapes.some((i) => blockDiffs.has(i));
  // A bluprint still being made (D69): until its overview lands the repository's
  // level is the run itself, and a root still being checked is a draft.
  const run = top && isBuilding(bluprint.progress, Boolean(bluprint.OVERVIEW)) ? bluprint.progress : undefined;
  const [watched, setWatched] = useState(false);
  if (run && !watched) setWatched(true);
  const column = useRef<HTMLDivElement>(null);
  useDrawIn(column, top && watched && !run);
  const draft = !top && Boolean(nodeAt(path.slice(0, 1))?.draft);
  // A quick section still to be written in full (pipeline.ts, --fast): the
  // reader opening it asks for it next, and its header says what is coming.
  const section = top ? undefined : path[0];
  const queued = section && bluprint.progress?.stage === "deepen" ? bluprint.progress.roots.find((r) => r.id === section) : undefined;
  const deepening = queued?.status === "queued" || queued?.status === "drafting" ? queued.status : undefined;
  useEffect(() => {
    if (deepening === "queued" && section) void projectAction({ action: "focus", id: bluprint.name, section }).catch(() => {});
  }, [deepening, section, bluprint.name]);
  // A project opened without a bluprint, and no run making one (lib/server/bluprints.ts, noBluprint).
  const noBluprint = top && !STATIC_BLUPRINT && !bluprint.progress && !node.children?.length && !blocks.length;

  return (
    <Glossary.Provider value={explainOn ? (bluprint.OVERVIEW?.glossary ?? []) : []}>
    <SymbolLinks.Provider value={linkOf}>
      <Header
        path={path}
        deepening={deepening}
        back={
          top
            ? undefined
            : path.slice(0, -1).reduce(
                (crumbs, _, i) => [
                  ...crumbs,
                  { label: nodeAt(path.slice(0, i + 1))?.title ?? "", path: path.slice(0, i + 1), onClick: () => onOpen(path.slice(0, i + 1)) },
                ],
                [{ label: RUN.repo, path: [] as string[], onClick: () => onOpen([]) }],
              )
        }
        eyebrow={top ? undefined : `Inside ${parent?.title ?? RUN.repo}`}
        title={node.title}
        state={node.state}
        origin={node.origin}
        alarm={node.alarm}
        // A row-built node's fallback sub is "Inside <parent>", which the
        // eyebrow already says.
        sub={node.sub === `Inside ${parent?.title}` ? undefined : node.sub}
        detail={node.detail}
        unsure={node.state === "derived" ? undefined : node.unsure}
        meta={
          top
            ? RUN.commit ? `${RUN.files} files · commit ${RUN.commit}` : undefined
            : !nearBottom(node)
            ? undefined
            : node.footprint
              ? `${node.footprint.dirs.join("  ")}  ·  ${node.footprint.files} files`
              : node.evidence
        }
        link={top && RUN.url && RUN.commit ? { href: `${RUN.url}/tree/${RUN.commit}`, label: `${RUN.url.replace(/^https:\/\//, "")} ↗` } : undefined}
        shape={node.shape}
        onCode={code.length ? () => setCodeFocus({ heading: `The code behind ${node.title}`, refs: code, verified: node.verified }) : undefined}
        actions={
          <>
            {explains ? <ExplainToggle /> : null}
            <FixAndKeep path={path} answer={answer} />
          </>
        }
      />

      {/* One hairline between every block, the full width of the level, so it
          is plain where one thing ends and the next begins — a picture under
          a table is its own thing, not more of the table. Each block's width
          cap is on an inner box, so the line never stops at a ragged edge. */}
      {draft ? (
        <div className="mb-8">
          <DraftNote detail={bluprint.progress?.roots.find((r) => r.id === path[0])?.detail} />
        </div>
      ) : null}
      <div
        ref={column}
        className={cn("flex flex-col [&>*+*]:mt-10 [&>*+*]:border-t [&>*+*]:border-border-gray [&>*+*]:pt-10", draft && "opacity-60")}
      >
        {run ? <Building progress={run} onOpen={onOpen} /> : null}
        {noBluprint ? <NoBluprint id={bluprint.name} /> : null}
        {top && !run && bluprint.progress && bluprint.progress.stage !== "done" ? <Stages progress={bluprint.progress} /> : null}
        {/* For a reader new to all of this: the level in plain words, before
            any of the terse parts. */}
        {explainOn && node.explain ? <Explainer owner={node.id} explain={node.explain} ctx={levelCtx} /> : null}

        {(run ? [] : blocks).map((b, i) =>
          grouped && shapes.includes(i) ? (
            i === shapes[0] ? (
              <DataShapes key={i} owner={node.id} blocks={shapes.map((j) => blocks[j] as DataBlock)} ctx={levelCtx} />
            ) : null
          ) : blockDiffs.has(i) ? (
            <div key={i} data-pick={blockLabel(b)}>
              <div className={b.kind === "diagram" ? "" : "max-w-[1100px]"}>
                <BlockDiffView block={b} diff={blockDiffs.get(i)!} />
              </div>
            </div>
          ) : isExplained(b) ? (
            <div key={i} data-pick={blockLabel(b)}>
              <div className={b.kind === "diagram" ? "" : "max-w-[1100px]"}>
                <ExplainedBlock
                  block={b}
                  onOpen={(id) =>
                    owns(id) ? onOpen([...path, id]) : undefined
                  }
                  hrefFor={(id) =>
                    `?${[...path, id].map((p) => `at=${encodeURIComponent(p)}`).join("&")}`
                  }
                  onCode={showStep}
                  onRef={openRef}
                />
              </div>
            </div>
          ) : (
            // The older blocks are typeset for a 340px card (11px rows); zoom
            // lifts them to reading size without forking their type scale.
            <div key={i} data-pick={blockLabel(b)}>
              <div className="max-w-[900px] [zoom:1.18]">
                <AnatomyView owner={node.id} blocks={[b]} ctx={levelCtx} />
              </div>
            </div>
          ),
        )}

        {/* When every part is a box on the picture, the picture is the list. */}
        {kids.length && onDiagram.size < kids.length && !run ? (
          <section>
            <Caption
              count={kids.length}
              what={kids.length === 1 ? "part" : "parts"}
              how={
                onDiagram.size
                  ? `${onDiagram.size} of them on the picture above`
                  : sequence
                    ? "in order — open one to go deeper"
                    : "open one to go deeper"
              }
            />
            {note ? <Note>{note}</Note> : null}
            {sequence ? (
              <Steps nodes={kids} edges={siblingEdges(node, kids)} at={path} onOpen={onOpen} />
            ) : onDiagram.size ? (
              // The picture is the way down, so the list stops competing with
              // it: names and problems, no cards, no blurbs, no paths (D40).
              <List nodes={kids} at={path} onOpen={onOpen} hue={hueOrder} />
            ) : (
              <Grid nodes={kids} at={path} onOpen={onOpen} />
            )}
          </section>
        ) : null}

        {/* A part the commit deleted stays on screen, in red: the whole point
            of a diff is seeing what went, beside what replaced it. Outside the
            parts section, because a level whose only part was deleted has no
            parts left to hang it under — and that is when it matters most.
            Renders nothing when there are none, diff mode or not. */}
        <RemovedSections path={path} />

        {!run ? <Reach uses={reach.uses} usedBy={reach.usedBy} /> : null}

        {/* The repository's way in comes after its picture: the walkthroughs
            open parts the reader has just seen drawn. A bluprint from before they
            were core keeps its one under the Explain layer. */}
        {top && !run && walks.length ? <StartHere walkthroughs={walks} onOpen={onOpen} /> : null}

        {node.issues?.length ? (
          <div>
            <div className="max-w-[820px]">
              <WatchOut issues={node.issues} action={<HandProblems node={node} path={path} />} onCode={showStep} />
            </div>
          </div>
        ) : null}

        {node.docs?.length ? (
          <div>
            <div className="max-w-[820px]">
              <DocsList refs={node.docs} />
            </div>
          </div>
        ) : null}

      </div>

      {codeFocus ? (
        <CodePopup focus={codeFocus} trail={trail} owner={node.id} ctx={ctx} onClose={() => setCodeFocus(null)} />
      ) : null}
    </SymbolLinks.Provider>
    </Glossary.Provider>
  );
}

/* ── data shapes ─────────────────────────────────────────────── */

type DataBlock = Extract<Anatomy, { kind: "schema" | "example" }>;

/** A shape's name, what it is in a few words, and how much is inside. */
function shapeLabel(b: DataBlock): { name: string; gloss?: string; size: string } {
  if (b.kind === "schema") {
    const file = /\.\w+$/.test(b.table);
    return { name: b.table, size: `${b.rows.length} ${file ? "fields" : "columns"}` };
  }
  const [name, ...rest] = b.caption.split(" — ");
  return { name, gloss: rest.join(" — ") || undefined, size: "example" };
}

/**
 * The level's data shapes, listed by name; each opens in place to its fields
 * or its example, the way the code drawer's places do.
 */
function DataShapes({ owner, blocks, ctx }: { owner: string; blocks: DataBlock[]; ctx: RowCtx }) {
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const labels = blocks.map(shapeLabel);
  const what = labels.every((l) => /\.\w+$/.test(l.name))
    ? "files"
    : blocks.every((b) => b.kind === "schema")
      ? "tables"
      : "shapes of data";
  const toggle = (i: number) =>
    setOpen((was) => {
      const next = new Set(was);
      if (!next.delete(i)) next.add(i);
      return next;
    });
  return (
    <section>
      <Caption count={blocks.length} what={what} how="open one to see what is in it" />
      <ul className="flex max-w-[1100px] flex-col gap-2">
        {blocks.map((b, i) => {
          const { name, gloss, size } = labels[i];
          const shown = open.has(i);
          return (
            <li key={i} data-pick={blockLabel(b)} className="overflow-hidden border border-border-gray bg-card">
              <button
                onClick={() => toggle(i)}
                aria-expanded={shown}
                className="flex w-full items-baseline gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-container-low"
              >
                <span className="self-center">{b.kind === "schema" ? <TableGlyph /> : <ExampleGlyph />}</span>
                <span className="shrink-0 font-mono text-[13px] font-semibold text-ink">{name}</span>
                {gloss ? <span className="min-w-0 truncate text-[13px] text-on-surface-variant">{gloss}</span> : null}
                <span className="ml-auto shrink-0 font-mono text-[11px] text-faint">{size}</span>
                <span aria-hidden className="text-[11px] text-faint">{shown ? "▾" : "▸"}</span>
              </button>
              {shown ? (
                <div className="border-t border-border-gray">
                  {b.kind === "schema" ? (
                    // The schema rows are typeset for a 340px card; zoom lifts them as elsewhere on a level.
                    <div className="[zoom:1.18]">
                      <AnatomyView owner={owner} blocks={[b]} ctx={ctx} headless />
                    </div>
                  ) : (
                    <div className="p-3">
                      <Example block={b} bare />
                    </div>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** A page with lines: a stored value, as the table glyph is a table. */
function ExampleGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2.5 1.5h5l2 2v7h-7z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" className="text-muted-slate" />
      <path d="M4 6h4M4 8h3" stroke="currentColor" strokeWidth="1" className="text-muted-slate" />
    </svg>
  );
}
