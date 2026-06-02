#!/bin/bash
# Pull-based deploy script for family-planner.
#
# Triggered by:
#   1. Cron (every 5 min, checks for new image tags)
#   2. GitHub webhook (COOLIFY_WEBHOOK style POST)
#   3. SSH: bash deploy.sh [tag]
#
# What it does:
#   1. Pulls the specified image from ghcr.io
#   2. Updates /data/coolify/applications/{uuid}/docker-compose.yaml
#   3. docker compose up -d
#
# This bypasses the Coolify helper container's broken network (it can't
# reach github.com:443 to clone) by using prebuilt images from ghcr.io
# (which it CAN reach).

set -euo pipefail

CONTAINER_UUID="zgsckw0ggsco8sogowk40s0s"
APP_DIR="/data/coolify/applications/${CONTAINER_UUID}"
COMPOSE_FILE="${APP_DIR}/docker-compose.yaml"
IMAGE_NAME="ghcr.io/camster91/family-planner"
LOG_FILE="/var/log/family-planner-deploy.log"

# Get the tag to deploy (default: latest)
TAG="${1:-latest}"

log() { echo "[$(date -u +%FT%TZ)] $*" | tee -a "$LOG_FILE"; }

# Sanity checks
if [ ! -f "$COMPOSE_FILE" ]; then
  log "ERROR: $COMPOSE_FILE not found"
  exit 1
fi

# 1. Pull the new image
log "Pulling ${IMAGE_NAME}:${TAG}..."
if ! docker pull "${IMAGE_NAME}:${TAG}" 2>>"$LOG_FILE"; then
  log "ERROR: docker pull failed"
  exit 1
fi

# 2. Get the resolved image digest (the actual image ID, not the tag)
NEW_DIGEST=$(docker inspect --format='{{index .RepoDigests 0}}' "${IMAGE_NAME}:${TAG}" 2>/dev/null | sed 's|@|/|' | awk -F'/' '{print $NF}')
if [ -z "$NEW_DIGEST" ]; then
  log "ERROR: couldn't resolve image digest for ${IMAGE_NAME}:${TAG}"
  exit 1
fi

# 3. Check if the running container is already on this image (no-op deploy)
CURRENT_IMAGE=$(docker inspect --format='{{.Config.Image}}' "${CONTAINER_UUID}-1" 2>/dev/null \
  || docker ps --format='{{.Image}}' --filter "name=${CONTAINER_UUID}-" | head -1)
if [ "$CURRENT_IMAGE" = "${IMAGE_NAME}@${NEW_DIGEST}" ]; then
  log "Already on ${NEW_DIGEST} — no-op"
  exit 0
fi

log "Current image: $CURRENT_IMAGE"
log "New image:     ${IMAGE_NAME}@${NEW_DIGEST}"

# 4. Update the compose file
# Tag the image with the local Coolify image name (Coolify expects this naming).
# Use a short hash (first 12 hex chars of sha256) for the Coolify tag to stay
# within Docker's tag format constraints.
SHORT_HASH=$(echo "$NEW_DIGEST" | sed 's/^sha256://' | cut -c1-12)
LOCAL_IMAGE="zgsckw0ggsco8sogowk40s0s:${SHORT_HASH}"
docker tag "${IMAGE_NAME}:${TAG}" "$LOCAL_IMAGE"

# Patch the compose file
python3 -c "
import re
with open('$COMPOSE_FILE') as f:
    c = f.read()
new = re.sub(r\"image:\\s*'zgsckw0ggsco8sogowk40s0s:[a-f0-9]+'\", \"image: '$LOCAL_IMAGE'\", c)
with open('$COMPOSE_FILE', 'w') as f:
    f.write(new)
print('compose updated to $LOCAL_IMAGE')
"

# 5. Restart the stack
log "Restarting with new image..."
cd "$APP_DIR"
docker compose up -d 2>>"$LOG_FILE"

# 6. Wait for healthy
log "Waiting for container to become healthy..."
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 5
  STATUS=$(docker inspect --format='{{.State.Health.Status}}' "${CONTAINER_UUID}-1" 2>/dev/null \
    || docker ps --format='{{.Names}} {{.Status}}' --filter "name=${CONTAINER_UUID}-" | head -1)
  if echo "$STATUS" | grep -q "(healthy)"; then
    log "Container healthy after ${i}*5s"
    log "Deploy complete: $LOCAL_IMAGE"
    exit 0
  fi
done

log "WARNING: Container did not become healthy in 50s. Check: docker ps | grep $CONTAINER_UUID"
exit 1
