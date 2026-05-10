#!/usr/bin/env bash
# Convenience wrapper for rollback-cli.ts.
#
# Usage:
#   bash infra/scripts/deploy/rollback.sh marketing astro
#   bash infra/scripts/deploy/rollback.sh web next --env=production

set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <app> <buildKind> [--env=staging|production]" >&2
  echo "  e.g. $0 marketing astro --env=production" >&2
  exit 2
fi

APP="$1"
KIND="$2"
shift 2

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$REPO_ROOT"

pnpm --filter @vtorn/cicd-tools exec tsx infra/deploy/lib/rollback-cli.ts \
  "--app=$APP" "--buildKind=$KIND" "$@"
