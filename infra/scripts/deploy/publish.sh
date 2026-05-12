#!/usr/bin/env bash
# Convenience wrapper that mirrors the inline scripting from the prior atomic-swap project.
# Just shells out to pnpm + tsx. Useful when you want a one-line invocation
# from cron or a systemd timer.
#
# Usage:
#   bash infra/scripts/deploy/publish.sh staging marketing
#   bash infra/scripts/deploy/publish.sh production --apps=marketing,web

set -euo pipefail

ENV="${1:-staging}"
shift || true

case "$ENV" in
  staging|production) ;;
  *) echo "first arg must be 'staging' or 'production'" >&2; exit 2 ;;
esac

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$REPO_ROOT"

if [ "$ENV" = "production" ]; then
  pnpm --filter @vtorn/cicd-tools exec tsx infra/deploy/promote-to-prod.ts "$@"
else
  pnpm --filter @vtorn/cicd-tools run publish-all -- --env=staging "$@"
fi
