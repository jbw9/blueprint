import { updateMap, type Turn } from "@/lib/agent/update-map";

/** The checkout each Claude tab is mid-turn in, by pty: that turn's end updates the map with its transcript. */
export const midTurn = new Map<number, string>();

/** Whether Claude is mid-turn in `root`, so an update started now would race the one its turn will ask for. */
export function claudeMidTurnIn(root: string) {
  return [...midTurn.values()].some((cwd) => cwd === root || cwd.startsWith(`${root}/`) || cwd.startsWith(`${root}\\`));
}

/** Asks for the map to follow a turn that edited `root`; a checkout no project maps is said so in the title bar. */
export async function followTurn(root: string, turn: Turn) {
  const res = await updateMap(root, turn);
  // Not one of the user's projects: the title bar says so, and offers to import it.
  if (res?.skipped) window.dispatchEvent(new CustomEvent(UNFOLLOWED, { detail: root }));
}

/** An agent edited a checkout whose map cannot follow it; the detail is the checkout. */
export const UNFOLLOWED = "slop:map-unfollowed";
