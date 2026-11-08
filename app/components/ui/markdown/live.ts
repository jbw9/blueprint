import { syntaxTree } from "@codemirror/language";
import { EditorSelection, Facet, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType, keymap } from "@codemirror/view";

/**
 * Markdown drawn as the page it makes, in the text it is written in, the way
 * Obsidian's live preview does. Headings are set at their size, emphasis and
 * code take their look, links read as links, and images, rules and task
 * boxes are drawn; list bullets and numbers stay as written. The syntax
 * (`#`, `**`, `[`…`](url)`) is hidden on every line but the ones a caret or
 * selection is on, so what is being edited is always the Markdown itself.
 * Tables and raw HTML stay as written.
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
            if (n.node.parent?.name === "InlineCode" && !live(n.from)) out.push(hide.range(n.from, n.to));
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
      focus: (_e, view) => void setTimeout(() => view.dom.isConnected && view.dispatch({})),
      blur: (_e, view) => void setTimeout(() => view.dom.isConnected && view.dispatch({})),
    },
  },
);

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
  ".cm-activeLine": { backgroundColor: "transparent" },
  // A page has no gutter: no numbers, no fold marks.
  ".cm-gutters": { display: "none" },
});

/** The live preview: the decorations, the keys that write Markdown, and the page they are set on. */
export function livePreview(): Extension {
  return [plugin, page];
}
