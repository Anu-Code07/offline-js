#!/usr/bin/env bash
set -euo pipefail

# Requires:
# 1. npm org `@offlinejs` exists (https://www.npmjs.com/org/create → name: offlinejs)
# 2. NPM_TOKEN with publish rights for that org
# 3. packages built (`pnpm build`)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -z "${NPM_TOKEN:-}" ]]; then
  echo "NPM_TOKEN is required" >&2
  exit 1
fi

printf '%s\n' "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > "${HOME}/.npmrc"
npm whoami

# Fail fast if the org/scope is missing
if ! npm access list packages @offlinejs >/dev/null 2>&1; then
  # Probe by attempting metadata for a package that should exist after first publish,
  # and by checking org membership.
  if ! npm org ls offlinejs >/dev/null 2>&1; then
    echo "npm org/scope '@offlinejs' was not found." >&2
    echo "Create it while logged in as this npm user: https://www.npmjs.com/org/create" >&2
    echo "Organization name must be exactly: offlinejs" >&2
    exit 1
  fi
fi

pnpm build
pnpm -r --filter './packages/**' publish --access public --no-git-checks

echo "Published all @offlinejs packages."
