import { NotAnImage, remoteImage } from "@/lib/server/assets";
import { loadBlueprint, rootOf } from "@/lib/server/blueprints";
import { Refused, readImage } from "@/lib/server/repo";

/**
 * The images a doc shows (components/blueprint/docs.tsx): `?blueprint=&file=` one from the
 * open blueprint's checkout, through the same containment as the code; `?url=` one
 * from the web, through the offline cache (lib/server/assets.ts).
 *
 * An SVG is served as an image and nothing else: the policy below stops one
 * opened on its own from running script, and `nosniff` stops anything being
 * read as a type it was not served as.
 */
const HEADERS = {
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  "x-content-type-options": "nosniff",
};

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  try {
    const url = q.get("url");
    if (url) {
      const img = await remoteImage(url);
      return new Response(new Uint8Array(img.body), { headers: { ...HEADERS, "content-type": img.type, "cache-control": "private, max-age=86400" } });
    }
    const file = q.get("file");
    const open = loadBlueprint(q.get("blueprint") ?? undefined);
    if (!file || !open) return new Response(null, { status: 404 });
    const img = await readImage(rootOf(open.file.RUN), file);
    return new Response(new Uint8Array(img.body), { headers: { ...HEADERS, "content-type": img.type, "cache-control": "no-cache" } });
  } catch (e) {
    if (e instanceof Refused || e instanceof NotAnImage) return new Response(null, { status: 404 });
    throw e;
  }
}
