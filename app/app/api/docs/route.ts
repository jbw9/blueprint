import { demoDocs, listDocs } from "@/lib/server/docs";
import { demoSource, loadBluprint, rootOf } from "@/lib/server/bluprints";

/**
 * The Markdown beside the open bluprint's code (`?bluprint=`), for the docs reader. Only
 * the list: each doc's text comes through `/api/source`, like the code's.
 */
export async function GET(request: Request) {
  const bluprint = new URL(request.url).searchParams.get("bluprint") ?? undefined;
  const demo = demoSource(bluprint);
  if (demo) return Response.json({ docs: demoDocs(demo) });
  const open = loadBluprint(bluprint);
  return Response.json({ docs: open ? listDocs(rootOf(open.file.RUN)) : [] });
}
