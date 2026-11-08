/**
 * Client-side: where the drawer reads code from.
 *
 * Served by `next dev`, that is `/api/source` over the real checkout. A static
 * export (scripts/export-static.mts) has no server, so it reads the files the
 * bluprint cites, baked into `source.json` beside the page at build time.
 */

import type { Slice } from "@/lib/server/repo";

/** Set only in a static export: the one bluprint it serves. */
export const STATIC_BLUPRINT = process.env.NEXT_PUBLIC_STATIC_BLUPRINT;
/** In a static export, the code host page a ref links to: `<base>/<file>#L<start>-L<end>`. */
export const SOURCE_URL = process.env.NEXT_PUBLIC_SOURCE_URL;

let baked: Promise<Record<string, string>> | undefined;

/** Lines `start`–`end` of a file, cut from its whole text. */
export function sliceOf(text: string, q: { file: string; start: number; end: number; fixture?: string }): Slice {
  const lines = text.split("\n");
  const code = lines.slice(q.start - 1, q.end).join("\n");
  return { file: q.file, start: q.start, end: q.end, code, total: lines.length, matchesFixture: q.fixture === undefined || code === q.fixture };
}

export async function readSource(
  q: { bluprint: string; file: string; start: number; end: number; fixture?: string },
  signal?: AbortSignal,
): Promise<{ slice: Slice } | { refused: string }> {
  if (!STATIC_BLUPRINT) {
    const params = new URLSearchParams({ bluprint: q.bluprint, file: q.file, start: String(q.start), end: String(q.end) });
    if (q.fixture !== undefined) params.set("fixture", q.fixture);
    const res = await fetch(`/api/source?${params}`, { signal });
    const body = await res.json();
    return res.ok ? { slice: body as Slice } : { refused: (body.refused as string) ?? "unreadable" };
  }
  baked ??= fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/source.json`).then((r) => r.json());
  const text = (await baked)[q.file];
  if (text === undefined) return { refused: "not in this export" };
  return { slice: sliceOf(text, q) };
}
