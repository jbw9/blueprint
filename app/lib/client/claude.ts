import { invoke, isTauri } from "@tauri-apps/api/core";
import { readSettings } from "@/lib/settings";

/** Claude Code as the desktop app finds it (src-tauri/src/claude.rs): where Settings says, or on the PATH. Null when it is nowhere. */
export const findClaude = (configured = readSettings().claudePath) =>
  invoke<{ path: string } | null>("claude_detect", { configured: configured || null }).catch(() => null);

/** The Claude Code a model run on the server is to use; none outside the desktop app. */
export async function claudePath(): Promise<string | undefined> {
  if (!isTauri()) return undefined;
  const found = await findClaude();
  if (!found) throw new Error("Claude Code was not found. Set where it is in Settings.");
  return found.path;
}
