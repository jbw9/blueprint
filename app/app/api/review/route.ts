import { loadBluprint, rootOf } from "@/lib/server/bluprints";
import { reviewRange } from "@/lib/server/review";
import { bluprintReview, reviewBluprint } from "@/lib/server/vault";
import { notJson } from "@/lib/server/route";

/**
 * The bluprint after a branch or pull request (lib/server/vault.ts `bluprintReview`):
 * `GET ?bluprint=&commit=` says whether it exists or is being made (only read, so
 * a commit is enough), `POST` with `{bluprint, review, claude}` starts making it.
 * As app/api/diff/route.ts, what is checked out is only ever the commit the
 * review spec itself resolves to.
 */
function resolved(bluprint: string | null, spec: string | null) {
  let open: ReturnType<typeof loadBluprint> = null;
  try {
    open = loadBluprint(bluprint ?? undefined);
  } catch {}
  if (!open || !spec) return { error: "No such blueprint or review." };
  const r = reviewRange(rootOf(open.file.RUN), spec);
  return "error" in r ? r : { id: open.name, commit: r.to };
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  let open: ReturnType<typeof loadBluprint> = null;
  try {
    open = loadBluprint(q.get("bluprint") ?? undefined);
  } catch {}
  return Response.json(open ? reviewBluprint(open.name, q.get("commit") ?? "") : { status: "none" });
}

export async function POST(request: Request) {
  const refused = notJson(request);
  if (refused) return refused;
  const body = (await request.json().catch(() => ({}))) as { bluprint?: string; review?: string; claude?: string };
  const r = resolved(body.bluprint ?? null, body.review ?? null);
  if ("error" in r) return Response.json({ status: "failed", error: r.error });
  return Response.json(bluprintReview(r.id, r.commit, body.claude));
}
