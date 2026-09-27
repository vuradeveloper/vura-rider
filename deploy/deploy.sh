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

# 2. Explicit, unique, slash-free label: <= 100 chars, matches [^/]+.
LABEL="vura-$(git rev-parse --short HEAD)-$(date -u +%Y%m%d-%H%M%S)"

echo "deploying $ENV in $REGION as version label: $LABEL"
eb deploy "$ENV" --region "$REGION" --label "$LABEL"
