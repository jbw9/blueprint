import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BlueprintIndex } from "@/lib/blueprint/coverage";
import { blueprintSearch, blueprintSection, blueprintWhere } from "@/lib/blueprint/lookup";
import { buildBlueprint } from "@/lib/blueprint/build";
import { loadBlueprint } from "@/lib/server/blueprints";
import { listProjects, projectDir } from "@/lib/server/vault";

/**
 * Claude's blueprint tools (src-tauri/src/mcp.rs, answered through the page):
 * `GET ?root=&tool=search&q=`, `tool=section&name=`, `tool=where&file=&line=`.
 *
 * The blueprint is the project whose checkout the asking tab runs in, not whichever
 * is on screen, so an agent in one project never reads another's blueprint. Only a
 * project the reader imported is ever read: `root` is matched against the
 * vault, never opened as a path.
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const root = q.get("root");
  const p = listProjects().find((x) => x.root === root);
  const open = p ? loadBlueprint(p.id) : null;
  if (!p || !open) return Response.json({ text: "This checkout has no blueprint in Blueprint yet, so there is nothing to look up. Import it from Projects to make its blueprint." });
  const m = buildBlueprint(open.file, open.name);
  const f = join(projectDir(p.id), "index.json");
  const index: BlueprintIndex | null = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
  const tool = q.get("tool");
  const line = Number(q.get("line")) || undefined;
  const text =
    tool === "search" ? blueprintSearch(m, index, q.get("q") ?? "")
    : tool === "section" ? blueprintSection(m, q.get("name") ?? "", index)
    : tool === "where" ? blueprintWhere(m, index, q.get("file") ?? "", line)
    : `No blueprint tool called ${tool}.`;
  return Response.json({ text });
}
