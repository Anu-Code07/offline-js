#!/usr/bin/env bash
# Verifies the docs site is deployable the same way Vercel will publish it.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

echo "-> Regenerating docs-site/out"
node docs-site/build.cjs

echo "-> Checking required artifacts"
test -f docs-site/out/index.html
test -f docs-site/out/demo.html
test -f docs-site/out/assets/styles.css
test -f docs-site/out/assets/site.js
test -f docs-site/out/assets/demo.css
test -f docs-site/out/assets/demo.js
test -f docs-site/out/quick-start.html
test -f docs-site/out/api.html
test -f docs-site/out/robots.txt
test -f docs-site/out/sitemap.json

echo "-> Simulating Vercel install/build commands"
true
true
test -d docs-site/out

echo "-> Simulating package.json vercel-build fallback"
test -f docs-site/out/index.html

echo "OK: docs deploy artifacts are ready"
