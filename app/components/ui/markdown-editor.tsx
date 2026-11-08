"use client";

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { EditorView } from "@codemirror/view";
import { type ReactNode, useMemo, useRef } from "react";
import { CodeEditor } from "@/components/ui/editor";
import { hangingIndent } from "@/components/ui/markdown/hang";
import { formatKeys, imageSource, livePreview } from "@/components/ui/markdown/live";
import { cn } from "@/lib/client/utils";

/**
 * A Markdown file, written in one of three views:
 *
 *   live     the page as it reads, the Markdown showing only on the lines
 *            being edited (components/ui/markdown/live.ts)
 *   source   the Markdown as text, in the code editor's look
 *   split    the source beside the page drawn from it, scrolled together
 *
 * Each is the same CodeMirror document, so undo, find and multiple cursors
 * span the file, and ⌘B ⌘I ⌘K write the Markdown for bold, italic and a link.
 * Fenced code is coloured in its own language. As CodeEditor, typing changes
 * only the draft; ⌘S is the caller's save.
 */

export type MarkdownView = "live" | "source" | "split";

export const VIEWS: { id: MarkdownView; label: string; title: string }[] = [
  { id: "live", label: "Live", title: "The page, with the Markdown shown on the line you edit" },
  { id: "source", label: "Source", title: "The Markdown as text" },
  { id: "split", label: "Split", title: "The Markdown beside the page it draws" },
];

const grammar = markdown({ base: markdownLanguage, codeLanguages: languages });

export function MarkdownEditor({
  file,
  value,
  onChange,
  onSave,
  onCursor,
  readOnly,
  lit,
  view,
  image,
  preview,
  className,
}: {
  file: string;
  value: string;
  onChange: (next: string) => void;
  onSave?: () => void;
  onCursor?: (at: { line: number; col: number }) => void;
  readOnly?: boolean;
  /** A line to light and bring into view, as the file numbers it. */
  lit?: number;
  view: MarkdownView;
  /** How an image's `src` in the doc becomes a URL to load. */
  image?: (src: string) => Promise<string> | string;
  /** The page the Markdown draws, for the split view. */
  preview: (text: string) => ReactNode;
  className?: string;
}) {
  // Remade only when the view or the image source does (keep `image` memoized), never per keystroke.
  const extensions = useMemo(() => [EditorView.lineWrapping, hangingIndent(), formatKeys, image ? imageSource.of(image) : [], view === "live" ? livePreview() : []], [view, image]);

  const pane = useRef<HTMLDivElement>(null);
  // The page follows the source: the same fraction of the way down.
  const follow = (e: React.UIEvent) => {
    const from = e.target as HTMLElement;
    const to = pane.current;
    if (!to || !from.classList.contains("cm-scroller")) return;
    const f = from.scrollTop / Math.max(1, from.scrollHeight - from.clientHeight);
    to.scrollTop = f * (to.scrollHeight - to.clientHeight);
  };

  const editor = (
    <CodeEditor
      file={file}
      start={1}
      value={value}
      onChange={onChange}
      onSave={onSave}
      onCursor={onCursor}
      readOnly={readOnly}
      lit={lit}
      language={grammar}
      extensions={extensions}
      className="min-h-0 flex-1"
    />
  );

  // One shape for every view, so switching never remounts the editor and loses its undo.
  return (
    <div className={cn("flex min-h-0", className)}>
      <div className={cn("flex min-w-0 flex-1 flex-col", view === "split" && "border-r border-border-gray")} onScrollCapture={follow}>
        {editor}
      </div>
      {view === "split" ? (
        <div ref={pane} className="min-w-0 flex-1 overflow-auto bg-code">
          <div className="doc-prose pb-[40vh] pl-14 pr-8 pt-8">{preview(value)}</div>
        </div>
      ) : null}
    </div>
  );
}
