#!/usr/bin/env bash
#
# Promote the verified Family Planner image on the production Docker host.
# GitHub-hosted Actions transfers the exact image and invokes this script over
# pinned SSH. Runtime configuration, routing labels, and bind mounts are carried
# forward from the current container without printing their values.
#
# The replacement must report healthy before the current container is stopped.
# The previous container is retained for recovery. Releasing the same commit
# again gets a unique container name so an existing rollback candidate is kept.
#
set -euo pipefail

on_unexpected_error() {
  rc=$?
  printf '::error::deployment stopped unexpectedly (exit %s, line %s)\n' "$rc" "$LINENO" >&2
  exit "$rc"
}
trap on_unexpected_error ERR

SHA="${1:?usage: deploy-vps.sh <full-git-sha> <expected-image-id>}"
EXPECTED_IMAGE_ID="${2:?missing expected image id}"
if [[ ! "$SHA" =~ ^[0-9a-f]{40}$ || ! "$EXPECTED_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "::error::release identity is invalid"
  exit 2
fi
TAG="$SHA"
IMAGE="family-planner:${TAG}"
ROUTER_LABEL='traefik.http.routers.family-planner.rule'

# --- serialise releases ------------------------------------------------------
# This host-side lock protects against overlapping deployments, including a
# recovery operation started outside the GitHub workflow. The configured
# deployment identity must be able to open it; otherwise fail before changing
# the live container.
LOCK_DIR="${LOCK_DIR:-/opt/family-planner/locks}"
LOCK_FILE="${LOCK_DIR}/deploy.lock"
if [ ! -r "${LOCK_FILE}" ]; then
  echo "::error::release lock is unavailable; host setup is required"
  exit 1
fi
exec 9<"${LOCK_FILE}"
# Wait at most ten minutes for a release already holding the lock. This stays
# within the GitHub job timeout while avoiding overlapping container swaps.
if ! flock -w 600 9; then
  echo "::error::another release held the lock too long; refusing to release concurrently"
  exit 1
fi
echo "release lock acquired"

# The file lock spans image verification and the container swap. It is released
# automatically after this script and any child process holding the descriptor exit.

# Persistent uploads. Declared here rather than inherited, because the release
# that first introduces a mount has nothing to inherit it from — inheritance
# only keeps it alive from the next release onward. UPLOAD_DIR in the app
# defaults to exactly this container path, so the two must agree.
UPLOADS_HOST_DIR="${UPLOADS_HOST_DIR:-/opt/family-planner/uploads}"
UPLOADS_CONTAINER_DIR="${UPLOADS_CONTAINER_DIR:-/data/family-planner-uploads}"

# The app writes as uid 1001 (nextjs), a bind mount carries numeric ids across
# unchanged, and the configured deployment account must have Docker access, so it
# cannot create this directory itself. Fail closed if the persistent storage is unavailable.
if [ ! -d "${UPLOADS_HOST_DIR}" ]; then
  echo "::error::persistent uploads storage is unavailable; refusing to release"
  exit 1
fi

# --- locate the container currently serving traffic --------------------------
OLD="$(docker ps --filter "label=${ROUTER_LABEL}" --format '{{.Names}}' | head -n1)"
if [ -z "${OLD}" ]; then
  echo "::error::no running application container was found; refusing to release"
  exit 1
fi

NEW="family-planner-${TAG}"
n=2
while docker container inspect "${NEW}" >/dev/null 2>&1; do
  NEW="family-planner-${TAG}-r${n}"
  n=$((n + 1))
done

actual_image_id="$(docker image inspect --format '{{.Id}}' "${IMAGE}")"
if [ "${actual_image_id}" != "${EXPECTED_IMAGE_ID}" ]; then
  echo "::error::the loaded production image does not match the verified candidate"
  exit 1
fi
echo "Releasing commit ${SHA}: verified image will replace ${OLD} with ${NEW}"

# --- inherit runtime configuration from the container being replaced ---------
ENV_FILE="$(mktemp)"
trap 'rm -f "${ENV_FILE}"' EXIT
chmod 600 "${ENV_FILE}"

# Never echoed anywhere: this is the app's full runtime environment, secrets included.
# RELEASE_SHA is baked into each image; inheriting the old value would make
# /api/health report the previous commit and fail post-swap verification.
docker inspect "${OLD}" --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | { grep -v '^RELEASE_SHA=' || true; } > "${ENV_FILE}"

LABEL_ARGS=()
while IFS= read -r label; do
  [ -n "${label}" ] && LABEL_ARGS+=(--label "${label}")
done < <(docker inspect "${OLD}" \
  --format '{{range $k, $v := .Config.Labels}}{{$k}}={{$v}}{{println}}{{end}}')

if [ "${#LABEL_ARGS[@]}" -eq 0 ]; then
  echo "::error::${OLD} has no labels to inherit; refusing to release without traefik routing"
  exit 1
fi

# Mounts are inherited for the same reason the labels are: a mount added to the
# running container must not silently vanish on the next release.
#
# .Mounts is the authoritative list, and .HostConfig.Binds is NOT a substitute for
# it. A bind created with `docker run --mount type=bind` is recorded in .Mounts
# but *not* in .HostConfig.Binds, so rebuilding from the legacy field alone drops
# that mount without a word — the same silent loss that let the uploads directory
# go missing in the first place. A bind created with `--volume` appears in both,
# which is why this reads .Mounts for the arguments and only *cross-checks* the
# legacy field rather than rebuilding from it (rebuilding from both without a
# reliable destination parse would duplicate every --volume bind and make
# `docker run` fail with "Duplicate mount point").
BIND_ARGS=()
inherited=0
while IFS='|' read -r mtype msource mname mdest mrw; do
  [ -z "${mtype}" ] && continue
  # A stray '|' in a path would shift the fields rather than fail, so validate the
  # last one instead of trusting the parse.
  case "${mrw}" in
    true|false) ;;
    *) echo "::error::could not parse a mount entry; refusing to release"
       exit 1 ;;
  esac
  if [ "${mtype}" != "bind" ]; then
    # A named volume or tmpfs has no host path to carry across, and quietly
    # releasing without it is worse than not releasing. Fail closed and name it.
    echo "::error::the running container has an unsupported mount type; refusing to release"
    exit 1
  fi
  # The uploads mount is declared explicitly below. Skipping an inherited copy of
  # it matters: two --volume flags for one destination make `docker run` fail
  # outright with "Duplicate mount point".
  case "${mdest}" in
    "${UPLOADS_CONTAINER_DIR}") continue ;;
  esac
  if [ "${mrw}" = "false" ]; then
    BIND_ARGS+=(--volume "${msource}:${mdest}:ro")
  else
    BIND_ARGS+=(--volume "${msource}:${mdest}")
  fi
  inherited=$((inherited + 1))
done < <(docker inspect "${OLD}" \
  --format '{{range .Mounts}}{{.Type}}|{{.Source}}|{{.Name}}|{{.Destination}}|{{.RW}}{{println}}{{end}}')

# Cross-check that no legacy binding went uncarried. .Mounts is a superset of
# .HostConfig.Binds, and a `--mount` bind is *only* in .Mounts, so the carried
# count is expected to be greater than or equal to the legacy count — never less.
# If it comes out less, Docker has reported a binding this loop did not see, and
# refusing beats releasing a container that has quietly lost a mount.
legacy=0
legacy_carried=0
while IFS= read -r bind; do
  [ -z "${bind}" ] && continue
  legacy=$((legacy + 1))
  case "${bind}" in
    *":${UPLOADS_CONTAINER_DIR}" | *":${UPLOADS_CONTAINER_DIR}:"*) legacy_carried=$((legacy_carried + 1)) ;;
  esac
done < <(docker inspect "${OLD}" --format '{{range .HostConfig.Binds}}{{println .}}{{end}}')

if [ "$((legacy - legacy_carried))" -gt "${inherited}" ]; then
  echo "::error::not all existing container mounts could be carried forward; refusing to release"
  exit 1
fi

if [ "${inherited}" -gt 0 ]; then
  echo "carrying forward ${inherited} bind mount(s) from ${OLD}"
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
  --env "RELEASE_SHA=${SHA}" \
  --volume "${UPLOADS_HOST_DIR}:${UPLOADS_CONTAINER_DIR}" \
  "${BIND_ARGS[@]}" \
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
      echo "::error::replacement container reported unhealthy; the previous container is still serving"
      docker rm --force "${NEW}" >/dev/null
      exit 1
      ;;
  esac
  if [ "${i}" -eq 60 ]; then
    echo "::error::replacement container did not become healthy in time; the previous container is still serving"
    docker rm --force "${NEW}" >/dev/null
    exit 1
  fi
  sleep 5
done

# --- prove uploads actually work before committing to the swap ---------------
# A health check only proves the app answers. Without this, a mount with the
# wrong ownership starts healthy and then fails the first time a user uploads a
# photo — which is exactly how the uploads bug shipped unnoticed. `docker exec`
# runs as the image's USER (uid 1001), so this measures what the app will.
UPLOAD_PROBE="${UPLOADS_CONTAINER_DIR%/}/.write-probe"
if ! docker exec "${NEW}" touch "${UPLOAD_PROBE}" >/dev/null 2>&1; then
  echo "::error::persistent uploads storage is not writable by the replacement container"
  docker rm --force "${NEW}" >/dev/null
  exit 1
fi
if ! docker exec "${NEW}" rm -f "${UPLOAD_PROBE}" >/dev/null 2>&1; then
  docker exec "${NEW}" rm -f "${UPLOAD_PROBE}" >/dev/null 2>&1 || true
  echo "::error::replacement container could not remove its uploads write probe"
  docker rm --force "${NEW}" >/dev/null
  exit 1
fi
echo "uploads directory is writable by the app user"
# --- swap --------------------------------------------------------------------
echo "Stopping previous container ${OLD} (kept, not removed, for rollback)"
docker stop "${OLD}"

# Dangling layers from the build only; images of running containers are never touched.
docker image prune --force >/dev/null

echo "Released commit ${SHA}: replacement container is serving; previous container is retained for rollback."
