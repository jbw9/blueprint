"use client";

import { mount, parse } from "pele";
import { useEffect, useMemo, useRef } from "react";

/**
 * A ```mermaid fence in a Markdown file, drawn as the picture it describes.
 *
 * A diagram in a doc is only a picture: nothing on it opens a section or
 * marks a change, so it is drawn by pele (https://pele.run) rather than the
 * blueprint's own diagram components (components/blueprint/blocks.tsx), which
 * are kept for what can be clicked through. Pele's colours and fonts are the
 * blueprint's, set as `--pele-*` on `.pele-frame` in app/globals.css, so it
 * reads as the same hand in light and dark.
 *
 * A fence pele cannot read is shown as written, never as an empty space.
 */
export function Mermaid({ source }: { source: string }) {
  const host = useRef<HTMLDivElement>(null);
  const readable = useMemo(() => {
    try {
      parse(source);
      return true;
    } catch {
      return false;
    }
  }, [source]);
  useEffect(() => {
    const el = host.current;
    if (!el || !readable) return;
    const m = mount(el, source);
    return () => m.destroy();
  }, [source, readable]);
  return readable ? <div ref={host} className="pele-frame" /> : <pre>{source}</pre>;
}

/** The text of a fence react-markdown hands its `pre`, when the fence is ```mermaid. */
export function mermaidOf(children: React.ReactNode): string | null {
  const code = Array.isArray(children) ? children[0] : children;
  if (!code || typeof code !== "object" || !("props" in code)) return null;
  const props = code.props as { className?: string; children?: React.ReactNode };
  if (!/\blanguage-mermaid\b/.test(props.className ?? "")) return null;
  const text = Array.isArray(props.children) ? props.children.join("") : props.children;
  return typeof text === "string" ? text.replace(/\n$/, "") : null;
}
