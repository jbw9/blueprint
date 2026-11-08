# bluprint

## Commits

Write every commit with the `commit` skill (`.claude/skills/commit/`).

Commit a feature or fix as soon as it works, without waiting to be asked. It works when the typecheck and lint pass on the files it touches, and it was seen working: run in the app, by a dry run or test that exercises it, or confirmed by the user. Something still being debugged, or only guessed at, is not committed.

- Stage only that change's own files. Never stage someone else's uncommitted work or untracked files you did not create; leave them in the working tree.
- One working change, one commit. Two unrelated ones are two commits.
- Commit only; push when asked.

## Generator version

Bump `MAPPER_VERSION` in `app/scripts/generate/version.ts` in the same commit as any change under `app/scripts/generate/` that changes what a run does or produces (prompts, models, stages, checks). The admin dashboard (blpr.dev/admin) compares runs by it.
