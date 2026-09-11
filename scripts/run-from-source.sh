#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

if ! command -v pnpm >/dev/null 2>&1; then
  echo 'run-from-source: pnpm is required' >&2
  exit 1
fi

pnpm install
pnpm run build
exec pnpm dsh web "$@"
