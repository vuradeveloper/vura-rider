#!/usr/bin/env bash
# Deploy the API to Elastic Beanstalk.
#
# Why this wrapper exists: `eb deploy` derives the EB version label from
# `git describe --tags`, and EB rejects labels containing "/". An annotated tag
# like `backup/2026-09-20-cape-working` therefore makes every deploy die with
#
#   ERROR: ServiceError - 1 validation error detected: Value
#   '[app-backup/2026-09-20-cape-working-28-g2323-260927_071316928171]' at
#   'versionLabels' failed to satisfy constraint: Member must satisfy
#   constraint: [Member must have length ...]
#
# which mentions neither tags nor slashes, so it looks like a label-length
# problem in the caller. Hit on 27 Sep 2026 in CloudShell. This script drops
# local slug-slash tags and always passes its own slash-free label.
#
# Usage: bash deploy/deploy.sh [environment]        (default: vura-rider-prod)
set -euo pipefail

ENV="${1:-vura-rider-prod}"
REGION="${AWS_REGION:-af-south-1}"

cd "$(git rev-parse --show-toplevel)"

# 1. A tag containing "/" is enough to break the auto-generated version label.
git tag -l | grep '/' | while read -r tag; do
  echo "removing local tag that contains a slash: $tag"
  git tag -d "$tag" >/dev/null
done || true

# 1.5 Stale-dist guard: CloudShell zips the COMMITTED server/dist — if it does
# not match the last server-touching commit, the deploy silently ships OLD code
# (hit 2026-10-19: dist was rebuilt only on a dev machine and never committed,
# so every "successful" deploy kept serving the previous build).
if [ -z "${SKIP_DIST_CHECK:-}" ]; then
  DIST_COMMIT="$(tr -d '[:space:]' < server/dist/build-commit.txt 2>/dev/null || true)"
  LAST_SERVER="$(git log -1 --format=%h -- server/src server/migrations server/package.json server/tsconfig.json)"
  if [ "$DIST_COMMIT" != "$LAST_SERVER" ]; then
    echo "ERROR: server/dist is stale (dist=${DIST_COMMIT:-missing}, last server commit=${LAST_SERVER:-none})."
    echo "Fix:  cd server && npm run build   then: git add server/dist && git commit && git push"
    echo "Set SKIP_DIST_CHECK=1 to bypass deliberately."
    exit 1
  fi
  echo "dist check OK: $DIST_COMMIT matches the last server commit"
fi

# 2. Explicit, unique, slash-free label: <= 100 chars, matches [^/]+.
LABEL="vura-$(git rev-parse --short HEAD)-$(date -u +%Y%m%d-%H%M%S)"

echo "deploying $ENV in $REGION as version label: $LABEL"
eb deploy "$ENV" --region "$REGION" --label "$LABEL"
