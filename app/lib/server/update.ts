import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The installed app updating itself. Its server runs from `<app data>/server` (src-tauri/src/server.rs);
 * scripts/update.mjs stages a newer release beside it in `<app data>/update`, and the app swaps that
 * in when it next quits or starts (src-tauri/src/update.rs). A Blueprint built from source has no
 * release.json, so it never looks.
 */

const MANIFEST = "https://github.com/jbw9/blueprint/releases/latest/download/latest.json";
const SERVER = process.cwd();

const versionIn = (dir: string) => {
  try {
    return (JSON.parse(readFileSync(join(dir, "release.json"), "utf8")) as { version?: string }).version ?? null;
  } catch {
    return null;
  }
};

/** This release's version; null for a build from source. */
export const VERSION = versionIn(SERVER);

const state = ((globalThis as { __blueprintUpdate?: { at: number; running: boolean } }).__blueprintUpdate ??= { at: 0, running: false });

/** Looks for a newer release, at most every 6 hours; `now` (the backend refused this version) within a minute. */
export function checkUpdate(now = false) {
  if (!VERSION || state.running || Date.now() - state.at < (now ? 60_000 : 6 * 3600_000)) return;
  state.at = Date.now();
  state.running = true;
  const p = spawn(process.execPath, [join(SERVER, "scripts", "update.mjs"), MANIFEST], { stdio: ["ignore", "ignore", "inherit"], windowsHide: true });
  const done = () => void (state.running = false);
  p.on("exit", done);
  p.on("error", done);
}

/** The version running, and the one staged to replace it at the next restart. */
export const updateStatus = () => ({ version: VERSION, ready: VERSION ? versionIn(join(dirname(SERVER), "update", "server")) : null });
