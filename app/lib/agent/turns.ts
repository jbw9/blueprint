import { updateBlueprint, type Turn } from "@/lib/agent/update-blueprint";

/** The checkout each Claude tab is mid-turn in, by pty: that turn's end updates the blueprint with its transcript. */
export const midTurn = new Map<number, string>();

/** Whether Claude is mid-turn in `root`, so an update started now would race the one its turn will ask for. */
export function claudeMidTurnIn(root: string) {
  return [...midTurn.values()].some((cwd) => cwd === root || cwd.startsWith(`${root}/`) || cwd.startsWith(`${root}\\`));
}

/** Asks for the blueprint to follow a turn that edited `root` (on the next commit, unless `force`d); a checkout no project blueprints is said so in the title bar. */
export async function followTurn(root: string, turn: Turn, force = false) {
  const res = await updateBlueprint(root, turn, force);
  // Not one of the user's projects: the title bar says so, and offers to import it.
  if (res?.skipped) window.dispatchEvent(new CustomEvent(UNFOLLOWED, { detail: root }));
}

/** An agent edited a checkout whose blueprint cannot follow it; the detail is the checkout. */
export const UNFOLLOWED = "blueprint:blueprint-unfollowed";
