"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { goTo, useLocation } from "@/components/chrome/crumbs";
import { openFileInTab } from "@/components/blueprint/code";
import { useBlueprint } from "@/components/blueprint/blueprint-context";
import { Kbd, dictateKeys, keys } from "@/components/ui/button";
import { StateChip } from "@/components/ui/state";
import { newProject, openFolder, openProjects } from "@/components/projects/projects";
import { openAudit } from "@/components/blueprint/audit";
import { openHistory } from "@/components/review/additions";
import { openDiff } from "@/components/review/diff";
import { openTimeline } from "@/components/review/timeline";
import { openFiles, useCitations, useFiles, useTrail } from "@/components/blueprint/files";
import { toggleWorkspace } from "@/lib/agent/workspace-toggle";
import { DocIcon, openDoc, useDocList } from "@/components/blueprint/docs";
import { openSettings, readSettings, saveSettings } from "@/lib/client/settings";
import type { Theme } from "@/lib/client/theme";
import { startDictation } from "@/lib/agent/dictate";
import type { Node } from "@/lib/blueprint/schema";
import { cn } from "@/lib/client/utils";
import { useDesktop, useMac } from "@/lib/client/platform";

/**
 * The palette: one box that goes anywhere. Type part of a level's name and
 * Enter opens it however deep it is, and a doc of the project's opens the
 * same way; start with `>` for the app's actions; Cmd+K finds a file or
 * symbol instead and opens it in the editor;
 * the blueprint name in the title bar opens it on the blueprints, and the status bar's
 * counts open it on the levels that are not certain or the problems found.
 *
 * It is what a sidebar tree would have been for — reaching a level without
 * walking down to it — without spending a column on it (D35, D62).
 */

const OPEN = "blueprint:palette";
export type PaletteMode = "all" | "code" | "actions" | "blueprints" | "unsure" | "problems" | "docs";
export const openPalette = (mode: PaletteMode = "all") =>
  window.dispatchEvent(new CustomEvent<PaletteMode>(OPEN, { detail: mode }));

interface Item {
  key: string;
  label: string;
  /** Where it is or what it does, after the label. */
  hint?: string;
  /** A second line: why a level is not certain, or what goes wrong. */
  detail?: string;
  kind: "level" | "action" | "blueprint" | "unsure" | "problem" | "doc" | "file" | "folder" | "symbol";
  node?: Node;
  /** Words it is about, matched last and weakest: a level's sub, detail and plain-words layer. */
  body?: string;
  kbd?: string;
  run: () => void;
}

/**
 * How well `q` matches `text`: every character of the query in order, scored
 * higher for a run of adjacent characters and for starting a word. Null when
 * it does not match at all.
 */
function score(q: string, text: string): number | null {
  if (!q) return 0;
  const t = text.toLowerCase();
  const at = t.indexOf(q);
  if (at !== -1) return 100 - at + (at === 0 || t[at - 1] === " " ? 50 : 0);
  let s = 0;
  let i = 0;
  let prev = -2;
  for (const ch of q) {
    const j = t.indexOf(ch, i);
    if (j === -1) return null;
    s += j === prev + 1 ? 3 : j === 0 || t[j - 1] === " " ? 2 : 0;
    prev = j;
    i = j + 1;
  }
  return s;
}

export function Palette() {
  const blueprint = useBlueprint();
  const router = useRouter();
  const { path } = useLocation();
  const [mode, setMode] = useState<PaletteMode | null>(null);
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const mac = useMac();
  const desktop = useDesktop();

  useEffect(() => {
    const show = (m: PaletteMode) => {
      setMode(m);
      setQuery(m === "actions" ? ">" : "");
      setSel(0);
    };
    const onOpen = (e: Event) => show((e as CustomEvent<PaletteMode>).detail);
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      // On a Mac the palette is Cmd+K; Ctrl+K in a terminal is the program's kill-line.
      if (e.code === "KeyK" && !e.metaKey && /Mac/.test(navigator.platform) && (e.target as Element | null)?.closest?.(".xterm")) return;
      if (e.code === "KeyK") {
        e.preventDefault();
        show("code");
      } else if (e.code === "KeyP" && !e.shiftKey) {
        e.preventDefault();
        show("all");
      } else if (e.code === "KeyP" && e.shiftKey) {
        e.preventDefault();
        show("actions");
      }
    };
    window.addEventListener(OPEN, onOpen);
    // Capture, so a focused terminal does not swallow the shortcut.
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener(OPEN, onOpen);
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);

  useEffect(() => {
    if (mode) input.current?.focus();
  }, [mode]);

  const levels = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const walk = (nodes: Node[], at: string[], trail: string[]) => {
      for (const n of nodes) {
        const p = [...at, n.id];
        out.push({
          key: `level:${p.join("/")}`,
          label: n.title,
          hint: trail.join(" › ") || blueprint.RUN.repo,
          kind: "level",
          node: n,
          body: [n.sub, n.detail, n.explain?.body].filter(Boolean).join(" ").toLowerCase(),
          run: () => goTo(p),
        });
        walk(n.children ?? [], p, [...trail, n.title]);
      }
    };
    out.push({ key: "level:", label: blueprint.RUN.repo, hint: "The top of the blueprint", kind: "level", kbd: "0", run: () => goTo([]) });
    walk(blueprint.L0, [], []);
    return out;
  }, [blueprint]);

  // The checkout's own names — paths and top-level symbols — each opening in
  // the editor over the deepest level that explains it, so closing the file
  // lands where it sits on a blueprint cut by features.
  const files = useFiles();
  const cited = useCitations();
  const trailOf = useTrail();
  const code = useMemo(() => {
    const out: Item[] = [];
    const deepest = (file: string, s = 1, e = Infinity) =>
      (cited.get(file) ?? []).filter((c) => c.start <= e && c.end >= s).sort((a, b) => b.path.length - a.path.length)[0]?.path;
    for (const [file, f] of Object.entries(files?.index?.files ?? {})) {
      const at = deepest(file);
      out.push({
        key: `file:${file}`,
        label: file,
        hint: at ? trailOf(at) : f.status === "excluded" ? "left out of the blueprint · opens the file" : "not on any level · opens the file",
        kind: "file",
        run: () => openFileInTab(blueprint.name, at ?? path, file),
      });
      for (const sym of f.symbols) {
        const by = deepest(file, sym.start, sym.end);
        out.push({
          key: `sym:${file}:${sym.name}:${sym.start}`,
          label: sym.name,
          hint: `${file} → ${by ? trailOf(by) : at ? `not explained; nearest ${trailOf(at)}` : "not explained"}`,
          kind: "symbol",
          run: () => openFileInTab(blueprint.name, by ?? at ?? path, file, sym.start),
        });
      }
    }
    // Files the blueprint has not seen: new since it was made, or ignored by git
    // and kept by hand, like the .env an API key goes in.
    for (const file of files?.added ?? [])
      out.push({ key: `file:${file}`, label: file, hint: "new since the blueprint was made · opens the file", kind: "file", run: () => openFileInTab(blueprint.name, path, file) });
    for (const file of files?.local ?? [])
      out.push({ key: `file:${file}`, label: file, hint: "not in git · opens the file", kind: "file", run: () => openFileInTab(blueprint.name, path, file) });
    // The rest of the checkout: everything, while a blueprint is still being made
    // and has no index; after, files the blueprint would not explain, like a README.
    const seen = new Set(out.map((it) => it.key));
    for (const file of files?.present ?? []) {
      if (seen.has(`file:${file}`)) continue;
      out.push({
        key: `file:${file}`,
        label: file,
        hint: files?.index ? "not on the blueprint · opens the file" : "the blueprint is still being made · opens the file",
        kind: "file",
        run: () => openFileInTab(blueprint.name, path, file),
      });
    }
    // Folders, each opening as a listing of what is directly inside it, so the
    // palette browses like a file explorer as well as searching.
    const browse = (dir: string) => () => {
      setMode("code");
      setQuery(dir && `${dir}/`);
      setSel(0);
    };
    const inside = new Map<string, number>();
    const tree = new Map<string, Item[]>([["", []]]);
    const childOf = (dir: string) => tree.get(dir) ?? tree.set(dir, []).get(dir)!;
    for (const it of out) {
      if (it.kind !== "file") continue;
      const parts = it.label.split("/");
      for (let i = 1; i < parts.length; i++) {
        const dir = parts.slice(0, i).join("/");
        inside.set(dir, (inside.get(dir) ?? 0) + 1);
      }
      childOf(parts.slice(0, -1).join("/")).push({ ...it, label: parts[parts.length - 1] });
    }
    for (const [dir, n] of inside) {
      const folder: Item = { key: `dir:${dir}`, label: `${dir}/`, hint: `${n} file${n === 1 ? "" : "s"}`, kind: "folder", run: browse(dir) };
      out.push(folder);
      const parent = dir.split("/").slice(0, -1).join("/");
      childOf(parent).push({ ...folder, label: `${dir.split("/").pop()}/` });
    }
    // Folders first, then files, each by name; and a way up out of any folder.
    for (const [dir, items] of tree) {
      items.sort((a, b) => (a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === "folder" ? -1 : 1));
      if (dir) items.unshift({ key: "dir:..", label: "../", hint: dir.split("/").slice(0, -1).join("/") || "the top", kind: "folder", run: browse(dir.split("/").slice(0, -1).join("/")) });
    }
    return { all: out, tree };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- trailOf reads the same blueprint as cited
  }, [files, cited, path, blueprint.name]);

  const docList = useDocList();
  const docs = useMemo<Item[]>(
    () =>
      (docList ?? []).map((d) => ({
        key: `doc:${d.path}`,
        // The file is what people call a doc; its heading says what is in it.
        label: d.path,
        hint: d.title || undefined,
        kind: "doc" as const,
        run: () => openDoc(d.path),
      })),
    [docList],
  );

  const actions = useMemo<Item[]>(() => {
    const theme = (t: Theme) => () => saveSettings({ ...readSettings(), theme: t });
    return [
      { key: "a:back", label: "Go back a level", kind: "action", kbd: "Esc", run: () => path.length && goTo(path.slice(0, -1)) },
      { key: "a:workspace", label: "Toggle Claude Code & terminal", kind: "action", kbd: keys(mac, "`"), run: toggleWorkspace },
      { key: "a:diff", label: "What changed in the code", hint: "Diff two commits over the blueprint", kind: "action", run: openDiff },
      { key: "a:files", label: "Every file", hint: "Where each part of the code is explained", kind: "action", run: () => openFiles() },
      { key: "a:timeline", label: "How the code got here", hint: "Its commits over time, on the blueprint's sections", kind: "action", run: openTimeline },
      { key: "a:audit", label: "How sure is this blueprint", hint: "What was checked, and what to double-check", kind: "action", run: () => openAudit(blueprint.name) },
      { key: "a:history", label: "What you added to this blueprint", kind: "action", run: openHistory },
      { key: "a:docs", label: "Read the docs…", hint: "The project's Markdown: design notes, decisions", kind: "action", run: () => setTimeout(() => openPalette("docs")) },
      { key: "a:open", label: "Open Folder…", hint: "Make a blueprint of a folder on this machine", kind: "action", run: () => void openFolder() },
      { key: "a:new", label: "New Project…", hint: "Start an empty folder", kind: "action", run: newProject },
      { key: "a:projects", label: "Projects", hint: "Your blueprints: open, regenerate, remove", kind: "action", run: () => openProjects() },
      { key: "a:blueprints", label: "Switch blueprint…", kind: "action", run: () => setTimeout(() => openPalette("blueprints")) },
      { key: "a:settings", label: "Settings", kind: "action", run: openSettings },
      // After the palette has closed, so the words go to Claude's prompt rather than the palette's field.
      ...(desktop
        ? [{ key: "a:dictate", label: "Dictate on this machine", hint: "Speak, then done; or hold the keys", kind: "action" as const, kbd: `Hold ${dictateKeys(mac)}`, run: () => setTimeout(startDictation) }]
        : []),
      { key: "a:classic", label: "Theme: classic", hint: "Cobalt ink, as on the landing page", kind: "action", run: theme("classic") },
      { key: "a:light", label: "Theme: light", kind: "action", run: theme("light") },
      { key: "a:dark", label: "Theme: dark", kind: "action", run: theme("dark") },
    ];
  }, [blueprint.name, path, mac, desktop]);

  const blueprints = useMemo<Item[]>(
    () =>
      blueprint.blueprints.map((m) => ({
        key: `blueprint:${m.id}`,
        label: m.label,
        hint: m.id === blueprint.name ? "open now" : undefined,
        kind: "blueprint" as const,
        run: () => router.push(`?blueprint=${encodeURIComponent(m.id)}`),
      })),
    [blueprint.blueprints, blueprint.name, router],
  );

  // What the status bar counts, each a way to the level it is on. Walked in
  // blueprint order, so the list reads top to bottom the way the blueprint does.
  const findings = useMemo(() => {
    const unsure: Item[] = [];
    const problems: Item[] = [];
    const walk = (n: Node, p: string[], trail: string[]) => {
      const where = trail.join(" › ") || blueprint.RUN.repo;
      const run = () => goTo(p);
      if (n.state !== "derived") {
        unsure.push({ key: `u:${p.join("/")}`, label: n.title, hint: where, detail: n.unsure, kind: "unsure", node: n, run });
      }
      n.issues?.forEach((is, i) =>
        problems.push({
          key: `p:${p.join("/")}:${i}`,
          label: is.title,
          hint: `in ${n.title}`,
          detail: is.detail,
          kind: "problem",
          run,
        }),
      );
      for (const c of n.children ?? []) walk(c, [...p, c.id], p.length ? [...trail, n.title] : []);
    };
    // The repository itself is a level too (D60), and can carry both.
    walk(blueprint.TOP, [], []);
    return { unsure, problems };
  }, [blueprint]);

  const shown = useMemo(() => {
    const actionsOnly = query.startsWith(">");
    const q = (actionsOnly ? query.slice(1) : query).trim().toLowerCase();
    // Nothing typed, or a folder's path: list that folder, as an explorer would.
    if (mode === "code" && (!query.trim() || query.endsWith("/"))) {
      const listing = code.tree.get(query.trim().replace(/\/$/, ""));
      if (listing) return listing;
    }
    const pool =
      mode === "blueprints" ? blueprints
      : mode === "unsure" ? findings.unsure
      : mode === "problems" ? findings.problems
      : mode === "docs" ? docs
      : mode === "code" ? code.all
      : actionsOnly ? actions
      : q ? [...levels, ...docs, ...actions]
      : levels;
    return pool
      // A hint or a body counts only as a plain substring: scattered letters
      // across a sentence match nearly anything.
      .map((it) => ({ it, s: score(q, it.label) ?? (it.hint?.toLowerCase().includes(q) ? 1 : it.body?.includes(q) ? 0.5 : null) }))
      .filter((x): x is { it: Item; s: number } => x.s !== null)
      .sort((a, b) => b.s - a.s)
      .slice(0, 60)
      .map((x) => x.it);
  }, [mode, query, levels, code, docs, actions, blueprints, findings]);

  useEffect(() => {
    list.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  if (!mode) return null;
  const close = () => setMode(null);
  const run = (it: Item | undefined) => {
    if (!it) return;
    close();
    it.run();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center bg-night/20 px-4 pt-[12vh]"
      onPointerDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        role="dialog"
        aria-label="Go to"
        className="flex h-fit max-h-[60vh] w-full max-w-[600px] flex-col overflow-hidden border border-border-strong bg-card shadow-lift"
      >
        <input
          ref={input}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              close();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, shown.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(shown[sel]);
            }
          }}
          placeholder={
            mode === "blueprints" ? "Switch to a blueprint…"
            : mode === "unsure" ? `${findings.unsure.length} ${findings.unsure.length === 1 ? "level" : "levels"} the blueprint is not certain about — filter…`
            : mode === "problems" ? `${findings.problems.length} ${findings.problems.length === 1 ? "problem" : "problems"} found in the code — filter…`
            : mode === "docs" ? (docList === null ? "Finding the docs…" : `${docList.length} docs in this project — filter…`)
            : mode === "code" ? "Open a file, folder or symbol in the editor…"
            : "Go to a level, or type > for actions"
          }
          className="h-11 w-full shrink-0 border-b border-border-gray bg-transparent px-4 text-[14px] text-ink placeholder:text-faint focus:outline-none"
        />
        <ul ref={list} role="listbox" className="min-h-0 overflow-y-auto py-1">
          {shown.length ? (
            shown.map((it, i) => (
              <li key={it.key} data-i={i} role="option" aria-selected={i === sel}>
                <button
                  type="button"
                  onPointerMove={() => setSel(i)}
                  onClick={() => run(it)}
                  className={cn(
                    "flex w-full cursor-pointer gap-2.5 px-4 text-left",
                    it.detail ? "items-start py-2" : "items-center py-[7px]",
                    // Not surface-container-low: in Dark that is the card's own colour, a step too close to show.
                    i === sel && "bg-surface-container",
                  )}
                >
                  <KindIcon kind={it.kind} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2.5">
                      <span className={cn("truncate text-[13px] text-ink", it.kind === "symbol" && "shrink-0")}>{it.label}</span>
                      {it.node && it.kind === "level" ? <StateChip state={it.node.state} alarm={it.node.alarm} /> : null}
                      {it.hint ? <span className="min-w-0 truncate text-[12px] text-faint">{it.hint}</span> : null}
                      <span className="flex-1" />
                      {it.kbd ? <Kbd>{it.kbd}</Kbd> : null}
                    </span>
                    {it.detail ? (
                      <span className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-muted-slate">{it.detail}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))
          ) : (
            <li className="px-4 py-3 text-[13px] text-faint">
              {mode === "unsure" && !findings.unsure.length
                ? "Every level is certain."
                : mode === "problems" && !findings.problems.length
                  ? "The blueprint found no problems."
                  : mode === "docs" && docList && !docList.length
                    ? "This project has no Markdown."
                    : "Nothing matches."}
            </li>
          )}
        </ul>
        <footer className="flex shrink-0 items-center gap-3 border-t border-border-gray bg-surface px-4 py-1.5 text-[11.5px] text-faint">
          <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
          <span className="flex items-center gap-1"><Kbd>Enter</Kbd> open</span>
          {mode === "all" || mode === "actions" ? <span className="flex items-center gap-1"><Kbd>&gt;</Kbd> actions</span> : null}
          <span className="flex-1" />
          <span className="flex items-center gap-1"><Kbd>Esc</Kbd> close</span>
        </footer>
      </div>
    </div>
  );
}

function KindIcon({ kind }: { kind: Item["kind"] }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(
        "shrink-0",
        kind === "unsure" ? "mt-[3px] text-amber-ink" : kind === "problem" ? "mt-[3px] text-clay-ink" : "text-faint",
      )}
      aria-hidden
    >
      {kind === "unsure" ? (
        <>
          <circle cx="8" cy="8" r="6" />
          <path d="M6.3 6.2a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.7.5-.7 1v.4M8 11.4v.1" />
        </>
      ) : kind === "problem" ? (
        <path d="M8 2 14.5 13.5h-13zM8 6.5v3M8 11.6v.1" />
      ) : kind === "level" ? (
        <>
          <rect x="2" y="2.5" width="12" height="11" rx="2" />
          <path d="M5 6h6M5 9h4" />
        </>
      ) : kind === "doc" ? (
        <DocIcon />
      ) : kind === "file" ? (
        <path d="M4 1.5h5l3 3v10H4zM9 1.5v3h3" />
      ) : kind === "symbol" ? (
        <path d="M6 3.5c-1.5 0-2 .7-2 2v1c0 .8-.5 1.5-1.5 1.5 1 0 1.5.7 1.5 1.5v1c0 1.3.5 2 2 2M10 3.5c1.5 0 2 .7 2 2v1c0 .8.5 1.5 1.5 1.5-1 0-1.5.7-1.5 1.5v1c0 1.3-.5 2-2 2" />
      ) : kind === "blueprint" || kind === "folder" ? (
        <path d="M1.5 4.5a1 1 0 0 1 1-1h3.6l1.5 1.5h5.9a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" />
      ) : (
        <path d="m5 4 4 4-4 4M9 12h3" />
      )}
    </svg>
  );
}
