import { cachedTimeline, storyOf } from "@/lib/server/history";
import { loadBluprint, rootOf } from "@/lib/server/bluprints";
import { projectDir, tellStory, telling } from "@/lib/server/vault";
import { notJson } from "@/lib/server/route";

/**
 * The history of the bluprint the reader has open (lib/server/history.ts).
 *
 * `GET ?bluprint=` — the timeline, the chapters a story run wrote (if any), and
 * whether one is running. `POST ?bluprint=` with `{claude}` — start telling the
 * story; it costs a model run, so only ever on the reader's click.
 *
 * As app/api/diff/route.ts: a caller names a bluprint, never a path, and the
 * checkout is the project's own.
 */

function opened(request: Request) {
  try {
    return loadBluprint(new URL(request.url).searchParams.get("bluprint") ?? undefined);
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const open = opened(request);
  if (!open) return Response.json({ error: "No such blueprint." }, { status: 404 });
  const dir = projectDir(open.name);
  try {
    const timeline = cachedTimeline(rootOf(open.file.RUN), dir, open.file);
    return Response.json({ timeline, story: storyOf(dir), telling: telling(open.name) });
  } catch {
    return Response.json({ error: "Could not read the checkout's history." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const refused = notJson(request);
  if (refused) return refused;
  const open = opened(request);
  if (!open) return Response.json({ error: "No such blueprint." }, { status: 404 });
  const { claude } = (await request.json().catch(() => ({}))) as { claude?: unknown };
  const started = tellStory(open.name, typeof claude === "string" && claude ? claude : undefined);
  return Response.json({ telling: started || telling(open.name) });
}
