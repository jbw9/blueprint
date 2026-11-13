import { loadBlueprint, rootOf } from "@/lib/server/blueprints";
import { closeIssue, issue, issues, reopenIssue } from "@/lib/server/issues";
import { bad, notJson } from "@/lib/server/route";

/**
 * The GitHub issues of a blueprint's checkout.
 *
 * `GET ?blueprint=&state=open|closed` lists them; `GET ?blueprint=&n=<number>` is one in full,
 * with the text Claude is given for it. The checkout is resolved from the
 * blueprint, as app/api/diff/route.ts does: a caller names a blueprint, never
 * a path, and `n` reaches `gh` only as a number.
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  let open;
  try {
    open = loadBlueprint(q.get("blueprint") ?? undefined);
  } catch {
    open = null;
  }
  if (!open) return bad("No such blueprint.", 404);
  const root = rootOf(open.file.RUN);
  const n = q.get("n");
  if (n === null) return Response.json(issues(root, q.get("state") === "closed" ? "closed" : "open"));
  if (!/^\d{1,7}$/.test(n)) return bad("An issue is named by its number.");
  const one = issue(root, Number(n));
  return "error" in one ? bad(one.error) : Response.json(one);
}

/** `POST { blueprint, n, reason }` closes issue `n` as "completed" or "not planned"; `POST { blueprint, n, reopen: true }` opens it again. */
export async function POST(request: Request) {
  const refused = notJson(request);
  if (refused) return refused;
  const body = (await request.json().catch(() => null)) as { blueprint?: string; n?: unknown; reason?: unknown; reopen?: unknown } | null;
  let open;
  try {
    open = loadBlueprint(body?.blueprint);
  } catch {
    open = null;
  }
  if (!open) return bad("No such blueprint.", 404);
  if (typeof body?.n !== "number" || !Number.isInteger(body.n) || body.n < 1) return bad("An issue is named by its number.");
  const root = rootOf(open.file.RUN);
  if (body.reopen === true) {
    const error = reopenIssue(root, body.n);
    return error ? bad(error) : Response.json({ reopened: body.n });
  }
  if (body.reason !== "completed" && body.reason !== "not planned") return bad("An issue closes as completed or not planned.");
  const error = closeIssue(root, body.n, body.reason);
  return error ? bad(error) : Response.json({ closed: body.n });
}
