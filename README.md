# blueprint

A visual blueprint of a codebase. Start with the product's features, then go deeper, down to the line of code.

## Why

Code gets written faster than anyone can read it. Asking an assistant "how does this work?" answers one question but loses the big picture. blueprint lets you explore instead.

## Getting started

```bash
cd app
npm install
npm run dev
```

Open http://localhost:3000.

### Use blueprint while working on it (macOS)

```bash
cd app
npm run app:install
```

## Layout

- `app/` - the app: the Next.js UI and its local API (`app/`, `components/`, `lib/`), the desktop shell (`src-tauri/`), and the blueprint generator (`scripts/generate/`)
- `landing/` - the landing page at blpr.dev (`npm run dev`, port 3001)
- `admin/` - the admin dashboard at blpr.dev/admin: one static page; its data lives behind `app/scripts/api`
- `scripts/build-site.sh` - builds blpr.dev (landing, demo blueprints, admin) for the deploy workflow
- `install.sh` - the one-line install
- `docs/` - design notes and the decision log
