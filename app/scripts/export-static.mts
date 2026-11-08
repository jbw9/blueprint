// usage (from app/): npx -y tsx --tsconfig tsconfig.json scripts/export-static.mts <blueprint> --base-path /repo/blueprint --source-url https://github.com/o/r/blob/<sha> [--root <checkout>]
//   builds one blueprint as a static site in out/<blueprint>/, ready for GitHub Pages. The files the blueprint
//   cites are baked into source.json, so the drawer reads code with no server; each code card
//   links to --source-url instead of offering an edit.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Node } from "@/lib/blueprint/schema";
import { demoSource, loadDemo, loadBlueprint, rootOf } from "@/lib/server/blueprints";

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(k); return i === -1 ? undefined : args[i + 1]; };
const name = args[0];
// One of the landing's demos (landing/demo, D63), or one of this machine's projects.
const open = loadDemo(name) ?? loadBlueprint(name);
if (!open || open.name !== name) throw new Error(`no demo or project named ${name}`);
const { file } = open;
const baked = demoSource(name);

// --root: the checkout to read, when it is not where the blueprint was made.
const root = opt("--root") ?? rootOf(file.RUN);
const cited = new Set<string>();
// A step's own lines open from the step, and an arrow's label from the arrow; either
// may sit in a file the node does not cite.
const anatomy = (blocks: Node["anatomy"]) => {
  for (const b of blocks ?? []) {
    const at = b.kind === "flow" || b.kind === "sequence" ? b.rows.map((r) => r.at) : b.kind === "diagram" ? b.arrows.map((a) => a.at) : [];
    for (const f of at) if (f) cited.add(f.replace(/:[\d-]+$/, ""));
  }
};
const walk = (n: Node) => {
  for (const c of n.code ?? []) cited.add(c.file);
  anatomy(n.anatomy);
  (n.children ?? []).forEach(walk);
};
file.AUTHORED.forEach(walk);
anatomy(file.OVERVIEW?.anatomy);
// A demo carries its cited files; a project's are read from its checkout.
const source = Object.fromEntries([...cited].sort().map((f) => [f, baked?.[f] ?? readFileSync(join(root, f), "utf8")]));

const out = resolve("out", name);
rmSync(out, { recursive: true, force: true });
// A static export cannot hold the route that reads and writes the checkout, so it sits out the build.
renameSync("app/api", ".api-aside");
let status: number | null;
try {
  const build = spawnSync("npx next build", {
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      NEXT_PUBLIC_STATIC_BLUEPRINT: name,
      NEXT_PUBLIC_BASE_PATH: opt("--base-path") ?? "",
      NEXT_PUBLIC_SOURCE_URL: opt("--source-url") ?? "",
      BLUEPRINT_EXPORT_DIR: `out/${name}`,
    },
  });
  if (build.error) throw build.error;
  status = build.status;
} finally {
  renameSync(".api-aside", "app/api");
}
// After the finally: exiting inside the try would leave app/api renamed.
if (status !== 0) process.exit(status ?? 1);
writeFileSync(join(out, "source.json"), JSON.stringify(source));
// Pages runs Jekyll by default, which drops `_next/`.
writeFileSync(join(out, ".nojekyll"), "");
console.log(`${out}: ${cited.size} cited files baked in${existsSync(join(out, "index.html")) ? "" : " — but no index.html!"}`);
