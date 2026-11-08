import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadBlueprint, rootOf } from "@/lib/server/blueprints";
import { restoreFiles } from "@/lib/server/repo";
import { projectDir } from "@/lib/server/vault";
import { notJson } from "@/lib/server/route";

/**
 * Undoes one agent turn's edits: `POST {blueprint, turn}`, `turn` an id from the
 * blueprint's changes.json or `latest`. Every file goes back to what it was before
 * the turn, from the snapshot the updater kept (scripts/generate/update.ts),
 * unless any has changed since the turn, which refuses the whole undo
 * (lib/server/repo.ts restoreFiles). The checkout is the blueprint's, as app/api/diff does;
 * a caller names a turn, never a path.
 */
export async function POST(request: Request) {
  const refused = notJson(request);
  if (refused) return refused;
  const body = (await request.json().catch(() => null)) as { blueprint?: string; turn?: string } | null;
  let open: ReturnType<typeof loadBlueprint> = null;
  try {
    open = loadBlueprint(body?.blueprint ?? undefined);
  } catch {}
  if (!open || typeof body?.turn !== "string") return Response.json({ error: "No such blueprint or turn." }, { status: 400 });
  const dir = projectDir(open.name);
  const log = existsSync(join(dir, "changes.json")) ? (JSON.parse(readFileSync(join(dir, "changes.json"), "utf8")) as { id: string; prompt: string }[]) : [];
  const turn = body.turn;
  const entry = turn === "latest" ? log.at(-1) : /^[\w-]{1,64}$/.test(turn) ? log.find((c) => c.id === turn) : undefined;
  const file = entry && join(dir, "snapshots", `${entry.id}.json`);
  if (!file || !existsSync(file)) return Response.json({ error: "That turn's before-and-after is no longer kept." }, { status: 404 });
  const snap = JSON.parse(readFileSync(file, "utf8")) as { files: { path: string; before: string | null; after: string | null }[] };
  const root = rootOf(open.file.RUN);
  const result = await restoreFiles(root, snap.files);
  return Response.json({ ...result, root, prompt: entry.prompt }, { status: result.ok ? 200 : 409 });
}
