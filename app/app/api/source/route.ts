import { readSlice, writeSlice, Refused } from "@/lib/server/repo";
import { demoSource, loadBlueprint, rootOf } from "@/lib/server/blueprints";
import { sliceOf } from "@/lib/blueprint/source";
import { notJson } from "@/lib/server/route";

/** The checkout behind the blueprint the reader has open (`?blueprint=`); null with no project yet. */
const rootFor = (blueprint: string | null | undefined) => {
  const open = loadBlueprint(blueprint ?? undefined);
  return open ? rootOf(open.file.RUN) : null;
};

/**
 * The only door to the real repository.
 *
 * GET reads a slice; POST writes one back. Both take caller-supplied paths, so
 * both go through the same containment check in `lib/server/repo.ts` — that check is
 * the whole security model and neither handler is allowed its own version of
 * it.
 *
 * Refusals are 400 with a plain message. A refused path never gets a different
 * status or a different body from a path that exists and is out of bounds:
 * probing for what is on the filesystem should learn nothing.
 */

function bad(message: string) {
  return Response.json({ refused: message }, { status: 400 });
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const file = q.get("file");
  const start = Number(q.get("start"));
  const end = Number(q.get("end"));
  if (!file || !Number.isInteger(start) || !Number.isInteger(end)) {
    return bad("bad request");
  }

  const fixture = q.get("fixture") ?? undefined;
  // A landing demo reads the code its blueprint was made from, committed beside it (D63).
  const demo = demoSource(q.get("blueprint") ?? undefined);
  if (demo) {
    const text = demo[file];
    return text === undefined ? bad("unreadable") : Response.json(sliceOf(text, { file, start, end, fixture }));
  }
  const root = rootFor(q.get("blueprint"));
  if (!root) return bad("unreadable");
  try {
    // `fixture` is the text the blueprint claims is at these lines. Passing it is
    // what lets the answer say "this has drifted" instead of quietly showing
    // fresh code under a stale explanation.
    return Response.json(await readSlice({ file, start, end }, fixture, root));
  } catch (e) {
    return bad(e instanceof Refused ? e.message : "unreadable");
  }
}

export async function POST(request: Request) {
  // JSON only: a cross-site form can send text/plain with no preflight.
  const refused = notJson(request);
  if (refused) return refused;
  const body = await request.json().catch(() => null);
  const { file, start, end, code, expected, blueprint } = body ?? {};
  if (
    typeof file !== "string" ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    typeof code !== "string" ||
    typeof expected !== "string"
  ) {
    return bad("bad request");
  }

  const root = rootFor(typeof blueprint === "string" ? blueprint : null);
  if (!root) return bad("unreadable");
  const result = await writeSlice({ file, start, end, code, expected }, root);
  return Response.json(result, { status: result.ok ? 200 : 409 });
}
