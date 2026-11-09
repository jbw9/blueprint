#!/bin/sh
# usage: manifest.sh <version> <download base url> <dir of blueprint-<os>-<arch>.tar.gz>
# Prints latest.json: the version, and each system's archive with its sha256, which the installed app
# checks before it unpacks one (app/scripts/update.mjs).
set -e
printf '{"version":"%s","assets":{' "$1"
sep=
for f in "$3"/blueprint-*.tar.gz; do
  name=$(basename "$f")
  key=${name#blueprint-}
  key=${key%.tar.gz}
  sha=$(sha256sum "$f" | cut -d' ' -f1)
  printf '%s"%s":{"url":"%s/%s","sha256":"%s"}' "$sep" "$key" "$2" "$name" "$sha"
  sep=,
done
printf '}}\n'
