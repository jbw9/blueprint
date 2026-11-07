import type { Edge, Node } from "@/lib/map/schema";

/** Levels below this node: 0 for a leaf. */
function height(node: Node): number {
  return node.children?.length ? 1 + Math.max(...node.children.map(height)) : 0;
}

/**
 * File paths only at the bottom of a branch — the level you are standing on
 * when there is nowhere further to go (D42). A path on a card answers a
 * question nobody has asked yet: you can open the part and be told then. The
 * code drawer still names every file on every level, and the open level's own
 * header still shows its footprint.
 */
export function nearBottom(node: Node) {
  return height(node) === 0;
}

export function authored(node: Node) {
  return (node.children ?? []).filter((c) => !c.fromRow);
}

/** Opening a card shows something: its children, or its own rows in full. */
export function openable(node: Node) {
  return authored(node).length > 0 || Boolean(node.anatomy?.length);
}

/**
 * The arrows between a node's children — only where the node declares a
 * sequence (D19, D21). A set gets nothing and says so via `setNote`.
 */
export function siblingEdges(node: Node, kids: Node[]): Edge[] {
  if (node.group?.ordering !== "sequence" || kids.length < 2) return [];
  if (node.edges?.length) return node.edges;
  return kids.slice(1).map((c, i) => ({
    from: kids[i].id,
    to: c.id,
    state: kids[i].state === "derived" && c.state === "derived" ? "derived" : "partial",
    order: i + 1,
  }));
}

/**
 * The line an unordered level says about itself. No `group` at all says
 * nothing: an unbacked claim about ordering is the same mistake as an unbacked
 * arrow, pointing the other way.
 */
export function setNote(node: Node): string | null {
  if (!node.group || node.group.ordering === "sequence") return null;
  return node.group.note ?? "No order between these — they are a set, not a flow.";
}
