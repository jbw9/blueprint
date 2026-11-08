"use client";

import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { type ReactNode, useEffect, useRef, useSyncExternalStore } from "react";
import { keys } from "@/components/ui/button";
import { VIEWS, type MarkdownView } from "@/components/ui/markdown-editor";
import { useMac } from "@/lib/client/platform";
import { cn } from "@/lib/client/utils";

/**
 * A file open as an editor opens it: the whole view, edge to edge. A
 * breadcrumb over the path with a dot while there are unsaved changes, the
 * editor in all the room left, and a status line under it with where the
 * caret is, the language and whether it is saved. The same frame for a file
 * from the blueprint, a doc and a file a terminal named, so they read as one editor.
 */

/** The language CodeMirror knows the file as, by its name. */
export function languageOf(file: string) {
  return LanguageDescription.matchFilename(languages, file)?.name ?? "Plain text";
}

/** A path as its crumbs, the home folder written `~`. */
export function crumbsOf(path: string) {
  const home = path.match(/^\/Users\/[^/]+|^\/home\/[^/]+/)?.[0];
  return (home ? `~${path.slice(home.length)}` : path).split("/").filter(Boolean);
}

export function FileFrame({
  path,
  dirty,
  onSave,
  active = true,
  tools,
  status,
  children,
  className,
  style,
}: {
  path: string;
  dirty?: boolean;
  /** ⌘S, wherever the focus is while this frame is the one in front (a ticked task box leaves it outside the editor). */
  onSave?: () => void;
  /** False while the frame is kept but hidden, behind another tab. */
  active?: boolean;
  /** Controls at the breadcrumb's right: a Markdown view switch, a close. */
  tools?: ReactNode;
  /** The status line's contents. */
  status?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const crumbs = crumbsOf(path);
  const save = useRef(onSave);
  useEffect(() => {
    save.current = onSave;
  });
  const saves = Boolean(onSave);
  useEffect(() => {
    if (!active || !saves) return;
    const onKey = (e: KeyboardEvent) => {
      // The editor's own ⌘S has already saved and taken the key.
      if (e.defaultPrevented || e.key.toLowerCase() !== "s" || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      e.preventDefault();
      save.current?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, saves]);
  return (
    <div data-chrome className={cn("flex flex-col bg-code", className)} style={style}>
      <div className="flex h-8 shrink-0 items-center gap-3 border-b border-border-gray pl-4 pr-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto font-mono text-[11.5px] text-faint" title={path}>
          {crumbs.map((c, i) => (
            <span key={i} className="flex shrink-0 items-center gap-1">
              {i > 0 ? <span aria-hidden>›</span> : null}
              <span className={cn(i === crumbs.length - 1 && "text-ink")}>{c}</span>
            </span>
          ))}
          {dirty ? <span aria-label="Unsaved changes" title="Unsaved changes" className="ml-1.5 size-2 shrink-0 rounded-full bg-ink" /> : null}
        </div>
        {tools ? <div className="flex shrink-0 items-center gap-2">{tools}</div> : null}
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">{children}</div>
      <div className="flex h-6 shrink-0 items-center gap-4 border-t border-border-gray px-4 font-mono text-[11px] text-faint">{status}</div>
    </div>
  );
}

/** The status line of a text file: caret, length, language, encoding, and the save. */
export function TextStatus({
  file,
  caret,
  lines,
  dirty,
  saved,
  readOnly,
}: {
  file: string;
  caret?: { line: number; col: number } | null;
  lines: number;
  dirty: boolean;
  /** "saved" after a save, the reason when one was refused. */
  saved: "saved" | string | null;
  readOnly?: boolean;
}) {
  const mac = useMac();
  return (
    <>
      {caret ? (
        <span className="tnum">
          Ln {caret.line}, Col {caret.col}
        </span>
      ) : null}
      <span className="tnum">{lines.toLocaleString()} lines</span>
      <span>{languageOf(file)}</span>
      <span>UTF-8</span>
      <span className="ml-auto truncate">
        {readOnly ? (
          "Read only"
        ) : saved && saved !== "saved" ? (
          <span className="text-clay-ink">Not saved: {saved}</span>
        ) : dirty ? (
          `${keys(mac, "S")} to save`
        ) : saved === "saved" ? (
          "Saved"
        ) : null}
      </span>
    </>
  );
}

const VIEW_KEY = "blueprint:markdown-view";

/** The Markdown view, kept from one file to the next as an editor keeps it. */
export function useMarkdownView() {
  const view = useSyncExternalStore(subscribe, readView, () => "live" as const);
  const choose = (v: MarkdownView) => {
    localStorage.setItem(VIEW_KEY, v);
    heard.forEach((f) => f());
  };
  return [view, choose] as const;
}
const heard = new Set<() => void>();
function subscribe(f: () => void) {
  heard.add(f);
  window.addEventListener("storage", f);
  return () => {
    heard.delete(f);
    window.removeEventListener("storage", f);
  };
}
function readView(): MarkdownView {
  const kept = localStorage.getItem(VIEW_KEY);
  return kept === "source" || kept === "split" ? kept : "live";
}

/** Live, Source and Split, for a Markdown file. */
export function ViewSwitch({ view, onView }: { view: MarkdownView; onView: (v: MarkdownView) => void }) {
  return (
    <div role="radiogroup" aria-label="Markdown view" className="flex border border-border-gray">
      {VIEWS.map((v) => (
        <button
          key={v.id}
          type="button"
          role="radio"
          aria-checked={view === v.id}
          title={v.title}
          onClick={() => onView(v.id)}
          className={cn(
            "cursor-pointer px-2 py-0.5 text-[11px] leading-[16px]",
            view === v.id ? "bg-surface-container text-ink" : "text-faint hover:text-ink",
          )}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}
