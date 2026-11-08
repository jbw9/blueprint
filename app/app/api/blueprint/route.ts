import { liveBlueprint, blueprintVersion } from "@/lib/server/blueprints";

/**
 * The open blueprint, followed while something rewrites it: the generator adding
 * each root as it is accepted, or an update redoing the sections an agent's
 * edits touched. The page polls with the version it has (`since`) and gets
 * only that version back until the files change, so a poll costs two stats;
 * the blueprint itself crosses only when there is a new one. Only the reader's own
 * projects: `id` arrives from the page, and lib/server/blueprints.ts reads nothing that is
 * not listed.
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const id = q.get("id");
  if (!id) return Response.json({ error: "bad request" }, { status: 400 });
  const version = blueprintVersion(id);
  if (!version) return Response.json(null);
  if (q.get("since") === version) return Response.json({ version });
  try {
    return Response.json(liveBlueprint(id));
  } catch {
    // Unreadable for a moment: the page keeps what it has and asks again.
    return Response.json({ version: q.get("since") });
  }
}
