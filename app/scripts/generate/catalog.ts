/**
 * `<out>/index.json`: every file of the checkout and what the bluprint knows about
 * it — which roots own it, why it was left out, its top-level symbols. The
 * app finds things by it and measures coverage against it (lib/coverage.ts),
 * so a file the bluprint does not explain is still listed, with the reason, rather
 * than simply absent.
 */
import type { IndexFile, BluprintIndex } from "@/lib/bluprint/coverage";
import { excludedBy, owners, type Cut } from "./cut";
import { isSource, type Inventory } from "./inventory";
import type { FileSummary } from "./summarize";

export function catalogOf(inv: Inventory, sums: Record<string, FileSummary>, cut: Cut): BluprintIndex {
  const files: Record<string, IndexFile> = {};
  for (const f of inv.files) {
    // Listed, so the app never takes a file outside a scoped bluprint for one added since.
    if (f.outside) {
      files[f.path] = { roots: [], status: "excluded", reason: "Outside the part of the repository this blueprint covers", kind: f.test ? "test" : "other", lines: f.lines, symbols: [] };
      continue;
    }
    const s = sums[f.path];
    const left = cut.excluded.find((e) => e.path === f.path || (e.path.endsWith("/") && f.path.startsWith(e.path)));
    files[f.path] = {
      roots: owners(cut, f.path),
      status: !isSource(f) ? "other" : excludedBy(cut, f.path) ? "excluded" : "source",
      ...(left ? { reason: left.reason } : {}),
      kind: s?.kind ?? (f.test ? "test" : "other"),
      ...(s?.purpose ? { purpose: s.purpose } : {}),
      lines: f.lines,
      symbols: (s?.symbols ?? []).map(({ name, start, end, does }) => ({ name, start, end, does })),
    };
  }
  return { commit: inv.commit, files, imports: inv.imports };
}
