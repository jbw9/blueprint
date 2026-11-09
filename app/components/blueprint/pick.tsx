"use client";

import { useBlueprint } from "@/components/blueprint/blueprint-context";
import { Menu } from "@/components/ui/menu";
import { openInTab } from "@/components/chrome/tabs";
import { mention, openClaude, section, sectionKey, type Target } from "@/lib/agent/context";
import { describeElement, type BuiltBlueprint } from "@/lib/blueprint/build";

export const PICKABLE = "[data-path], [data-row], [data-pick]";

/**
 * The level a clicked element leads to, if it leads anywhere but here, and the
 * element that leads there: a part's card (`data-path`), a step of the way
 * back (`data-opens-at`), or a diagram box, whose href is that part's own URL.
 */
export function opener(el: Element, here: string[]): { el: Element; at: string[] } | null {
  const link = el.closest("a[href]");
  const href = link?.getAttribute("href");
  if (link && href?.startsWith("?")) {
    const at = new URLSearchParams(href).getAll("at");
    return at.join("/") !== here.join("/") ? { el: link, at } : null;
  }
  const card = el.closest<HTMLElement | SVGElement>("[data-opens-at], [data-path]");
  const raw = card?.dataset.opensAt ?? card?.dataset.path;
  if (!card || !raw) return null;
  const at = JSON.parse(raw) as string[];
  return at.join("/") !== here.join("/") ? { el: card, at } : null;
}

export const opensAt = (el: Element, here: string[]) => opener(el, here)?.at ?? null;

/**
 * What a right-clicked element hands to Claude. An element's words are what
 * is on screen — `data-pick-text` where the screen leaves something out, like
 * a table row's column names — and its code is the nearest `data-pick-code`.
 */
export function targetOf(blueprint: BuiltBlueprint, el: HTMLElement | SVGElement, level: string[]): Target | null {
  const d = el.dataset;
  if (d.path !== undefined) {
    const at: string[] = JSON.parse(d.path);
    return at.length && !blueprint.nodeAt(at) ? null : section(blueprint, at);
  }
  const shown = ("innerText" in el ? el.innerText : (el.textContent ?? "")).trim();
  const label = (d.pick || shown.split("\n")[0] || "").trim().slice(0, 80);
  if (!label) return null;
  const id = d.row ?? d.pick ?? label;
  return {
    key: `${sectionKey(level)}#${id}`,
    title: label,
    text: describeElement(blueprint, level, label, d.pickText ?? shown, el.closest<HTMLElement>("[data-pick-code]")?.dataset.pickCode),
  };
}

export function PickMenu({
  x,
  y,
  target,
  opens,
  onClose,
}: {
  x: number;
  y: number;
  target: Target;
  /** The level the thing under the pointer opens, offered in a new tab. */
  opens: string[] | null;
  onClose: () => void;
}) {
  const { name } = useBlueprint();
  return (
    <Menu
      x={x}
      y={y}
      title={target.title}
      onClose={onClose}
      items={[
        ...(opens ? [{ label: "Open in new tab", onClick: () => openInTab(name, opens) }] : []),
        {
          label: "Add to Claude",
          onClick: () => {
            mention(target);
            openClaude();
          },
        },
      ]}
    />
  );
}
