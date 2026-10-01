#!/usr/bin/env bash
set -euo pipefail
: "${GITHUB_SHA:?}"
: "${GITHUB_RUN_ID:?}"
: "${GITHUB_RUN_ATTEMPT:?}"
: "${FP_CHECKED_IMAGE:?}"
postgres_image="${FP_TEST_POSTGRES_IMAGE:-postgres:17-alpine}"
case "$postgres_image" in
  postgres:16-alpine|postgres:17-alpine) ;;
  *) echo "Unsupported disposable test database image" >&2; exit 1 ;;
esac

network="fp-smoke-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
database="fp-smoke-db-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
app="fp-smoke-app-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
cleanup() {
  docker rm --force "$app" "$database" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$network" >/dev/null
# Throwaway database on the isolated smoke-test network.
docker run --detach \
  --name "$database" \
  --network "$network" \
  --env POSTGRES_USER=postgres \
  --env POSTGRES_HOST_AUTH_METHOD=trust \
  --env POSTGRES_DB=familyplanner_ci \
  "$postgres_image" >/dev/null

ready=0
for _ in $(seq 1 60); do
  if docker exec "$database" pg_isready -U postgres -d familyplanner_ci >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 5
done
if [ "$ready" -ne 1 ]; then
  echo "::error::test database did not become ready"
  exit 1
fi

docker run --detach \
  --name "$app" \
  --network "$network" \
  --env DATABASE_URL="postgresql://postgres@${database}:5432/familyplanner_ci" \
  --env JWT_SECRET="${GITHUB_SHA}${GITHUB_SHA}" \
  --env NEXT_PUBLIC_APP_URL="http://family-planner.test" \
  "$FP_CHECKED_IMAGE" >/dev/null

healthy=0
for _ in $(seq 1 120); do
  state="$(docker inspect --format '{{.State.Health.Status}}' "$app")"
  if [ "$state" = healthy ]; then
    healthy=1
    break
  fi
  if [ "$state" = unhealthy ]; then
    break
  fi
  sleep 5
done
if [ "$healthy" -ne 1 ]; then
  echo "::error::container readiness smoke test failed; application logs remain on the ephemeral runner"
  exit 1
fi

response=$(docker exec "$app" node -e 'fetch("http://localhost:3000/api/health").then(async r=>{if(!r.ok||r.headers.get("x-release-commit")!==process.env.RELEASE_SHA)process.exit(1);console.log("verified");}).catch(()=>process.exit(1))')
test "$response" = verified
docker exec "$app" sh -c 'touch /data/family-planner-uploads/.ci-write-probe && rm /data/family-planner-uploads/.ci-write-probe'
echo "Checked image readiness, revision and upload ownership passed"
