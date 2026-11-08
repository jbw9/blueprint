import { demoDocs, listDocs } from "@/lib/server/docs";
import { demoSource, loadBlueprint, rootOf } from "@/lib/server/blueprints";

/**
 * The Markdown beside the open blueprint's code (`?blueprint=`), for the docs reader. Only
 * the list: each doc's text comes through `/api/source`, like the code's.
 */
export async function GET(request: Request) {
  const blueprint = new URL(request.url).searchParams.get("blueprint") ?? undefined;
  const demo = demoSource(blueprint);
  if (demo) return Response.json({ docs: demoDocs(demo) });
  const open = loadBlueprint(blueprint);
  return Response.json({ docs: open ? listDocs(rootOf(open.file.RUN)) : [] });
}
