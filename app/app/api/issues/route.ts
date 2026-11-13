import { loadBlueprint, rootOf } from "@/lib/server/blueprints";
import { issue, issues } from "@/lib/server/issues";
import { bad } from "@/lib/server/route";

/**
 * The open GitHub issues of a blueprint's checkout.
 *
 * `GET ?blueprint=` lists them; `GET ?blueprint=&n=<number>` is one in full,
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
  if (n === null) return Response.json(issues(root));
  if (!/^\d{1,7}$/.test(n)) return bad("An issue is named by its number.");
  const one = issue(root, Number(n));
  return "error" in one ? bad(one.error) : Response.json(one);
}
