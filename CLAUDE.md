# bluprint

## Commits

Write every commit with the `commit` skill (`.claude/skills/commit/`).

## Generator version

Bump `MAPPER_VERSION` in `app/scripts/generate/version.ts` in the same commit as any change under `app/scripts/generate/` that changes what a run does or produces (prompts, models, stages, checks). The admin dashboard (blpr.dev/admin) compares runs by it.
