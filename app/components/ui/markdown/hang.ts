import { StateEffect, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

/**
 * A list item or a quote that wraps carries on under its first word, not
 * under its bullet, number or `>`: a hanging indent, as a printed list has.
 *
 * The indent is measured, not counted in characters: in the live view the
 * marker is a drawn bullet or task box, or hidden, and the face is not
 * monospaced. The line is pushed right by that width with a transparent
 * left border (so a background still runs under it) and its first line pulled
 * back by the same with `text-indent`, so only the wrapped lines move.
 */

/** A line's marker: indentation, a bullet or number, a task box, quote marks. */
const MARKER = /^(\s*(?:>\s?)*(?:(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?)?)/;

const measured = StateEffect.define<Map<number, number>>();

const hangs = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet = Decoration.none;
    widths = new Map<number, number>();

    constructor(readonly view: EditorView) {
      this.measure();
    }

    update(u: ViewUpdate) {
      for (const t of u.transactions)
        for (const e of t.effects)
          if (e.is(measured)) {
            this.widths = e.value;
            this.decorations = this.build();
          }
      if (u.docChanged) {
        // Positions moved; the next measure puts the indents back where they belong.
        const doc = u.state.doc;
        this.widths = new Map(
          [...this.widths].flatMap(([at, w]): [number, number][] => {
            const to = u.changes.mapPos(at);
            return doc.lineAt(to).from === to ? [[to, w]] : [];
          }),
        );
        this.decorations = this.build();
      }
      // The selection matters too: in the live view it shows or hides a line's Markdown.
      if (u.docChanged || u.viewportChanged || u.geometryChanged || u.selectionSet || u.focusChanged) this.measure();
    }

    build() {
      const out: Range<Decoration>[] = [];
      for (const [at, w] of [...this.widths].sort((a, b) => a[0] - b[0]))
        if (w > 0.5) out.push(Decoration.line({ class: "cm-hang", attributes: { style: `--hang:${w.toFixed(1)}px` } }).range(at));
      return Decoration.set(out);
    }

    measure() {
      this.view.requestMeasure({
        key: this,
        read: (view) => {
          const next = new Map<number, number>();
          for (const { from, to } of view.visibleRanges) {
            for (let pos = from; pos <= to; ) {
              const line = view.state.doc.lineAt(pos);
              pos = line.to + 1;
              const marker = MARKER.exec(line.text)?.[1] ?? "";
              if (!marker || marker.length >= line.length) continue;
              const el = view.domAtPos(line.from).node;
              const lineEl = (el instanceof HTMLElement ? el : el.parentElement)?.closest(".cm-line");
              const text = view.coordsAtPos(line.from + marker.length, 1);
              if (!lineEl || !text) continue;
              const cs = getComputedStyle(lineEl);
              const start =
                lineEl.getBoundingClientRect().left +
                parseFloat(cs.borderLeftWidth) +
                parseFloat(cs.paddingLeft) +
                parseFloat(cs.textIndent);
              next.set(line.from, Math.max(0, text.left - start));
            }
          }
          return next;
        },
        write: (next, view) => {
          const same = next.size === this.widths.size && [...next].every(([at, w]) => Math.abs((this.widths.get(at) ?? -1) - w) < 0.5);
          // Not inside the measure: a new set of indents is its own update.
          if (!same) setTimeout(() => view.dom.isConnected && view.dispatch({ effects: measured.of(next) }));
        },
      });
    }
  },
  { decorations: (p) => p.decorations },
);

const look = EditorView.baseTheme({
  ".cm-line.cm-hang": {
    borderLeft: "var(--hang) solid transparent",
    textIndent: "calc(-1 * var(--hang))",
  },
});

export function hangingIndent() {
  return [hangs, look];
}
