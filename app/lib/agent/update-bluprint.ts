import { findClaude } from "@/lib/client/claude";

/**
 * A turn of Claude's the bluprint follows (src-tauri/src/claude.rs): its session's
 * transcript, for what it did and why, and the sections it reported wrong
 * with bluprint-fix.
 */
export interface Turn {
  transcript?: string | null;
  corrections: { section: string; note: string }[];
}

/**
 * Asks for the bluprint of the project at `root` to be brought up to its code
 * (lib/server/vault.ts): only the sections the edits touched, or the agent found
 * wrong, are redone, by the same Claude Code the tabs run. It runs only once
 * HEAD has moved past the last update, unless `force`d; until then a turn waits
 * for the next commit. With no turn it only looks at the code, and a bluprint
 * whose cited code is unchanged costs no model call (scripts/generate/update.ts).
 * `skipped` when the checkout is not one of the user's projects.
 */
export async function updateBluprint(root: string, turn?: Turn, force = false): Promise<{ skipped?: boolean } | null> {
  const found = await findClaude();
  return fetch("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "update", root, claude: found?.path, turn, force }),
  })
    .then((r) => r.json())
    .catch(() => null);
}
