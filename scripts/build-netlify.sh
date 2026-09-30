#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf dist
mkdir -p dist
cp -r web/. dist/
# Cloudflare's edge routing is not a Netlify static asset.
rm -rf dist/functions
rm -f dist/download.html
cp -r src assets dist/
cp dist/app.html dist/index.html
cp LICENSE dist/LICENSE.txt
printf 'Vector Studio Netlify build: %s/dist\n' "$PWD"
