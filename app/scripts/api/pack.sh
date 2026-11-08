#!/bin/sh
# usage (from app/): sh scripts/api/pack.sh → out/api.zip, the bluprint-api Lambda's code.
# The runtime brings the AWS SDK, so the zip is only this folder's modules.
set -e
mkdir -p out
rm -f out/api.zip
(cd scripts/api && zip -q ../../out/api.zip index.mjs admin.mjs credit.mjs db.mjs)
echo out/api.zip
