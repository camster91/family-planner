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
#   * The traefik labels and the bind mounts are read back for the same reason:
#     one source of truth, and a mount or label added later is carried forward
#     instead of silently dropped.
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

# --- serialise releases ------------------------------------------------------
# The workflow serialises itself with a concurrency group, but that cannot see a
# release started by hand (scripts/release-over-ssh.sh), and the collision is
# genuinely destructive rather than merely wasteful: both invocations resolve the
# same running container as OLD, start separate replacements carrying identical
# traefik labels, and then each stops that one shared OLD — leaving two versions
# behind one router, round-robining, with nothing recording which is which. So
# the lock belongs here, in the single script every release path runs, and not in
# any of the callers.
#
# Two different users release: `familyci` from the Actions runner and `root` from
# the SSH path. flock(2) works on any open file description, so opening the lock
# read-only is enough and a 0644 file serves both — which is why it is the
# *directory* that has to be writable, and why the fix below creates it rather
# than requiring root to pre-create the file.
LOCK_DIR="${LOCK_DIR:-/opt/family-planner/locks}"
LOCK_FILE="${LOCK_DIR}/deploy.lock"
if [ ! -r "${LOCK_FILE}" ]; then
  echo "::error::cannot read the release lock ${LOCK_FILE}; create it once on the host as root:"
  echo "  install -d -o familyci -g familyci -m 755 ${LOCK_DIR}"
  echo "  install -m 644 /dev/null ${LOCK_FILE}"
  exit 1
fi
exec 9<"${LOCK_FILE}"
# Bounded rather than fail-fast: colliding with a release that is already running
# is usually bad luck, not a mistake, and a cold build takes 5-10 min. Ten
# minutes is longer than any hand-started release and short enough to still leave
# room inside the workflow job's 30-minute timeout.
if ! flock -w 600 9; then
  echo "::error::another release has held ${LOCK_FILE} for 10 minutes; refusing to release concurrently"
  exit 1
fi
echo "release lock acquired (${LOCK_FILE})"

# The lock is attached to an open file description, not to this process, so every
# child inherits it. That is what we want — the lock has to span the whole release
# including `docker build` — and it is self-healing rather than stale-prone: if
# this script is killed outright, the lock is released as soon as its last
# surviving child exits, so there is never a lock file to clear by hand. (Verified:
# killing the holder with a 4s child leaves the next release blocked for exactly
# the 3s that child had left.)

# Persistent uploads. Declared here rather than inherited, because the release
# that first introduces a mount has nothing to inherit it from — inheritance
# only keeps it alive from the next release onward. UPLOAD_DIR in the app
# defaults to exactly this container path, so the two must agree.
UPLOADS_HOST_DIR="${UPLOADS_HOST_DIR:-/opt/family-planner/uploads}"
UPLOADS_CONTAINER_DIR="${UPLOADS_CONTAINER_DIR:-/data/family-planner-uploads}"

# The app writes as uid 1001 (nextjs), a bind mount carries numeric ids across
# unchanged, and `familyci` is in the docker group but has no sudo — so it
# cannot create this directory itself. Fail closed, naming the exact fix.
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
    *) echo "::error::could not parse a mount spec on ${OLD} (final field was '${mrw}'); refusing to release"
       exit 1 ;;
  esac
  if [ "${mtype}" != "bind" ]; then
    # A named volume or tmpfs has no host path to carry across, and quietly
    # releasing without it is worse than not releasing. Fail closed and name it.
    echo "::error::${OLD} has a ${mtype} mount this script does not carry; refusing to release:"
    echo "  ${mtype} '${mname}' -> ${mdest}"
    echo "  add it to deploy-vps.sh deliberately before releasing"
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
  echo "::error::${OLD} reports $((legacy - legacy_carried)) legacy bind(s) but only ${inherited} mount(s) were carried; refusing to release"
  docker inspect "${OLD}" --format '{{range .HostConfig.Binds}}  bind  {{.}}{{println}}{{end}}{{range .Mounts}}  mount {{.Type}} {{.Source}} -> {{.Destination}}{{println}}{{end}}' || true
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

# --- prove uploads actually work before committing to the swap ---------------
# A health check only proves the app answers. Without this, a mount with the
# wrong ownership starts healthy and then fails the first time a user uploads a
# photo — which is exactly how the uploads bug shipped unnoticed. `docker exec`
# runs as the image's USER (uid 1001), so this measures what the app will.
if ! docker exec "${NEW}" sh -c \
     "touch '${UPLOADS_CONTAINER_DIR}/.write-probe' && rm -f '${UPLOADS_CONTAINER_DIR}/.write-probe'" >/dev/null 2>&1; then
  echo "::error::${UPLOADS_CONTAINER_DIR} is not writable inside ${NEW}; uploads would fail at runtime"
  docker exec "${NEW}" sh -c "id; ls -ld '${UPLOADS_CONTAINER_DIR}'" || true
  docker logs --tail 40 "${NEW}" || true
  docker rm --force "${NEW}" >/dev/null
  exit 1
fi
echo "uploads directory is writable by the app user"

# --- swap --------------------------------------------------------------------
echo "Stopping previous container ${OLD} (kept, not removed, for rollback)"
docker stop "${OLD}"

# Dangling layers from the build only; images of running containers are never touched.
docker image prune --force >/dev/null

echo "Released ${TAG}: ${NEW} is serving, ${OLD} is stopped."
