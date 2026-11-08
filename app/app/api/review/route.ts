import { loadBlueprint, rootOf } from "@/lib/server/blueprints";
import { reviewRange } from "@/lib/server/review";
import { blueprintReview, reviewBlueprint } from "@/lib/server/vault";
import { notJson } from "@/lib/server/route";

/**
 * The blueprint after a branch or pull request (lib/server/vault.ts `blueprintReview`):
 * `GET ?blueprint=&commit=` says whether it exists or is being made (only read, so
 * a commit is enough), `POST` with `{blueprint, review, claude}` starts making it.
 * As app/api/diff/route.ts, what is checked out is only ever the commit the
 * review spec itself resolves to.
 */
function resolved(blueprint: string | null, spec: string | null) {
  let open: ReturnType<typeof loadBlueprint> = null;
  try {
    open = loadBlueprint(blueprint ?? undefined);
  } catch {}
  if (!open || !spec) return { error: "No such blueprint or review." };
  const r = reviewRange(rootOf(open.file.RUN), spec);
  return "error" in r ? r : { id: open.name, commit: r.to };
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  let open: ReturnType<typeof loadBlueprint> = null;
  try {
    open = loadBlueprint(q.get("blueprint") ?? undefined);
  } catch {}
  return Response.json(open ? reviewBlueprint(open.name, q.get("commit") ?? "") : { status: "none" });
}

export async function POST(request: Request) {
  const refused = notJson(request);
  if (refused) return refused;
  const body = (await request.json().catch(() => ({}))) as { blueprint?: string; review?: string; claude?: string };
  const r = resolved(body.blueprint ?? null, body.review ?? null);
  if ("error" in r) return Response.json({ status: "failed", error: r.error });
  return Response.json(blueprintReview(r.id, r.commit, body.claude));
}
