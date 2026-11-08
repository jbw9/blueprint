# Map generator audit — 2026-11-07

Scope: `app/scripts/generate/` (≈8,300 lines, 30 files) plus how the app launches it (`app/lib/server/vault.ts`). Read-only; nothing was changed.

Legend — **✔** verified in this audit by reading/running the code, **·** reported from code reading, not reproduced.

---

## TL;DR

1. **Two generators are living in one map.** New maps are written by `deep.ts` (code builds structure, model writes words). Updates rewrite sections with the old *agent* author and redraw the overview with the old agent. The one real update so far cost **$8.18 / 33 min for 10 files**, vs **$11.89 / 18 min for the whole fresh map**, and one section failed.
2. **About a third of the generator is unreachable from the app.** The app always runs `--fast`, so the old cut → author agents → overview pipeline, `--deepen-agent`, `audit.ts` and the split-author machinery only run from the CLI.
3. **There's no quality gate on the current pipeline.** Every benchmark map (flask, kafka, saas, explorify…) was made by the *old* pipeline. Exactly one map exists from fast+deep (this repo). Nothing runs evals, and nothing ties quality to `MAPPER_VERSION`.
4. **Silent degradation everywhere.** A section whose model calls all failed is still reported "written in full". Running out of Claude usage doesn't stop a run. Final check problems never reach the map.
5. **Language support is uneven.** C, C++ and C# have no call edges. Go drops calls in any function that returns a value.

---

## The numbers

| | Old pipeline (benchmarks) | Fast + deep (this repo, v3) | Update (this repo) |
|---|---|---|---|
| Runs on record | 29 | **1** | 1 |
| Typical cost | $4–24 | $11.89 (222 files) | $8.18 (10 changed files) |
| Time | 8–39 min | quick map **252 s**, done 1,073 s | 1,978 s |
| Biggest cost | author agents (~65%) | `deep-leaves` $6.16 (52%) | `update` agents $8.12 (99%) |
| Verify stage | yes | **none** | none |

Notes:
- The quick map took **4.2 min**, not the ~90 s the app's commit message promises. Summarize (110 s) and fan-out (127 s) dominate.
- The app runs everything through the **Claude Code CLI** (`SLOP_BACKEND: "claude-code"` hardcoded at `vault.ts:376,583,622,676`) ✔. The Bedrock path only runs from CLI and evals, so it is no longer a like-for-like baseline.

---

## Decisions for you

These change what the rest of the work looks like.

| # | Decision | Recommendation |
|---|---|---|
| D1 | Make updates use `deepRoot` / `deepOverview` instead of agents? | **Yes.** It's the biggest win on cost, consistency and speed. Keep the agent only for "the map is wrong here" corrections with no code change. |
| D2 | Delete the old non-fast pipeline and `--deepen-agent`? | **Yes, after D1**, since updates are what keep `authorRoot` / `overviewOf` alive. Keep the benchmark map outputs as the bar. |
| D3 | Build a quality gate before more pipeline changes? | **Yes, first or alongside D1.** Re-run the benchmark repos through fast+deep, compare to the hand-made explorify map, and record scores per `MAPPER_VERSION`. Otherwise we can't tell whether D1 or D2 made maps better or worse. |
| D4 | Let the top level stop following directories? | Later. One model pass that moves files between sections before deepening (every file in exactly one section). It's the largest quality lever, but it needs D3 to judge. |
| D5 | Trim the quick map (name sections and groups only, not files)? | Optional. It saves part of the $1.37 fan-out and some of the 127 s, but leaves look worse for the first minutes. |

---

## Fix — bugs

### P0: wrong output, or silently degraded output

| # | Bug | Evidence | Effort |
|---|---|---|---|
| 1 | **Line references beyond the end of a file.** `leafCode` trusts symbol line numbers from the Haiku summary without clamping them. This repo's map cites `mcp.rs:1088-1151` in a 544–548-line file (both final check problems of the fresh run). `chunksOf` in deep.ts does filter. | ✔ `fast.ts:378-389` vs `deep.ts:229-237` | S |
| 2 | **Failed sections are reported "written in full".** Every model call in `deepRoot` is caught, so `done.root` is always set, and pipeline marks the section done. The report also drops accepted sections' problems (`lastProblems: a.root ? []`). | ✔ `deep.ts:425-432,509-514,552-568,619`; `pipeline.ts:298-304,371` | S |
| 3 | **Running out of Claude usage doesn't stop a run.** The usage-limit throw is swallowed twice in summarize, about 9 `claude -p` spawns are wasted per batch, every file ends up "(not summarised)", and the run carries on. That placeholder text then leaks into `index.json` as a file's purpose. | ✔ `claude-code.ts:279`, `summarize.ts:78-81,118`, `catalog.ts:28` | S |
| 4 | **Updates miss committed and staged edits in subfolder projects.** `git diff --name-only` without `--relative` returns repo-root paths; `live.ts` does it right. `diff.ts:610` has the same problem. | ✔ `gitdiff.ts:87,94,104` vs `live.ts:109` | S |
| 5 | **A killed or paused update shifts line references twice.** References move and map.json is written per section, but `base.json` is only written at the end. | · `update.ts:431,484,522` | S |
| 6 | **A map made from a dirty checkout re-diffs those edits on its first update.** No `base.json` is written at generation time. | · `vault.ts:357`, `inventory.ts:37` | S |
| 7 | **Call graph holes.** C and C++ have no call patterns, and their function ranges cover only the signature line. In C#, member calls are tagged `reference.send`, which the graph ignores, and plain calls are not captured. In Go, `shadows()` misses `) int {` and treats called names as parameters, and `indexOf(own)` matches the "f" inside `func`. | ✔ reproduced in the scratchpad test repo; Go regex at `graph.ts:197-203` | S–M |

### P1: robustness and correctness

| # | Bug | Evidence | Effort |
|---|---|---|---|
| 8 | **`focus.json` has no effect.** All sections start at once (`AT_ONCE = queue.length`) behind a global cap of 8 calls, so the section you open is never written first. Cap sections in flight at 2–3. | ✔ `pipeline.ts:312`, `bedrock.ts:151-162` | S |
| 9 | **The quick map is all or nothing.** The fan-out and synthesize calls have no fallback; one failed component kills the run. Fan-out asks for an entry per file within 8,000 tokens, with no limit on component size. | ✔ `fast.ts:550,579`; cause of failure not reproduced | S–M |
| 10 | **Failed update sections stay `partial` forever.** `base.json` records their files as done, so nothing picks them again. | · `update.ts:481,521` | S |
| 11 | **Overview goes stale on updates.** Its line refs are never moved. It is redrawn only when a section is added, not on renames or removals. | · `update.ts:383,431,468-473,510` | S–M |
| 12 | **Summary cache misses spread across the repo.** Claude Code batches are packed in path order, and the cache key covers a whole batch. One added file can shift every later batch, and updates re-summarize through this cache. Key it per file, or cut batches by directory. | · `summarize.ts:129-135`, `update.ts:396` | M |
| 13 | **Words cut mid-sentence or mid-word.** `cutWords`, `fit40` and `short()` truncate with "…" before autofix's cleaner word-boundary cut can run. Only a too-short explainer is sent back for a retry. | · `deep.ts:82-88,521,783`; `check.ts:597-604` | S |
| 14 | **Large sections come out flat.** `groupFiles` allows 2–6 groups of ≤12 files, which can't fit more than 72 files, and the fallback is one flat level. | · `deep.ts:141,176-181,213-216` | M |
| 15 | **Problems never reach the reader.** Final check problems go only to report.json; deepOverview's problems are discarded; nothing in map.json flags them. | · `pipeline.ts:335-345,370` | S |
| 16 | **Smaller update issues.** `redo` output skips `plain()` and `dedupeIssues`. Early returns don't append to `report.updates`, so the dashboard re-sends the previous update. Agent turns that finish during a fresh run are dropped. | · `update.ts:327,392,477`; `vault.ts:558` | S |
| 17 | **Fragile retry and model mapping.** `RETRYABLE` matches any "500", for example "line 1500". `CC_MODEL` is a hand-kept copy of `MODELS`. | · `claude-code.ts:29-33,215` | S |

---

## Remove

Safe now (unused in every mode):

| What | Where | Note |
|---|---|---|
| `spanOf`, `timingOf` | `pipeline.ts:94-121` | `deepRoot` never sets `log` |
| `drafts` / `writeDrafts` | `pipeline.ts:176-178,296-297` | fast path writes an empty file |
| `graph.json` output | `pipeline.ts:225` | read by nothing, never updated |
| `buildGraph` memo | `graph.ts:307-313` | one call per process, never hits |
| `Tool.strict` | `bedrock.ts:55` | no caller sets it |
| `save()` / `writing` promise chain | `pipeline.ts:263-268` | `atomic()` is synchronous, so the chain guards nothing |
| Duplicate cache-path code | `bedrock.ts:184-186` | repeats `cacheFile()` |
| Unread `update.json` fields | `update.ts:530` | better to **surface** `homeless` (files no section took) than delete it |

After D1 + D2 (old pipeline gone):

| What | Where |
|---|---|
| Non-fast branch, `redraw`/`--overview`, `submitted`, `agentDeepen` branches, cut/part models | `pipeline.ts:37-59,138-140,191-200,234,291-294,330-331,383-614` |
| `cutRepo` and its prompt/tool | `cut.ts:33-132` (keep `place`, `owners`, `unclaimed`) |
| `authorSplit`, `tooBig`, `inParts`, `outlineParts`, `joinParts`, `SPLIT_*` | `author.ts:593-823` |
| `authorRoot` / `overviewOf` / `overview.ts` | only if corrections also move off the agent |
| `audit.ts` | only the non-fast path writes `audit.md`, so the app's Audit panel is always empty. Port it to fast or drop the panel. |
| `prompts/rules.md`, `exemplar.json` | read only by the agents |

Roughly **1,000–1,400 lines** go once both are done.

---

## Improve

**Consistency and duplication**
- **fast.ts and deep.ts duplicate helpers:** `fileLine`, `keyFile` (the deep copy rescans every edge for every file), `unique`, `NAMED`, and the bare-line arrow filter (written twice in deep.ts).
- **`check()` runs four times per run.** In deep.ts, autofix finds almost nothing, because values are already clamped.

**Speed (the quick map is 4.2 min, not 90 s)**
- Build the graph while summarize runs; today they run one after the other (`pipeline.ts:152` → `:211`).
- Read each file once through a shared text cache. Today a file is read 4+ times, and `numbered()` re-reads the whole file for every 1,500-line part.
- Remove quadratic paths on big repos: `cGraph` filters once per `#include`, Ruby once per `require`, and maps grow by array spreading.

**Quality**
- Glossary terms are never checked against the map's own words, and walkthrough step details have no length limit.
- With fewer than 2 traced paths, walkthroughs have nothing to choose from.
- Ruby and PHP name matches are labelled "extracted", so the checker trusts them as stated in the code.
- No coverage at all for SQL, Prisma, GraphQL or Proto, even though they count as code. Vue, Svelte, Astro and Obj-C get name matches only.

**Evaluation (D3)**
- `evaluate.ts` and `eval.mts` work, but they read only `maps/<name>`, not the app's vault. They show blank cost and arrow columns for fast reports, and no script or CI runs them.
- `audit-diagrams.mts` skips the overview's diagram.

**Stale comments**
- `update.ts:22`: "then verified" (nothing verifies anymore).
- `update.ts:28`: `lib/vault.ts` (moved to `lib/server/vault.ts`).
- `update.ts:30`: `slop-map-fix` (now `blueprint-map-fix`).
- `bedrock.ts:283`: the "5.5 models" note doesn't match `MODELS`.

---

## D1 in more detail — updates through `deepRoot`

Inputs are already there: the fast cut with prefixes, `activeGraph()`, fresh summaries, and the old section as `quick`.

| Gains | Costs / to design |
|---|---|
| One style across the map; arrows, coverage and step lines hold by construction | `deepRoot` rebuilds a whole top-level section, not just the deepest touched part |
| A few calls instead of a 30-turn agent per section | Group ids come from model titles, so they churn and the diff view shows the whole section as changed. **Keep old groups when the file set is unchanged; keep old words for unchanged leaves** (leaf ids `${prefix}-${fileSlug}` are stable) |
| "Removed" falls out naturally (no files left), and partial-on-failure works unchanged | The coding agent's account and its corrections need a place in the words prompt; `deep.ts` writes no `issues` |

Suggested shape:
- **Sections touched by code changes:** `deepRoot`, reusing old groups and words.
- **New sections:** `deepRoot`.
- **Overview:** `deepOverview`.
- **Corrections only, with no code change:** keep the agent.

Bump `MAPPER_VERSION`.

---

## Suggested order

1. **P0 fixes 1–4 and 7.** These are small and self-contained; each one is a commit and a `MAPPER_VERSION` bump where output changes.
2. **D3, a minimal eval.** Fast+deep runs of 3–4 benchmark repos, scored against explorify, results stored per version.
3. **D1:** updates through `deepRoot` / `deepOverview`, then fixes 5, 6, 10 and 11 on the new path.
4. **D2:** delete the old pipeline and the dead code above.
5. **Speed work** toward a real ~90 s quick map, then **D4** (top-level sections not tied to directories).
