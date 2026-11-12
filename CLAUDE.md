# blueprint

## Commits

Write every commit with the `commit` skill (`.claude/skills/commit/`).

Commit a feature or fix as soon as it works, without waiting to be asked. It works when the typecheck and lint pass on the files it touches, and it was seen working: run in the app, by a dry run or test that exercises it, or confirmed by the user. Something still being debugged, or only guessed at, is not committed.

- Stage only that change's own files. Never stage someone else's uncommitted work or untracked files you did not create; leave them in the working tree.
- One working change, one commit. Two unrelated ones are two commits.
- Commit only; push when asked.

## Generator version

Bump `MAPPER_VERSION` in `app/scripts/generate/version.ts` in the same commit as any change under `app/scripts/generate/` that changes what a run does or produces (prompts, models, stages, checks). The admin dashboard (blpr.dev/admin) compares runs by it.

## macOS, Linux and Windows

Blueprint ships on all three, so every change to the app (`app/`, `install.sh`) is checked on each of them before it reaches `main`:

- Write the platform code for all three. Code under `#[cfg(...)]` covers macOS, Linux and Windows, each with its own native call where one exists; a fallback is only for a system none of them names.
- Build and run it here on the system you are on, and see it working.
- Commit it to a branch, not `main`, and push the branch: `.github/workflows/install.yml` builds and installs it from source on macOS (Apple silicon and Intel), Ubuntu and Windows.
- Open a PR and turn on auto-merge (`gh pr merge <n> --auto --rebase`). The ruleset on `main` holds it until every install job passes, then GitHub merges it, which deploys. Don't merge it by hand. A failure on any system is fixed on the branch first.
- Tell the user what was seen working by hand and on which system, and what only CI built.
