import { syntaxTree } from "@codemirror/language";
import { EditorSelection, Facet, StateEffect, StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType, keymap } from "@codemirror/view";

/**
 * Markdown drawn as the page it makes, in the text it is written in, the way
 * Obsidian's live preview does. Headings are set at their size, emphasis and
 * code take their look, links read as links, and images, rules and task
 * boxes are drawn, and so are tables, as tables; list bullets and numbers
 * stay as written. The syntax (`#`, `**`, `[`…`](url)`, a code fence's
 * backticks) is hidden on every line but the ones a caret or selection is on,
 * so what is being edited is always the Markdown itself. A table is drawn
 * until the caret enters it, then shown whole as written. Raw HTML stays as
 * written.
 *
 * Only decorations: the document is the file's text, untouched, so undo, find,
 * multiple cursors and the clipboard all work on the Markdown.
 */

/** How an image's `src` becomes a URL the page can load: a file beside the doc read off disk, a web one as it is. */
export const imageSource = Facet.define<(src: string) => Promise<string> | string, (src: string) => Promise<string> | string>({
  combine: (all) => all[0] ?? ((s) => s),
});

class Hidden extends WidgetType {
  toDOM() {
    return document.createElement("span");
  }
}
const hide = Decoration.replace({ widget: new Hidden() });

class Rule extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-md-rule";
    return s;
  }
}

class Task extends WidgetType {
  constructor(readonly done: boolean) {
    super();
  }
  eq(o: Task) {
    return o.done === this.done;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = this.done;
    box.className = "cm-md-task";
    // Ticking the box ticks the text: `[ ]` ⇄ `[x]`.
    box.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const at = view.posAtDOM(box);
      const mark = view.state.sliceDoc(at, at + 3);
      if (!/^\[[ xX]\]$/.test(mark)) return;
      view.dispatch({ changes: { from: at + 1, to: at + 2, insert: this.done ? " " : "x" } });
    });
    return box;
  }
  ignoreEvent() {
    return false;
  }
}

class Image extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
  ) {
    super();
  }
  eq(o: Image) {
    return o.src === this.src && o.alt === this.alt;
  }
  toDOM(view: EditorView) {
    const img = document.createElement("img");
    img.className = "cm-md-image";
    img.alt = this.alt;
    const url = view.state.facet(imageSource)(this.src);
    if (typeof url === "string") img.src = url;
    else void url.then((u) => (img.src = u), () => {});
    // An image arriving changes the line's height; CodeMirror has to measure it again.
    img.addEventListener("load", () => view.requestMeasure());
    return img;
  }
}

/** Whether any line from `from` to `to` is one being edited. */
const touches = (on: Set<number>, doc: EditorState["doc"], from: number, to: number) => {
  for (let n = doc.lineAt(from).number, end = doc.lineAt(to).number; n <= end; n++) if (on.has(n)) return true;
  return false;
};

/** Lines a caret or a selection touches: there the Markdown is shown as written. */
function activeLines(state: EditorState) {
  const on = new Set<number>();
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number;
    const b = state.doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) on.add(n);
  }
  return on;
}

function build(view: EditorView, focused: boolean): DecorationSet {
  const { state } = view;
  const doc = state.doc;
  // Unfocused, nothing is being edited: every line is drawn.
  const on = focused ? activeLines(state) : new Set<number>();
  const live = (pos: number) => on.has(doc.lineAt(pos).number);
  const out: Range<Decoration>[] = [];
  const lineClass = (from: number, to: number, cls: string) => {
    for (let n = doc.lineAt(from).number, end = doc.lineAt(to).number; n <= end; n++) out.push(Decoration.line({ class: cls }).range(doc.line(n).from));
  };

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (n) => {
        const name = n.name;
        const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(name);
        if (heading) {
          lineClass(n.from, n.to, `cm-md-h cm-md-h${heading[1]}`);
          return;
        }
        switch (name) {
          case "HeaderMark": {
            if (live(n.from)) return;
            // `## ` — the space after the marks goes with them.
            const end = doc.sliceString(n.to, n.to + 1) === " " ? n.to + 1 : n.to;
            if (doc.lineAt(n.from).text.trim().length > end - n.from) out.push(hide.range(n.from, end));
            return;
          }
          case "EmphasisMark":
          case "StrikethroughMark":
          case "LinkMark":
          case "QuoteMark":
            if (live(n.from)) return;
            // A link's `[` `]` `(` `)` go; `![` of an image is the image's own.
            if (name === "LinkMark" && n.node.parent?.name === "Image") return;
            out.push(hide.range(n.from, name === "QuoteMark" && doc.sliceString(n.to, n.to + 1) === " " ? n.to + 1 : n.to));
            return;
          case "CodeMark":
          case "CodeInfo":
            if (!live(n.from)) out.push(hide.range(n.from, n.to));
            return;
          case "Table":
            // Drawn whole by the tables field below, unless it is being edited.
            if (!touches(on, doc, n.from, n.to)) return false;
            return;
          case "InlineCode":
            out.push(Decoration.mark({ class: "cm-md-code" }).range(n.from, n.to));
            return;
          case "Strikethrough":
            out.push(Decoration.mark({ class: "cm-md-strike" }).range(n.from, n.to));
            return;
          case "URL":
          case "LinkTitle":
            if (n.node.parent?.name === "Link" && !live(n.from)) out.push(hide.range(n.from, n.to));
            return;
          case "Link":
            out.push(Decoration.mark({ class: "cm-md-link" }).range(n.from, n.to));
            return;
          case "Image": {
            if (live(n.from)) return;
            const text = doc.sliceString(n.from, n.to);
            const m = /^!\[([^\]]*)\]\(\s*<?([^\s>)]+)>?/.exec(text);
            if (!m) return;
            out.push(Decoration.replace({ widget: new Image(m[2], m[1]) }).range(n.from, n.to));
            return false;
          }
          case "Blockquote":
            lineClass(n.from, n.to, "cm-md-quote");
            return;
          case "FencedCode":
          case "CodeBlock":
            lineClass(n.from, n.to, "cm-md-fence");
            return;
          case "HorizontalRule":
            if (!live(n.from)) out.push(Decoration.replace({ widget: new Rule() }).range(n.from, n.to));
            return;
          case "ListMark":
            // Bullets and numbers stay as written, dimmed, on every line.
            out.push(Decoration.mark({ class: "cm-md-listmark" }).range(n.from, n.to));
            return;
          case "TaskMarker": {
            if (live(n.from)) return;
            const done = /x/i.test(doc.sliceString(n.from, n.to));
            out.push(Decoration.replace({ widget: new Task(done) }).range(n.from, n.to));
            if (done) {
              const line = doc.lineAt(n.from);
              if (n.to + 1 < line.to) out.push(Decoration.mark({ class: "cm-md-done" }).range(n.to + 1, line.to));
            }
            return;
          }
        }
      },
    });
  }
  return Decoration.set(out, true);
}

/**
 * The caret is in the text. Not `view.hasFocus`, which also asks that the
 * window be in front: switching to another app would draw the line being
 * edited back into its page under the caret.
 */
const editing = (view: EditorView) => view.root.activeElement === view.contentDOM;

const plugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    was: boolean;
    constructor(view: EditorView) {
      this.was = editing(view);
      this.decorations = build(view, this.was);
    }
    update(u: ViewUpdate) {
      const now = editing(u.view);
      if (now !== this.was || u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.startState) !== syntaxTree(u.state))
        this.decorations = build(u.view, now);
      this.was = now;
    }
  },
  {
    decorations: (p) => p.decorations,
    // Focus moving in or out redraws, through an empty update, once the DOM has it.
    eventHandlers: {
      focus: (_e, view) => void setTimeout(() => view.dom.isConnected && view.dispatch({ effects: focusSet.of(editing(view)) })),
      blur: (_e, view) => void setTimeout(() => view.dom.isConnected && view.dispatch({ effects: focusSet.of(editing(view)) })),
    },
  },
);

/* ── tables ────────────────────────────────────────────────── */

type SyntaxNode = ReturnType<typeof syntaxTree>["topNode"];

/** A cell's text with its formatting, as the parser read it. */
type Inline = string | { tag: string; cls?: string; kids: Inline[] };

const TAG: Record<string, { tag: string; cls?: string }> = {
  Emphasis: { tag: "em" },
  StrongEmphasis: { tag: "strong" },
  InlineCode: { tag: "code", cls: "cm-md-code" },
  Strikethrough: { tag: "s" },
  Link: { tag: "span", cls: "cm-md-link" },
};
const MARKS = new Set(["EmphasisMark", "CodeMark", "LinkMark", "URL", "LinkTitle", "StrikethroughMark"]);

function entity(text: string) {
  // A textarea decodes `&mdash;` and runs nothing.
  const t = document.createElement("textarea");
  t.innerHTML = text;
  return t.value;
}

function inline(state: EditorState, node: SyntaxNode): Inline[] {
  const out: Inline[] = [];
  let pos = node.from;
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.from > pos) out.push(state.sliceDoc(pos, c.from));
    pos = c.to;
    const tag = TAG[c.name];
    if (MARKS.has(c.name)) continue;
    if (c.name === "Escape") out.push(state.sliceDoc(c.from + 1, c.to));
    else if (c.name === "Entity") out.push(entity(state.sliceDoc(c.from, c.to)));
    else if (tag) out.push({ ...tag, kids: inline(state, c) });
    else out.push(state.sliceDoc(c.from, c.to));
  }
  if (pos < node.to) out.push(state.sliceDoc(pos, node.to));
  return out;
}

/** A row's cells, empty ones kept: each sits between two of the row's `|`, the outer ones optional. */
function cellsOf(state: EditorState, row: SyntaxNode): Inline[][] {
  const cells: Inline[][] = [];
  let cur: SyntaxNode | null = null;
  let begun = false;
  for (let c = row.firstChild; c; c = c.nextSibling) {
    if (c.name === "TableDelimiter") {
      if (begun) cells.push(cur ? inline(state, cur) : []);
      cur = null;
      begun = true;
    } else if (c.name === "TableCell") {
      cur = c;
      begun = true;
    }
  }
  if (cur) cells.push(inline(state, cur));
  return cells;
}

class Table extends WidgetType {
  constructor(
    readonly source: string,
    readonly align: string[],
    readonly rows: Inline[][][],
  ) {
    super();
  }
  eq(o: Table) {
    return o.source === this.source;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-md-table-wrap";
    const table = wrap.appendChild(document.createElement("table"));
    table.className = "cm-md-table";
    const draw = (into: HTMLElement, parts: Inline[]) => {
      for (const p of parts) {
        if (typeof p === "string") into.append(p);
        else {
          const el = into.appendChild(document.createElement(p.tag));
          if (p.cls) el.className = p.cls;
          draw(el, p.kids);
        }
      }
    };
    const width = Math.max(this.align.length, ...this.rows.map((r) => r.length));
    this.rows.forEach((row, i) => {
      const tr = table.appendChild(document.createElement(i ? "tbody" : "thead")).appendChild(document.createElement("tr"));
      for (let k = 0; k < width; k++) {
        const cell = tr.appendChild(document.createElement(i ? "td" : "th"));
        if (this.align[k]) cell.style.textAlign = this.align[k];
        draw(cell, row[k] ?? []);
      }
    });
    // A click puts the caret in the table, which shows it as written to edit.
    wrap.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: view.posAtDOM(wrap) } });
      view.focus();
    });
    return wrap;
  }
  ignoreEvent() {
    return false;
  }
}

const alignOf = (cell: string) => {
  const c = cell.trim();
  return c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : "";
};

function drawTables(state: EditorState, focused: boolean): DecorationSet {
  const on = focused ? activeLines(state) : new Set<number>();
  const out: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter: (n) => {
      if (n.name === "Paragraph" || /Heading|Code|HTML/.test(n.name)) return false;
      if (n.name !== "Table") return;
      // Only one that starts its line can stand in for its lines.
      if (state.doc.lineAt(n.from).from !== n.from || touches(on, state.doc, n.from, n.to)) return false;
      let align: string[] = [];
      const rows: Inline[][][] = [];
      for (let c = n.node.firstChild; c; c = c.nextSibling) {
        if (c.name === "TableHeader" || c.name === "TableRow") rows.push(cellsOf(state, c));
        else if (c.name === "TableDelimiter") align = state.sliceDoc(c.from, c.to).replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map(alignOf);
      }
      out.push(Decoration.replace({ widget: new Table(state.sliceDoc(n.from, n.to), align, rows), block: true }).range(n.from, n.to));
      return false;
    },
  });
  return Decoration.set(out);
}

/** Whether the caret is in the text, as the view last said: a field cannot ask the view. */
const focusSet = StateEffect.define<boolean>();

/** Tables span lines, which only a field, not a view plugin, may replace. */
const tables = StateField.define<{ focused: boolean; deco: DecorationSet }>({
  create: (state) => ({ focused: false, deco: drawTables(state, false) }),
  update(v, tr) {
    let focused = v.focused;
    for (const e of tr.effects) if (e.is(focusSet)) focused = e.value;
    if (focused === v.focused && !tr.docChanged && !tr.selection && syntaxTree(tr.startState) === syntaxTree(tr.state)) return v;
    return { focused, deco: drawTables(tr.state, focused) };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

/* ── formatting keys ───────────────────────────────────────── */

/** Wraps each selection in `mark`, or unwraps it if it already is. */
function wrap(mark: string) {
  return (view: EditorView) => {
    const { state } = view;
    const n = mark.length;
    view.dispatch(
      state.changeByRange((r) => {
        const before = state.sliceDoc(r.from - n, r.from);
        const after = state.sliceDoc(r.to, r.to + n);
        if (before === mark && after === mark)
          return {
            changes: [
              { from: r.from - n, to: r.from },
              { from: r.to, to: r.to + n },
            ],
            range: EditorSelection.range(r.from - n, r.to - n),
          };
        return {
          changes: [
            { from: r.from, insert: mark },
            { from: r.to, insert: mark },
          ],
          range: EditorSelection.range(r.from + n, r.to + n),
        };
      }),
      { userEvent: "input.format" },
    );
    return true;
  };
}

/** `[selection](url)`, with `url` selected to type over. */
function link(view: EditorView) {
  const { state } = view;
  view.dispatch(
    state.changeByRange((r) => {
      const text = state.sliceDoc(r.from, r.to);
      const insert = `[${text}](url)`;
      const at = r.from + text.length + 3;
      return { changes: { from: r.from, to: r.to, insert }, range: EditorSelection.range(at, at + 3) };
    }),
    { userEvent: "input.format" },
  );
  return true;
}

export const formatKeys = keymap.of([
  { key: "Mod-b", run: wrap("**") },
  { key: "Mod-i", run: wrap("*") },
  { key: "Mod-Shift-x", run: wrap("~~") },
  { key: "Mod-e", run: wrap("`") },
  { key: "Mod-k", run: link },
]);

/* ── the look ──────────────────────────────────────────────── */

const v = (name: string) => `var(--color-${name})`;

/** The page: set in the reading face, from the left edge, as wide as the pane. */
const page = EditorView.theme({
  ".cm-scroller": { fontFamily: "var(--font-sans), ui-sans-serif, system-ui, sans-serif", lineHeight: "1.7" },
  ".cm-content": { padding: "40px 0 40vh", fontSize: "15px", color: v("on-surface-variant") },
  ".cm-line": { padding: "0 32px 0 56px" },
  ".cm-md-h": { color: v("ink"), fontWeight: "600", lineHeight: "1.3" },
  ".cm-md-h1, .cm-md-h2": { fontFamily: "var(--font-display), Georgia, serif", fontWeight: "400", letterSpacing: "-0.016em" },
  ".cm-md-h1": { fontSize: "34px", paddingTop: "0.6em", paddingBottom: "0.2em" },
  ".cm-md-h2": { fontSize: "25px", paddingTop: "0.8em", paddingBottom: "0.15em" },
  ".cm-md-h3": { fontSize: "18px", paddingTop: "0.6em" },
  ".cm-md-h4, .cm-md-h5, .cm-md-h6": { fontSize: "15.5px", paddingTop: "0.4em" },
  // Heading tokens keep their size; the highlighter's own colour gives way to the heading's.
  ".cm-md-h *": { color: "inherit", fontWeight: "inherit" },
  ".cm-md-code": { fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "0.88em", backgroundColor: v("surface-container"), padding: "1px 4px", borderRadius: "3px" },
  ".cm-md-fence": { fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "13px", backgroundColor: v("surface-container") },
  ".cm-md-quote": {
    color: v("muted-slate"),
    background: `linear-gradient(${v("border-gray")}, ${v("border-gray")}) 56px 0 / 3px 100% no-repeat`,
    paddingLeft: "72px !important",
  },
  ".cm-md-link, .cm-md-link *": { color: v("accent"), textDecoration: "none" },
  ".cm-md-strike": { textDecoration: "line-through" },
  ".cm-md-done": { color: v("faint"), textDecoration: "line-through" },
  ".cm-md-listmark": { color: v("faint") },
  ".cm-md-task": { margin: "0 6px 0 0", verticalAlign: "-2px", cursor: "pointer", accentColor: v("accent") },
  ".cm-md-rule": { display: "inline-block", width: "100%", verticalAlign: "middle", borderTop: `1px solid ${v("border-gray")}` },
  ".cm-md-image": { maxWidth: "100%", display: "inline-block", verticalAlign: "bottom" },
  ".cm-md-table-wrap": { padding: "8px 32px 8px 56px", overflowX: "auto", cursor: "text" },
  ".cm-md-table": { borderCollapse: "collapse", fontSize: "14px", lineHeight: "1.5" },
  ".cm-md-table th, .cm-md-table td": { border: `1px solid ${v("border-gray")}`, padding: "5px 12px", verticalAlign: "top" },
  ".cm-md-table th": { color: v("ink"), fontWeight: "600", backgroundColor: v("surface-container"), textAlign: "left" },
  ".cm-activeLine": { backgroundColor: "transparent" },
  // A page has no gutter: no numbers, no fold marks.
  ".cm-gutters": { display: "none" },
});

/** The live preview: the decorations, the keys that write Markdown, and the page they are set on. */
export function livePreview(): Extension {
  return [plugin, tables, page];
}
