#!/usr/bin/env bash
# Reproducible Family Planner release gate for Ashbi VPS and local Linux hosts.

set -Eeuo pipefail

for command in docker node npm curl; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "ERROR: required command '$command' is unavailable" >&2
    exit 1
  fi
done

run_key="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}-$$"
run_key="$(printf '%s' "$run_key" | tr -cd '[:alnum:]-')"
db_container="family-planner-ci-db-${run_key}"
app_container="family-planner-ci-app-${run_key}"
network="family-planner-ci-${run_key}"
image="family-planner-ci:${GITHUB_SHA:-local}-${run_key}"
ci_run_id="${GITHUB_RUN_ID:-local-${run_key}}"
db_password="ci-only-not-production"
db_name="familyplanner_ci"

cleanup() {
  docker rm -f "$app_container" "$db_container" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  docker image rm "$image" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> Creating disposable PostgreSQL environment"
docker network create --label "family-planner.ci.run-id=${ci_run_id}" "$network" >/dev/null
docker run -d --name "$db_container" --network "$network" --network-alias ci-db \
  --label "family-planner.ci.run-id=${ci_run_id}" \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD="$db_password" \
  -e POSTGRES_DB="$db_name" \
  -p 127.0.0.1::5432 \
  --health-cmd='pg_isready -U postgres -d familyplanner_ci' \
  --health-interval=2s --health-timeout=3s --health-retries=30 \
  postgres:17-alpine >/dev/null

for _ in {1..60}; do
  if [ "$(docker inspect -f '{{.State.Health.Status}}' "$db_container")" = "healthy" ]; then
    break
  fi
  sleep 1
done
if [ "$(docker inspect -f '{{.State.Health.Status}}' "$db_container")" != "healthy" ]; then
  docker logs "$db_container"
  echo "ERROR: disposable PostgreSQL did not become healthy" >&2
  exit 1
fi

db_port="$(docker inspect -f '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}' "$db_container")"
export DATABASE_URL="postgresql://postgres:${db_password}@127.0.0.1:${db_port}/${db_name}"
export JWT_SECRET="ci-only-secret-with-at-least-thirty-two-characters"
export NEXT_PUBLIC_APP_URL="http://127.0.0.1:3000"
export CI=true

echo "==> Installing the frozen dependency graph"
npm ci --no-audit --no-fund

echo "==> Generating Prisma and running static/application checks"
npx prisma generate
npm run typecheck
npm run lint
npm test -- --ci --runInBand --no-watchman

echo "==> Proving database migrations are idempotent"
node scripts/migrate.js
node scripts/migrate.js

echo "==> Proving persisted legacy imports"
RUN_DB_INTEGRATION=1 npx jest \
  src/lib/imports/__tests__/persistence.integration.test.ts \
  --ci --runInBand --no-watchman --forceExit

echo "==> Proving backup and isolated restore"
DB_CONTAINER="$db_container" DB_USER=postgres DB_NAME="$db_name" \
  bash scripts/recovery-rehearsal.sh

echo "==> Auditing production dependencies and building the application"
npm audit --omit=dev --audit-level=high
npm run build

echo "==> Building the immutable production container"
docker build \
  --label "org.opencontainers.image.revision=${GITHUB_SHA:-local}" \
  --label "family-planner.ci.run-id=${ci_run_id}" \
  --tag "$image" .

echo "==> Starting and smoke-testing the production container"
docker run -d --name "$app_container" --network "$network" \
  --label "family-planner.ci.run-id=${ci_run_id}" \
  -e DATABASE_URL="postgresql://postgres:${db_password}@ci-db:5432/${db_name}" \
  -e JWT_SECRET="$JWT_SECRET" \
  -e NEXT_PUBLIC_APP_URL="http://127.0.0.1:3000" \
  -p 127.0.0.1::3000 \
  "$image" >/dev/null

app_port="$(docker inspect -f '{{(index (index .NetworkSettings.Ports "3000/tcp") 0).HostPort}}' "$app_container")"
app_url="http://127.0.0.1:${app_port}"
health_url="${app_url}/api/health"
for _ in {1..90}; do
  if curl --fail --silent --show-error "$health_url" >/tmp/family-planner-ci-health.json 2>/dev/null; then
    break
  fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$app_container")" != "true" ]; then
    docker logs "$app_container"
    echo "ERROR: application container exited before becoming healthy" >&2
    exit 1
  fi
  sleep 2
done

if ! curl --fail --silent --show-error "$health_url" >/tmp/family-planner-ci-health.json; then
  docker logs "$app_container"
  echo "ERROR: application health smoke failed" >&2
  exit 1
fi

node -e '
  const fs = require("fs");
  const body = JSON.parse(fs.readFileSync("/tmp/family-planner-ci-health.json", "utf8"));
  if (body.status !== "healthy" || body.checks?.database !== "connected") {
    throw new Error(`unexpected health response: ${JSON.stringify(body)}`);
  }
'

echo "==> Proving the role-aware parent-to-child core loop"
APP_URL="$app_url" DATABASE_URL="$DATABASE_URL" node scripts/core-loop-smoke.mjs

rollback_image="${ROLLBACK_IMAGE:-}"
if [ -z "$rollback_image" ]; then
  echo "ERROR: ROLLBACK_IMAGE must identify the immutable production rollback artifact" >&2
  exit 1
fi
if ! docker image inspect "$rollback_image" >/dev/null 2>&1; then
  echo "ERROR: immutable rollback image is unavailable on Ashbi: $rollback_image" >&2
  exit 1
fi

echo "==> Proving rollback to $rollback_image against the migrated database"
docker rm -f "$app_container" >/dev/null
docker run -d --name "$app_container" --network "$network" \
  --label "family-planner.ci.run-id=${ci_run_id}" \
  -e DATABASE_URL="postgresql://postgres:${db_password}@ci-db:5432/${db_name}" \
  -e JWT_SECRET="$JWT_SECRET" \
  -e NEXT_PUBLIC_APP_URL="http://127.0.0.1:3000" \
  -p 127.0.0.1::3000 \
  "$rollback_image" >/dev/null

rollback_port="$(docker inspect -f '{{(index (index .NetworkSettings.Ports "3000/tcp") 0).HostPort}}' "$app_container")"
rollback_health_url="http://127.0.0.1:${rollback_port}/api/health"
for _ in {1..90}; do
  if curl --fail --silent --show-error "$rollback_health_url" >/tmp/family-planner-ci-rollback-health.json 2>/dev/null; then
    break
  fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$app_container")" != "true" ]; then
    docker logs "$app_container"
    echo "ERROR: rollback container exited before becoming healthy" >&2
    exit 1
  fi
  sleep 2
done

if ! curl --fail --silent --show-error "$rollback_health_url" >/tmp/family-planner-ci-rollback-health.json; then
  docker logs "$app_container"
  echo "ERROR: rollback image failed health smoke against the migrated database" >&2
  exit 1
fi

node -e '
  const fs = require("fs");
  const body = JSON.parse(fs.readFileSync("/tmp/family-planner-ci-rollback-health.json", "utf8"));
  if (body.status !== "healthy" || body.checks?.database !== "connected") {
    throw new Error(`unexpected rollback health response: ${JSON.stringify(body)}`);
  }
'
echo "==> Immutable-image rollback rehearsal passed"

echo "==> Release gate passed for ${GITHUB_SHA:-local}"
