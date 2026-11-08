#!/bin/sh
# usage: sh scripts/build-site.sh <site>
#   builds blpr.dev into <site>, a checkout of the gh-pages branch, replacing what was there: the
#   landing page, the demo blueprints made from this repo, and the admin dashboard.
set -e
site=$(cd "$1" && pwd)
# The demo exports run in the app's package (app/scripts/export-static.mts); every path below is from there.
cd "$(dirname "$0")/../app"
base=
demos="blueprint:jbw9/blueprint"

for d in $demos; do
  blueprint=${d%%:*}
  repo=${d#*:}
  commit=$(node -p "require('../landing/demo/$blueprint/blueprint.json').RUN.commit")
  npx -y tsx@4.23.15 --tsconfig tsconfig.json scripts/export-static.mts "$blueprint" --base-path "$base/$blueprint" --source-url "https://github.com/$repo/blob/$commit"
done
(cd ../landing && NEXT_PUBLIC_BASE_PATH=$base npm run build)

find "$site" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -R ../landing/out/. "$site/"
for d in $demos; do
  blueprint=${d%%:*}
  cp -R "out/$blueprint" "$site/$blueprint"
done
# The demo's address while the app was called Bluprint, for links already shared.
mkdir -p "$site/bluprint"
printf '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=%s/blueprint/"><link rel="canonical" href="https://blpr.dev/blueprint/"><title>Blueprint</title>\n' "$base" > "$site/bluprint/index.html"
# The admin dashboard, at blpr.dev/admin: one static page, its data behind a password (app/scripts/api/admin.mjs).
mkdir -p "$site/admin"
cp ../admin/index.html "$site/admin/index.html"
touch "$site/.nojekyll"
# The site is served at blpr.dev; Pages drops the custom domain when this file is gone.
echo blpr.dev > "$site/CNAME"
echo "built $site"
