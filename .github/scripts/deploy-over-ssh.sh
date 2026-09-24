#!/usr/bin/env bash
#
# GitHub-hosted release transport for Family Planner.
# The action sends a verified image and this repository's deploy script to the
# production host; production credentials are supplied only by the production
# GitHub Environment.
#
set -euo pipefail

if [[ "${GITHUB_ACTIONS:-}" != "true" ]]; then
  echo "::error::this release transport must run in GitHub Actions"
  exit 2
fi

SHA="${1:?usage: deploy-over-ssh.sh <full-git-sha> <image-id> <release-bundle>}"
IMAGE_ID="${2:?missing verified image id}"
BUNDLE="${3:?missing release bundle}"
FP_SSH_HOST="${FP_SSH_HOST:-}"
FP_SSH_USER="${FP_SSH_USER:-}"
FP_SSH_PORT="${FP_SSH_PORT:-22}"

if [[ ! "$SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "::error::release commit identity is invalid"
  exit 2
fi
if [[ ! "$IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "::error::verified image identity is invalid"
  exit 2
fi
if [[ ! "$FP_SSH_HOST" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]]; then
  echo "::error::production SSH host is missing or invalid"
  exit 2
fi
if [[ ! "$FP_SSH_USER" =~ ^[A-Za-z_][A-Za-z0-9._-]*$ ]]; then
  echo "::error::production SSH user is missing or invalid"
  exit 2
fi
if [[ ! "$FP_SSH_PORT" =~ ^[0-9]{1,5}$ ]] || (( 10#$FP_SSH_PORT < 1 || 10#$FP_SSH_PORT > 65535 )); then
  echo "::error::production SSH port is invalid"
  exit 2
fi
if [[ -z "${FP_SSH_PRIVATE_KEY:-}" || -z "${FP_SSH_KNOWN_HOSTS:-}" ]]; then
  echo "::error::production SSH credentials or pinned host key are not configured"
  exit 2
fi
if [[ ! -s "$BUNDLE" ]]; then
  echo "::error::verified release image bundle is missing"
  exit 2
fi

SSH_DIR="$(mktemp -d)"
SSH_ERROR="$SSH_DIR/ssh-error"
KEY_FILE="$SSH_DIR/id_ed25519"
KNOWN_HOSTS_FILE="$SSH_DIR/known_hosts"
RELEASE_DIR="$SSH_DIR/release"
trap 'rm -rf "$SSH_DIR"' EXIT

printf '%s\n' "$FP_SSH_PRIVATE_KEY" > "$KEY_FILE"
printf '%s\n' "$FP_SSH_KNOWN_HOSTS" > "$KNOWN_HOSTS_FILE"
chmod 600 "$KEY_FILE" "$KNOWN_HOSTS_FILE"

HOST_KEY_NAME="$FP_SSH_HOST"
if [[ "$FP_SSH_PORT" != "22" ]]; then
  HOST_KEY_NAME="[$FP_SSH_HOST]:$FP_SSH_PORT"
fi
if ! ssh-keygen -F "$HOST_KEY_NAME" -f "$KNOWN_HOSTS_FILE" >/dev/null 2>&1; then
  echo "::error::pinned SSH host key does not match the configured production host"
  exit 2
fi

mkdir -p "$RELEASE_DIR"
if ! tar -xzf "$BUNDLE" -C "$RELEASE_DIR" image.tar deploy-vps.sh; then
  echo "::error::verified release image bundle is invalid"
  exit 2
fi
if [[ ! -s "$RELEASE_DIR/image.tar" || ! -s "$RELEASE_DIR/deploy-vps.sh" ]]; then
  echo "::error::verified release image bundle is incomplete"
  exit 2
fi

SSH=(
  ssh
  -i "$KEY_FILE"
  -p "$FP_SSH_PORT"
  -o BatchMode=yes
  -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes
  -o UserKnownHostsFile="$KNOWN_HOSTS_FILE"
  -o ConnectTimeout=20
  -o ServerAliveInterval=20
  -o ServerAliveCountMax=3
  "$FP_SSH_USER@$FP_SSH_HOST"
)

if ! "${SSH[@]}" true >/dev/null 2>"$SSH_ERROR"; then
  echo "::error::could not reach the production release host; no deployment was started"
  exit 1
fi

REMOTE_SCRIPT="fp-deploy-${SHA}.sh"
if ! "${SSH[@]}" "umask 077; cat > \"\$HOME/${REMOTE_SCRIPT}\"" \
  < "$RELEASE_DIR/deploy-vps.sh" >/dev/null 2>"$SSH_ERROR"; then
  echo "::error::could not transfer the deployment script; no deployment was started"
  exit 1
fi

# Docker reads the image tar from stdin, so the runner never places production
# data or credentials in the archive and the remote host does not need a registry
# login or a package pull token.
if ! gzip -c "$RELEASE_DIR/image.tar" 2>"$SSH_ERROR" |
  "${SSH[@]}" 'docker load' >/dev/null 2>>"$SSH_ERROR"; then
  echo "::error::verified image transfer failed; production was not swapped"
  exit 1
fi

if ! "${SSH[@]}" "SHA=$SHA EXPECTED_IMAGE_ID=$IMAGE_ID bash -s" \
  >/dev/null 2>"$SSH_ERROR" <<'REMOTE_VERIFY'
set -euo pipefail
image="family-planner:${SHA}"
actual="$(docker image inspect --format '{{.Id}}' "$image")"
if [ "$actual" != "$EXPECTED_IMAGE_ID" ]; then
  echo "loaded image identity mismatch" >&2
  exit 1
fi
REMOTE_VERIFY
then
  echo "::error::production host did not verify the release image identity"
  exit 1
fi

# Start the deployment detached so the workflow can poll a private host-side log
# without streaming application or container logs into this public repository.
if ! "${SSH[@]}" "SHA=$SHA IMAGE_ID=$IMAGE_ID SCRIPT=$REMOTE_SCRIPT bash -s" \
  >/dev/null 2>"$SSH_ERROR" <<'REMOTE_START'
set -euo pipefail
script="$HOME/$SCRIPT"
log="$HOME/fp-deploy-${SHA}.log"
chmod 700 "$script"
setsid nohup bash "$script" "$SHA" "$IMAGE_ID" > "$log" 2>&1 < /dev/null &
REMOTE_START
then
  echo "::error::SSH disconnected while starting release; production state is unknown"
  exit 1
fi

for _ in $(seq 1 300); do
  if ! marker=$("${SSH[@]}" "SHA=$SHA bash -s" \
    2>"$SSH_ERROR" <<'REMOTE_POLL'
set -euo pipefail
log="$HOME/fp-deploy-${SHA}.log"
if [ -r "$log" ]; then
  grep -E '^(Released |::error::)' "$log" | tail -n 1 || true
fi
REMOTE_POLL
  ); then
    echo "::error::SSH disconnected while checking release; production state is unknown"
    exit 1
  fi

  case "$marker" in
    "Released "*)
      echo "Production release completed for commit $SHA"
      exit 0
      ;;
    "::error::"*)
      echo "::error::production release failed; inspect the private host log before retrying"
      exit 1
      ;;
  esac
  sleep 5
done

echo "::error::production release did not report completion within 25 minutes; check the private host before retrying"
exit 1