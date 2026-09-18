#!/usr/bin/env bash
#
# Recreate the family-planner production container from the image of the commit
# being released. Runs on the self-hosted VPS runner as `familyci`.
#
# Runtime configuration is read back from the container currently serving
# traffic rather than from the host's config files: /opt/family-planner/config/
# app.env is 0600 root:root, `familyci` has no sudo, and `docker run --env-file`
# is parsed client-side by the CLI, so that file is unusable. It is itself a copy
# of the previous container's environment — which is why the container is the
# source of truth for both the env and the traefik labels.
#
# Safety properties:
#   * The replacement must report healthy AND its uploads directory must be
#     writable before the old container is stopped, so a bad build costs nothing.
#   * The old container is stopped but never removed. That is the rollback
#     (family-planner-9c9e315-r2 on the host is the precedent).
#   * Re-releasing a commit whose container already exists appends -r2, -r3, ...
#     so the live container is never removed before its replacement is healthy.
#
set -euo pipefail

SHA="${1:?usage: deploy-vps.sh <full-git-sha>}"
TAG="${SHA:0:7}"
IMAGE="family-planner:${TAG}"
ROUTER_LABEL='traefik.http.routers.family-planner.rule'

# Persistent uploads. Declared rather than inherited, because the release that
# first introduces a mount has nothing to inherit it from. The app's UPLOAD_DIR
# defaults to exactly this container path, so the two must agree.
UPLOADS_HOST_DIR="${UPLOADS_HOST_DIR:-/opt/family-planner/uploads}"
UPLOADS_CONTAINER_DIR="${UPLOADS_CONTAINER_DIR:-/data/family-planner-uploads}"

# --- serialise releases -------------------------------------------------------
# The workflow's concurrency group cannot see a release started by hand
# (scripts/release-over-ssh.sh), and a collision is destructive rather than
# wasteful: both invocations resolve the same OLD, start replacements carrying
# identical traefik labels, and each stops that one shared OLD — leaving two
# versions behind one router with nothing recording which is which. So the lock
# belongs in the single script every release path runs, not in a caller.
#
# `familyci` (runner) and `root` (SSH) both release here. flock(2) locks the open
# file description, so opening the file read-only is enough and one 0644 file
# serves both users. Ten minutes is longer than any hand-started release and
# still fits inside the workflow job's 30-minute timeout.
LOCK_DIR="${LOCK_DIR:-/opt/family-planner/locks}"
LOCK_FILE="${LOCK_DIR}/deploy.lock"
if [ ! -r "${LOCK_FILE}" ]; then
  echo "::error::cannot read the release lock ${LOCK_FILE}; create it once on the host as root:"
  echo "  install -d -o familyci -g familyci -m 755 ${LOCK_DIR}"
  echo "  install -m 644 /dev/null ${LOCK_FILE}"
  exit 1
fi
exec 9<"${LOCK_FILE}"
if ! flock -w 600 9; then
  echo "::error::another release has held ${LOCK_FILE} for 10 minutes; refusing to release concurrently"
  exit 1
fi
echo "release lock acquired (${LOCK_FILE})"
# The lock rides the open file description, so every child inherits it — it has
# to span `docker build` — and it self-heals: if this script is killed, the lock
# frees as soon as its last surviving child exits. There is never a stale lock to
# clear by hand.

# The app writes as uid 1001 (nextjs) and a bind mount carries numeric ids
# unchanged. `familyci` is in the docker group but has no sudo, so it cannot
# create this directory itself. Fail closed, naming the exact fix.
if [ ! -d "${UPLOADS_HOST_DIR}" ]; then
  echo "::error::${UPLOADS_HOST_DIR} does not exist; create it once on the host as root:"
  echo "  install -d -o 1001 -g 65533 -m 755 ${UPLOADS_HOST_DIR}"
  exit 1
fi

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

# Give up on the replacement. OLD is untouched and still serving, so there is
# nothing to roll back — say why, clear the corpse away, and stop.
abandon() {
  echo "::error::$1"
  docker logs --tail 80 "${NEW}" || true
  docker rm --force "${NEW}" >/dev/null
  exit 1
}

echo "Releasing ${TAG}: building ${IMAGE}, will replace ${OLD} with ${NEW}"
docker build --tag "${IMAGE}" .

# --- inherit env and traefik labels ------------------------------------------
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

# Mounts are the one thing NOT inherited. This app has exactly one and it is
# declared on the `docker run` below, so anything else on the container being
# replaced stops the release and gets named rather than being quietly carried
# forward: explicit beats implicit for a production swap, and it is the same
# treatment the script already gives named volumes.
#
# Read `.Mounts`, never `.HostConfig.Binds`: a bind created with
# `docker run --mount type=bind` is recorded in `.Mounts` but *not* in the legacy
# field, so a check against the legacy field alone would not see it — which is
# exactly how a mount goes missing without a word.
UNEXPECTED="$(docker inspect "${OLD}" --format \
  "{{range .Mounts}}{{if ne .Destination \"${UPLOADS_CONTAINER_DIR}\"}}  {{.Type}} {{.Source}}{{with .Name}} (name={{.}}){{end}} -> {{.Destination}}{{println}}{{end}}{{end}}")"
if [ -n "${UNEXPECTED}" ]; then
  echo "::error::${OLD} has mounts this script does not declare; refusing to release:"
  echo "${UNEXPECTED}"
  echo "  declare it on the docker run below before releasing"
  exit 1
fi

# --- start the replacement ---------------------------------------------------
# Log options and restart policy mirror the container being replaced so the host
# does not accumulate unbounded logs across releases.
docker run --detach \
  --name "${NEW}" \
  --restart unless-stopped \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  --network family-planner-internal \
  --env-file "${ENV_FILE}" \
  --volume "${UPLOADS_HOST_DIR}:${UPLOADS_CONTAINER_DIR}" \
  "${LABEL_ARGS[@]}" \
  "${IMAGE}"

# family-planner-internal is `internal: true` (no egress) and carries the
# database; `proxy` is what the traefik labels address and the only route to the
# internet. Both attachments are required.
docker network connect proxy "${NEW}"

# --- gate the swap on health, and on uploads actually working ----------------
# The image's start-period is 60s, so allow 300s before calling it a failure.
echo "Waiting for ${NEW} to report healthy..."
for i in $(seq 1 60); do
  case "$(docker inspect "${NEW}" \
            --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}')" in
    healthy)
      echo "${NEW} is healthy after ~$((i * 5))s"
      break
      ;;
    unhealthy)
      abandon "${NEW} reported unhealthy; ${OLD} is untouched and still serving"
      ;;
  esac
  if [ "${i}" -eq 60 ]; then
    abandon "${NEW} never became healthy within 300s; ${OLD} is untouched and still serving"
  fi
  sleep 5
done

# A health check only proves the app answers. Without this, a mount with the
# wrong ownership starts healthy and then fails the first time a user uploads a
# photo — which is how the uploads bug shipped unnoticed. `docker exec` runs as
# the image's USER (uid 1001), so this measures what the app will.
if ! docker exec "${NEW}" sh -c \
     "touch '${UPLOADS_CONTAINER_DIR}/.write-probe' && rm -f '${UPLOADS_CONTAINER_DIR}/.write-probe'" >/dev/null 2>&1; then
  docker exec "${NEW}" sh -c "id; ls -ld '${UPLOADS_CONTAINER_DIR}'" || true
  abandon "${UPLOADS_CONTAINER_DIR} is not writable inside ${NEW}; uploads would fail at runtime"
fi
echo "uploads directory is writable by the app user"

# --- swap --------------------------------------------------------------------
echo "Stopping previous container ${OLD} (kept, not removed, for rollback)"
docker stop "${OLD}"

# Dangling layers from the build only; images of running containers are never touched.
docker image prune --force >/dev/null

echo "Released ${TAG}: ${NEW} is serving, ${OLD} is stopped."
