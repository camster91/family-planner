#!/usr/bin/env bash
# Remove only disposable Docker resources created by one Family Planner CI run.

set -Eeuo pipefail

run_id="${1:-${GITHUB_RUN_ID:-}}"
if [ -z "$run_id" ]; then
  echo "ERROR: a GitHub run ID is required" >&2
  exit 1
fi

label="family-planner.ci.run-id=${run_id}"

while IFS= read -r container_id; do
  [ -z "$container_id" ] || docker rm -f "$container_id" >/dev/null
done < <(docker ps -aq --filter "label=$label")

while IFS= read -r network_id; do
  [ -z "$network_id" ] || docker network rm "$network_id" >/dev/null 2>&1 || true
done < <(docker network ls -q --filter "label=$label")

while IFS= read -r image_id; do
  [ -z "$image_id" ] || docker image rm -f "$image_id" >/dev/null 2>&1 || true
done < <(docker image ls -q --filter "label=$label")

echo "Disposable resources removed for CI run ${run_id}"
