# blueprint

A visual blueprint of a codebase. Start with the product's features, then go deeper, down to the line of code.

## Why

Code gets written faster than anyone can read it. Asking an assistant "how does this work?" answers one question but loses the big picture. blueprint lets you explore instead.

## Install

On macOS, Linux, or Windows (in Git Bash):

```bash
curl -fsSL https://blpr.dev/install.sh | sh
```

It downloads the latest build for your system, or builds from source where there is none. Run it again to update.

- `BLUEPRINT_FROM_SOURCE=1` builds from source anyway (kept in `~/.blueprint/src`; `BLUEPRINT_DIR` moves it)
- `BLUEPRINT_NO_TELEMETRY=1` skips the one ping it sends at the end (your OS and whether the install worked)

## Layout

- `app/` - the app: the Next.js UI and its local API (`app/`, `components/`, `lib/`), the desktop shell (`src-tauri/`), and the blueprint generator (`scripts/generate/`)
- `landing/` - the landing page at blpr.dev (`npm run dev`, port 3001)
- `admin/` - the admin dashboard at blpr.dev/admin: one static page; its data lives behind `app/scripts/api`
- `scripts/build-site.sh` - builds blpr.dev (landing, demo blueprints, admin) for the deploy workflow
- `install.sh` - the one-line install
- `docs/` - design notes and the decision log
