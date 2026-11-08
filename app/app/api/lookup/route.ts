import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BluprintIndex } from "@/lib/bluprint/coverage";
import { bluprintSearch, bluprintSection, bluprintWhere } from "@/lib/bluprint/lookup";
import { buildBluprint } from "@/lib/bluprint/build";
import { loadBluprint } from "@/lib/server/bluprints";
import { listProjects, projectDir } from "@/lib/server/vault";

/**
 * Claude's bluprint tools (src-tauri/src/mcp.rs, answered through the page):
 * `GET ?root=&tool=search&q=`, `tool=section&name=`, `tool=where&file=&line=`.
 *
 * The bluprint is the project whose checkout the asking tab runs in, not whichever
 * is on screen, so an agent in one project never reads another's bluprint. Only a
 * project the reader imported is ever read: `root` is matched against the
 * vault, never opened as a path.
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const root = q.get("root");
  const p = listProjects().find((x) => x.root === root);
  const open = p ? loadBluprint(p.id) : null;
  if (!p || !open) return Response.json({ text: "This checkout has no bluprint in Bluprint yet, so there is nothing to look up. Import it from Projects to make its bluprint." });
  const m = buildBluprint(open.file, open.name);
  const f = join(projectDir(p.id), "index.json");
  const index: BluprintIndex | null = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
  const tool = q.get("tool");
  const line = Number(q.get("line")) || undefined;
  const text =
    tool === "search" ? bluprintSearch(m, index, q.get("q") ?? "")
    : tool === "section" ? bluprintSection(m, q.get("name") ?? "", index)
    : tool === "where" ? bluprintWhere(m, index, q.get("file") ?? "", line)
    : `No bluprint tool called ${tool}.`;
  return Response.json({ text });
}
