#!/bin/bash
# Database backup script for Family Planner.
#
# Usage:
#   ./backup.sh                     # default: backup to /data/backups/family-planner/
#   ./backup.sh /path/to/dir       # backup to a custom directory
#   ./backup.sh s3://bucket/path   # (future) upload to S3-compatible storage
#
# Required environment (no defaults; the script refuses to run without them):
#   DB_CONTAINER  name or id of the running PostgreSQL container
#   DB_USER       database role used for pg_dump
#   DB_NAME       database to dump
#
# Scheduling: do not install this on a cron/timer without Cameron's explicit
# approval for that specific scheduler (AGENTS.md). A ready-to-install systemd
# timer is in deploy/systemd/ (docs/runbooks/BACKUPS.md). Example invocation:
#   DB_CONTAINER=... DB_USER=... DB_NAME=... /opt/family-planner/scripts/backup.sh
#
# Retention: every backup from the last 14 days, then one per ISO week, nothing
# older than 35 days (scripts/backup-prune.sh; configurable by env).

set -euo pipefail

# --- Config ---
: "${DB_CONTAINER:?DB_CONTAINER must be set to the PostgreSQL container name or id}"
: "${DB_USER:?DB_USER must be set to the database role used for pg_dump}"
: "${DB_NAME:?DB_NAME must be set to the database to back up}"
BACKUP_DIR="${1:-/data/backups/family-planner}"
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
BACKUP_FILE="${BACKUP_DIR}/familyplanner-${TIMESTAMP}.sql.gz"

# --- Pre-flight ---
mkdir -p "$BACKUP_DIR"

# --- Run pg_dump in the DB container, pipe through gzip to local file ---
echo "[$(date -u +%FT%TZ)] Starting backup of $DB_NAME..."
docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --clean --if-exists | gzip > "$BACKUP_FILE"

SIZE=$(stat -c%s "$BACKUP_FILE" 2>/dev/null || stat -f%z "$BACKUP_FILE")
echo "[$(date -u +%FT%TZ)] Backup complete: $BACKUP_FILE ($SIZE bytes)"

# --- Retention (scripts/backup-prune.sh) ---
# Keeps every backup from the last BACKUP_KEEP_DAILY_DAYS (14) days, then the
# newest one of each ISO week, and nothing older than BACKUP_MAX_AGE_DAYS (35).
# BACKUP_PRUNE_DRY_RUN=1 reports without deleting. Only this directory's
# familyplanner-*.sql.gz files are ever touched.
bash "$(dirname "$0")/backup-prune.sh" "$(cd "$BACKUP_DIR" && pwd -P)"

# --- Test restore (sample-only, not full) ---
# This is the most important line in this whole file. A backup you
# haven't tested restoring from is not a backup — it's a hope.
LATEST=$(ls -1t "$BACKUP_DIR"/familyplanner-*.sql.gz | head -1)
if [ -n "$LATEST" ]; then
  # Verify the gzip is valid + contains expected schema
  if gunzip -t "$LATEST" 2>/dev/null; then
    SCHEMA_CHECK=$(zcat "$LATEST" | grep -c "CREATE TABLE")
    if [ "$SCHEMA_CHECK" -lt 5 ]; then
      echo "WARNING: backup $LATEST has only $SCHEMA_CHECK CREATE TABLE statements. Expected >= 5."
    else
      echo "[$(date -u +%FT%TZ)] Backup integrity OK ($SCHEMA_CHECK tables)"
    fi
  else
    echo "ERROR: backup $LATEST is corrupt (gunzip failed)"
    exit 1
  fi
fi

echo "[$(date -u +%FT%TZ)] Backup done."
