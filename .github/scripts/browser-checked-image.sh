#!/usr/bin/env bash
# Runs synthetic household journeys against the imported image, without a rebuild.
set -euo pipefail
test "${GITHUB_ACTIONS:-}" = true
test "${CI:-}" = true
[[ "${GITHUB_SHA:-}" =~ ^[a-f0-9]{40}$ ]]
test "${FP_CHECKED_IMAGE:-}" = "family-planner-checked-runtime:${GITHUB_SHA}"

# Fixed loopback/disposable target; never inherit a production connection or URL.
export DATABASE_URL=postgresql://postgres@127.0.0.1:5432/fp_e2e_checked_ci
export FIXTURES_ALLOW=1
export FIXTURES_ANCHOR_DATE=2026-01-05T12:00:00.000Z
export E2E_BASE_URL=http://localhost:3100
export E2E_PORT=3100
export E2E_REUSE_SERVER=1
export E2E_SKIP_BUILD=1
export JWT_SECRET="${GITHUB_SHA}${GITHUB_SHA}"
export E2E_REPORT_DIR=playwright-report/checked-image
export E2E_OUTPUT_DIR=test-results/checked-image
unset E2E_SKIP_SEED NODE_ENV NODE_OPTIONS

app="fp-browser-checked-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
trap 'docker rm --force "$app" >/dev/null 2>&1 || true' EXIT
docker run --detach --name "$app" --network host \
  --env DATABASE_URL --env JWT_SECRET \
  --env PORT=3100 --env HOSTNAME=127.0.0.1 \
  --env NEXT_PUBLIC_APP_URL=http://localhost:3100 \
  --env TZ=America/Toronto \
  --env SHARED_DEVICE_ENABLED=1 --env WEATHER_ENABLED=1 \
  --env INVENTORY_SCAN_ANTHROPIC_API_KEY= \
  --env EVENT_IMPORT_ANTHROPIC_API_KEY= \
  --env MAILGUN_API_KEY= \
  --env E2E_ALLOW_SERVER_CLOCK=1 \
  --env E2E_SERVER_NOW="$FIXTURES_ANCHOR_DATE" \
  --env 'NODE_OPTIONS=--require /ci/server-clock.cjs' \
  --volume "$PWD/e2e/support/server-clock.cjs:/ci/server-clock.cjs:ro" \
  "$FP_CHECKED_IMAGE" >/dev/null

# The only runtime test injection is the existing read-only E2E clock shim.
# Application code, entrypoint and migrations come from the checked image.
node --input-type=module -e '
for(let i=0;i<120;i++) {
  try {
    const r=await fetch("http://localhost:3100/api/health");
    if(r.ok && r.headers.get("x-release-commit")===process.env.GITHUB_SHA) process.exit(0);
  } catch {}
  await new Promise(resolve=>setTimeout(resolve,1000));
}
process.exit(1);'

# Existing fixture guard/global setup, real login, UI and direct API assertions.
# All six existing responsive projects run the selected household security cases.
npx playwright test e2e/journeys.spec.ts \
  --grep 'protected route redirects|parent logs in through the form|never renders Family B|Family B list id|collection APIs return no Family B|ends the session and revokes|sees only its own sparse household|parent-only APIs refuse a direct request'
