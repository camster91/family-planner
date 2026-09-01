#!/usr/bin/env bash
set -euo pipefail

artifact_path="${1:?usage: deploy-review-artifact.sh IMAGE_TAR CANDIDATE_SHA}"
candidate_sha="${2:?usage: deploy-review-artifact.sh IMAGE_TAR CANDIDATE_SHA}"

if [[ ! "$candidate_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo 'Candidate SHA must be a full lowercase Git commit.' >&2
  exit 1
fi
if [[ ! -s "$artifact_path" ]]; then
  echo 'Review image artifact is missing or empty.' >&2
  exit 1
fi

review_container='family-planner-review'
database_container='family-planner-review-db'
review_url='https://family-review.ashbi.ca/api/health'
candidate_short="${candidate_sha:0:7}"
candidate_container="family-planner-review-candidate-${candidate_short}"
rollback_container="family-planner-review-rollback-${candidate_short}"
review_image="family-planner-review:${candidate_short}"
backup_dir='/opt/family-planner-review-backups'

exec 9>/tmp/family-planner-review-deploy.lock
flock -n 9 || {
  echo 'Another review deployment is already running.' >&2
  exit 1
}

for required_container in "$review_container" "$database_container"; do
  docker inspect "$required_container" >/dev/null
done

mount_count="$(docker inspect --format '{{len .Mounts}}' "$review_container")"
if [[ "$mount_count" != '0' ]]; then
  echo "Refusing automatic replacement: review app has ${mount_count} mounts." >&2
  exit 1
fi

review_network="$(
  docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' \
    "$review_container" | head -n 1
)"
host_port="$(docker port "$review_container" 3000/tcp | head -n 1 | awk -F: '{print $NF}')"
previous_image="$(docker inspect --format '{{.Config.Image}}' "$review_container")"
previous_image_id="$(docker inspect --format '{{.Image}}' "$review_container")"

if [[ -z "$review_network" || ! "$host_port" =~ ^[0-9]+$ ]]; then
  echo 'Could not resolve the review network or published port.' >&2
  exit 1
fi

work_dir="$(mktemp -d)"
env_file="${work_dir}/review.env"
inspect_file="${work_dir}/review-inspect.json"
cleanup() {
  rm -f "$env_file" "$inspect_file"
  rmdir "$work_dir" 2>/dev/null || true
}
trap cleanup EXIT

docker inspect "$review_container" > "$inspect_file"
python3 - "$inspect_file" "$env_file" <<'PY'
import json
import pathlib
import sys

inspection = json.loads(pathlib.Path(sys.argv[1]).read_text())
entries = inspection[0]["Config"].get("Env") or []
if any("\n" in entry or "\r" in entry for entry in entries):
    raise SystemExit("review environment contains an unsupported newline")
path = pathlib.Path(sys.argv[2])
path.write_text("".join(f"{entry}\n" for entry in entries))
path.chmod(0o600)
PY

mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
backup_path="${backup_dir}/before-${candidate_sha}-$(date -u +%Y%m%dT%H%M%SZ).dump"
database_user="$(docker exec "$database_container" sh -c 'printf %s "$POSTGRES_USER"')"
database_name="$(docker exec "$database_container" sh -c 'printf %s "$POSTGRES_DB"')"
docker exec "$database_container" \
  pg_dump --format=custom --create --username "$database_user" "$database_name" \
  > "$backup_path"
chmod 600 "$backup_path"
test -s "$backup_path"
echo "Review backup captured: $backup_path"

docker load --input "$artifact_path"
candidate_image_id="$(
  docker images \
    --filter "label=org.opencontainers.image.revision=${candidate_sha}" \
    --quiet --no-trunc | head -n 1
)"
if [[ -z "$candidate_image_id" ]]; then
  echo 'Loaded artifact does not carry the expected candidate revision.' >&2
  exit 1
fi
docker tag "$candidate_image_id" "$review_image"

docker rm -f "$candidate_container" >/dev/null 2>&1 || true
docker run --detach \
  --name "$candidate_container" \
  --network "$review_network" \
  --env-file "$env_file" \
  --restart no \
  "$review_image" >/dev/null

candidate_healthy=false
for _ in {1..30}; do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$candidate_container")"
  if [[ "$status" == 'healthy' ]]; then
    candidate_healthy=true
    break
  fi
  if [[ "$status" == 'unhealthy' || "$status" == 'exited' || "$status" == 'dead' ]]; then
    docker logs --tail 80 "$candidate_container" >&2 || true
    break
  fi
  sleep 2
done
if [[ "$candidate_healthy" != true ]]; then
  echo 'Candidate did not become healthy during off-port smoke.' >&2
  exit 1
fi
docker rm -f "$candidate_container" >/dev/null

rollback_needed=false
rollback() {
  if [[ "$rollback_needed" != true ]]; then
    return
  fi
  echo 'Review verification failed; restoring the previous container.' >&2
  docker rm -f "$review_container" >/dev/null 2>&1 || true
  if docker inspect "$rollback_container" >/dev/null 2>&1; then
    docker rename "$rollback_container" "$review_container"
    docker start "$review_container" >/dev/null
  fi
}
trap 'rollback; cleanup' EXIT

docker rm -f "$rollback_container" >/dev/null 2>&1 || true
docker stop "$review_container" >/dev/null
docker rename "$review_container" "$rollback_container"
rollback_needed=true

docker run --detach \
  --name "$review_container" \
  --network "$review_network" \
  --publish "${host_port}:3000" \
  --env-file "$env_file" \
  --restart unless-stopped \
  "$review_image" >/dev/null

for _ in {1..30}; do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$review_container")"
  [[ "$status" == 'healthy' ]] && break
  if [[ "$status" == 'unhealthy' || "$status" == 'exited' || "$status" == 'dead' ]]; then
    docker logs --tail 80 "$review_container" >&2 || true
    exit 1
  fi
  sleep 2
done
[[ "$(docker inspect --format '{{.State.Health.Status}}' "$review_container")" == 'healthy' ]]

running_image_id="$(docker inspect --format '{{.Image}}' "$review_container")"
running_revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$running_image_id")"
[[ "$running_revision" == "$candidate_sha" ]]
curl --fail --silent --show-error --max-time 20 "$review_url" >/dev/null

rollback_needed=false
echo "Review deployment passed: candidate=${candidate_sha} image=${running_image_id}"
echo "Rollback container retained: ${rollback_container} image=${previous_image} id=${previous_image_id}"
echo "Review URL: ${review_url}"
