#!/usr/bin/env bash
#
# Recreate the family-planner production container from the image of the commit
# being released. Runs on the self-hosted VPS runner as `familyci`.
#
# Everything is inherited from the container currently serving traffic rather
# than read from the host's config files, for two reasons:
#
#   * /opt/family-planner/config/app.env is 0600 root:root, the runner has no
#     sudo, and `docker run --env-file` is parsed client-side by the CLI — so the
#     runner cannot read it. That file is itself a copy of the previous
#     container's environment (verified: all 15 key/value hashes matched), so the
#     container is the original that the file copies.
#   * The traefik labels are read back for the same reason: one source of truth,
#     and a label added later is carried forward instead of silently dropped.
#
# Safety properties:
#   * The new container must report healthy BEFORE the old one is stopped, so a
#     bad image costs nothing.
#   * The old container is stopped but never removed — that is the rollback.
#     family-planner-9c9e315-r2 on the host is the precedent.
#   * Re-releasing a commit whose container already exists appends -r2, -r3, ...
#     so the live container is never removed before its replacement is healthy.
#
set -euo pipefail

SHA="${1:?usage: deploy-vps.sh <full-git-sha>}"
TAG="${SHA:0:7}"
IMAGE="family-planner:${TAG}"
ROUTER_LABEL='traefik.http.routers.family-planner.rule'

# --- locate the container currently serving traffic --------------------------
OLD="$(docker ps --filter "label=${ROUTER_LABEL}" --format '{{.Names}}' | head -n1)"
if [ -z "${OLD}" ]; then
  echo "::error::no running container carries the ${ROUTER_LABEL} label"
  docker ps --format '{{.Names}}  {{.Image}}' || true
  exit 1
fi

NEW="family-planner-${TAG}"
n=2
while docker container inspect "${NEW}" >/dev/null 2>&1; do
  NEW="family-planner-${TAG}-r${n}"
  n=$((n + 1))
done

echo "Releasing ${TAG}: building ${IMAGE}, will replace ${OLD} with ${NEW}"
docker build --tag "${IMAGE}" .

# --- inherit runtime configuration from the container being replaced ---------
ENV_FILE="$(mktemp)"
trap 'rm -f "${ENV_FILE}"' EXIT
chmod 600 "${ENV_FILE}"

# Never echoed anywhere: this is the app's full runtime environment, secrets included.
docker inspect "${OLD}" --format '{{range .Config.Env}}{{println .}}{{end}}' > "${ENV_FILE}"

LABEL_ARGS=()
while IFS= read -r label; do
  [ -n "${label}" ] && LABEL_ARGS+=(--label "${label}")
done < <(docker inspect "${OLD}" \
  --format '{{range $k, $v := .Config.Labels}}{{$k}}={{$v}}{{println}}{{end}}')

if [ "${#LABEL_ARGS[@]}" -eq 0 ]; then
  echo "::error::${OLD} has no labels to inherit; refusing to release without traefik routing"
  exit 1
fi

# --- start the replacement ---------------------------------------------------
# Log options and the restart policy mirror the container being replaced so the
# host does not accumulate unbounded logs across releases.
docker run --detach \
  --name "${NEW}" \
  --restart unless-stopped \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  --network family-planner-internal \
  --env-file "${ENV_FILE}" \
  "${LABEL_ARGS[@]}" \
  "${IMAGE}"

# family-planner-internal is `internal: true` (no egress) and carries the
# database; `proxy` is what the traefik labels address (traefik.docker.network)
# and is the only route to the internet. Both attachments are required.
docker network connect proxy "${NEW}"

# --- gate the swap on health -------------------------------------------------
# The image's start-period is 60s, so allow 300s before calling it a failure.
echo "Waiting for ${NEW} to report healthy..."
for i in $(seq 1 60); do
  status="$(docker inspect "${NEW}" \
    --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}')"
  case "${status}" in
    healthy)
      echo "${NEW} is healthy after ~$((i * 5))s"
      break
      ;;
    unhealthy)
      echo "::error::${NEW} reported unhealthy; ${OLD} is untouched and still serving"
      docker logs --tail 80 "${NEW}" || true
      docker rm --force "${NEW}" >/dev/null
      exit 1
      ;;
  esac
  if [ "${i}" -eq 60 ]; then
    echo "::error::${NEW} never became healthy within 300s; ${OLD} is untouched and still serving"
    docker logs --tail 80 "${NEW}" || true
    docker rm --force "${NEW}" >/dev/null
    exit 1
  fi
  sleep 5
done

# --- swap --------------------------------------------------------------------
echo "Stopping previous container ${OLD} (kept, not removed, for rollback)"
docker stop "${OLD}"

# Dangling layers from the build only; images of running containers are never touched.
docker image prune --force >/dev/null

echo "Released ${TAG}: ${NEW} is serving, ${OLD} is stopped."
