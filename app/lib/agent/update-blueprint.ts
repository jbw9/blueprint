import { findClaude } from "@/lib/client/claude";

/**
 * A turn of Claude's the blueprint follows (src-tauri/src/claude.rs): its session's
 * transcript, for what it did and why, and the sections it reported wrong
 * with blueprint-fix.
 */
export interface Turn {
  transcript?: string | null;
  corrections: { section: string; note: string }[];
}

/**
 * Asks for the blueprint of the project at `root` to be brought up to its code
 * (lib/server/vault.ts): only the sections the edits touched, or the agent found
 * wrong, are redone, by the same Claude Code the tabs run. It runs only once
 * HEAD has moved past the last update, unless `force`d; until then a turn waits
 * for the next commit. With no turn it only looks at the code, and a blueprint
 * whose cited code is unchanged costs no model call (scripts/generate/update.ts).
 * `opened`: asked by opening the blueprint, not by anyone, so it runs gently and
 * leaves one far behind alone. `skipped` when the checkout is not one of the
 * user's projects.
 */
export async function updateBlueprint(root: string, turn?: Turn, force = false, opened = false): Promise<{ skipped?: boolean } | null> {
  const found = await findClaude();
  return fetch("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "update", root, claude: found?.path, turn, force, ...(opened ? { opened: true } : {}) }),
  })
    .then((r) => r.json())
    .catch(() => null);
}
