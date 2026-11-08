"use client";

import { useEffect, useRef } from "react";
import { basicSetup } from "codemirror";
import { indentWithTab } from "@codemirror/commands";
import { HighlightStyle, indentUnit, syntaxHighlighting, LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { Compartment, EditorState, type Extension, Prec, RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, keymap, lineNumbers } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { cn } from "@/lib/client/utils";

/**
 * Code you can type into where you read it: CodeMirror, with the file's own
 * grammar (loaded by its name, only when one is opened), and the editing a code
 * editor has — auto-indent, bracket matching and closing, folding, multiple
 * cursors, find and replace, completion from words in the file. Coloured with
 * the code pane's tokens, so the theme follows light and dark.
 *
 * Typing changes only the draft. Writing to disk is the caller's, on ⌘S or
 * its Save button — never on a keystroke, a blur or navigation.
 */

const v = (name: string) => `var(--color-${name})`;

export const colours = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: v("code-comment"), fontStyle: "italic" },
  { tag: [t.string, t.special(t.string), t.regexp, t.character, t.attributeValue], color: v("code-string") },
  { tag: [t.number, t.bool, t.null, t.atom], color: v("code-number") },
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier, t.self], color: v("code-keyword") },
  { tag: [t.typeName, t.className, t.namespace, t.tagName, t.standard(t.tagName)], color: v("code-type") },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: v("code-call") },
  { tag: [t.punctuation, t.operator, t.bracket, t.angleBracket, t.separator], color: v("code-punct") },
  { tag: [t.annotation, t.meta, t.attributeName, t.labelName], color: v("code-annotation") },
  { tag: [t.heading], color: v("code-keyword"), fontWeight: "600" },
  { tag: [t.link, t.url], color: v("code-call"), textDecoration: "underline" },
  { tag: [t.emphasis], fontStyle: "italic" },
  { tag: [t.strong], fontWeight: "600" },
  { tag: t.invalid, color: v("code-string") },
]);

export const look = EditorView.theme({
  "&": { flex: "1 1 auto", minHeight: "0", backgroundColor: v("code"), color: v("code-plain"), fontSize: "12.5px" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-mono), ui-monospace, monospace", lineHeight: "1.65", overflow: "auto" },
  ".cm-content": { padding: "8px 0", caretColor: v("ink") },
  ".cm-line": { padding: "0 16px 0 12px" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: v("ink") },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--color-accent) 25%, transparent)",
  },
  ".cm-gutters": { backgroundColor: v("code"), color: v("faint"), border: "none", borderRight: `1px solid ${v("border-gray")}` },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 12px", fontVariantNumeric: "tabular-nums" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--color-accent) 6%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: v("ink") },
  ".cm-lit": { backgroundColor: v("amber-surface") },
  ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
    backgroundColor: "color-mix(in srgb, var(--color-accent) 18%, transparent)",
    outline: `1px solid color-mix(in srgb, var(--color-accent) 45%, transparent)`,
  },
  ".cm-searchMatch": { backgroundColor: v("amber-surface"), outline: `1px solid ${v("amber-ink")}` },
  ".cm-foldPlaceholder": { backgroundColor: "transparent", border: `1px solid ${v("border-gray")}`, color: v("faint") },
  ".cm-panels": { backgroundColor: v("surface-container"), color: v("ink"), borderColor: v("border-gray") },
  ".cm-panel.cm-search": { padding: "6px 10px", fontSize: "11px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" },
  ".cm-panel.cm-search br": { flexBasis: "100%", height: 0 },
  ".cm-textfield": {
    margin: 0, padding: "3px 8px", font: "inherit", fontFamily: "var(--font-mono), ui-monospace, monospace",
    backgroundColor: v("surface"), color: v("ink"), border: `1px solid ${v("border-gray")}`, borderRadius: 0, outline: "none",
  },
  ".cm-textfield:focus": { borderColor: v("accent") },
  ".cm-button": {
    margin: 0, padding: "3px 10px", font: "inherit", backgroundImage: "none", backgroundColor: v("surface"),
    color: v("ink"), border: `1px solid ${v("border-gray")}`, borderRadius: 0, cursor: "pointer",
  },
  ".cm-button:hover": { borderColor: v("accent"), color: v("accent") },
  ".cm-panel.cm-search label": { display: "inline-flex", alignItems: "center", gap: "4px", margin: 0, color: v("faint"), fontSize: "11px" },
  ".cm-panel.cm-search input[type=checkbox]": { margin: 0, accentColor: v("accent") },
  ".cm-panel.cm-search [name=close]": { position: "static", marginLeft: "auto", fontSize: "16px", color: v("faint"), cursor: "pointer" },
  ".cm-tooltip": { backgroundColor: v("surface-container"), color: v("ink"), border: `1px solid ${v("border-gray")}` },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: v("accent"), color: v("on-accent") },
});

/** The main caret's line, as the file numbers it, and column, from 1. */
export function caretOf(s: EditorState, start = 1) {
  const head = s.selection.main.head;
  const line = s.doc.lineAt(head);
  return { line: start + line.number - 1, col: head - line.from + 1 };
}

// The line the view opened on, lit in amber like the blueprint's citations.
const litLine = (line: number | undefined) =>
  EditorView.decorations.compute(["doc"], (s) => {
    const b = new RangeSetBuilder<Decoration>();
    if (line && line >= 1 && line <= s.doc.lines) {
      const at = s.doc.line(line).from;
      b.add(at, at, Decoration.line({ class: "cm-lit" }));
    }
    return b.finish();
  });

export function CodeEditor({
  file,
  start,
  value,
  onChange,
  onSave,
  readOnly,
  lit,
  onCursor,
  extensions,
  language,
  className,
}: {
  file: string;
  /** The first line's number in the file. */
  start: number;
  value: string;
  onChange: (next: string) => void;
  onSave?: () => void;
  readOnly?: boolean;
  /** A line to light and bring into view, as the file numbers it. */
  lit?: number;
  /** Where the caret is, as the file numbers it, each time it moves. */
  onCursor?: (at: { line: number; col: number }) => void;
  /** More of CodeMirror, swapped in place when it changes (keep it memoized). */
  extensions?: Extension;
  /** The grammar, when the file's name is not the one to pick it by. */
  language?: Extension;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // Read through refs, so the editor is made once per file and never torn down
  // (losing its undo history and cursor) because a parent drew new callbacks.
  const handlers = useRef({ onChange, onSave, onCursor });
  useEffect(() => {
    handlers.current = { onChange, onSave, onCursor };
  });
  const lang = useRef(new Compartment());
  const editable = useRef(new Compartment());
  const lighting = useRef(new Compartment());
  const extra = useRef(new Compartment());

  useEffect(() => {
    const ed = new EditorView({
      parent: box.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          Prec.highest(keymap.of([{ key: "Mod-s", preventDefault: true, run: () => (handlers.current.onSave?.(), true) }])),
          lineNumbers({ formatNumber: (n) => String(start + n - 1) }),
          basicSetup,
          keymap.of([indentWithTab]),
          // Indent the way the file already does.
          indentUnit.of(/^\t/m.test(value) ? "\t" : "  "),
          EditorState.tabSize.of(4),
          syntaxHighlighting(colours),
          look,
          lang.current.of(language ?? []),
          extra.current.of(extensions ?? []),
          editable.current.of(EditorState.readOnly.of(Boolean(readOnly))),
          lighting.current.of(litLine(lit && lit - start + 1)),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) handlers.current.onChange(u.state.doc.toString());
            if (u.docChanged || u.selectionSet) handlers.current.onCursor?.(caretOf(u.state, start));
          }),
          EditorView.contentAttributes.of({ "aria-label": `Code of ${file}` }),
        ],
      }),
    });
    view.current = ed;
    let live = true;
    if (!language) void LanguageDescription.matchFilename(languages, file)
      ?.load()
      .then((support) => live && ed.dispatch({ effects: lang.current.reconfigure(support) }));
    return () => {
      live = false;
      ed.destroy();
      view.current = null;
    };
    // Made once per file; value, start and the rest are kept in step below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // A value changed from outside (reloaded from disk, a save that reformatted)
  // replaces the text; one that came from typing here is already in it.
  useEffect(() => {
    const ed = view.current;
    if (ed && ed.state.doc.toString() !== value) ed.dispatch({ changes: { from: 0, to: ed.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: extra.current.reconfigure(extensions ?? []) });
  }, [extensions]);

  useEffect(() => {
    view.current?.dispatch({ effects: editable.current.reconfigure(EditorState.readOnly.of(Boolean(readOnly))) });
  }, [readOnly]);

  useEffect(() => {
    const ed = view.current;
    if (!ed) return;
    const n = lit ? lit - start + 1 : 0;
    ed.dispatch({ effects: lighting.current.reconfigure(litLine(n)) });
    // Once, where the view opened; not again as the reader types. Scrolls this
    // box only: CodeMirror's scrollIntoView also scrolls the page, hiding the header above.
    if (n >= 1 && n <= ed.state.doc.lines) {
      const at = ed.state.doc.line(n).from;
      ed.requestMeasure({
        read: () => ed.lineBlockAt(at).top,
        write: (top) => (ed.scrollDOM.scrollTop = top - ed.scrollDOM.clientHeight / 2),
      });
    }
  }, [lit, start]);

  // A column, so the editor shrinks to a height the caller caps and scrolls
  // inside itself, where CodeMirror can see which lines are in view.
  return <div ref={box} className={cn("flex flex-col overflow-hidden bg-code", className)} />;
}
