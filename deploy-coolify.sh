#!/bin/bash
# Family Planner Coolify deploy helper.
# Does not embed credentials. Prefer the GitHub Actions workflow
# `.github/workflows/deploy-coolify.yml` (uses COOLIFY_URL / COOLIFY_TOKEN /
# COOLIFY_APP_UUID repository secrets).
#
# Required env:
#   COOLIFY_URL
#   COOLIFY_TOKEN
#   COOLIFY_APP_UUID

set -euo pipefail

if [ ! -f "package.json" ]; then
  echo "Error: run from the family-planner repository root" >&2
  exit 1
fi

: "${COOLIFY_URL:?Set COOLIFY_URL}"
: "${COOLIFY_TOKEN:?Set COOLIFY_TOKEN}"
: "${COOLIFY_APP_UUID:?Set COOLIFY_APP_UUID}"

COOLIFY_URL="${COOLIFY_URL%/}"

echo "Queueing Coolify start for ${COOLIFY_APP_UUID}"
curl -sS --fail-with-body --max-time 60 \
  -X POST \
  -H "Authorization: Bearer ${COOLIFY_TOKEN}" \
  -H "Content-Type: application/json" \
  "${COOLIFY_URL}/api/v1/applications/${COOLIFY_APP_UUID}/start"

echo
echo "Done. Watch the build in the Coolify dashboard."
