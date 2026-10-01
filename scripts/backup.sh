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

# --- Run pg_dump in the DB container, pipe through gzip to a .partial file ---
# The dump is written under a temporary name and only renamed to its final
# familyplanner-*.sql.gz name after it is verified. A dump that fails midway
# therefore never looks like a valid backup to backup-prune.sh (which always
# keeps the newest backup) or to restore.sh (which picks the newest backup).
PARTIAL_FILE="${BACKUP_FILE}.partial"
cleanup_partial() { rm -f "$PARTIAL_FILE"; }
trap cleanup_partial EXIT
trap 'exit 130' INT TERM

echo "[$(date -u +%FT%TZ)] Starting backup of $DB_NAME..."
if ! docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --clean --if-exists | gzip >"$PARTIAL_FILE"; then
  echo "ERROR: pg_dump of $DB_NAME failed; no backup was written" >&2
  exit 1
fi

# --- Verify before publishing ---
# This is the most important part of this whole file. A backup you haven't
# checked is not a backup, it's a hope. (A full restore is rehearsed by
# scripts/recovery-rehearsal.sh.)
if ! gunzip -t "$PARTIAL_FILE" 2>/dev/null; then
  echo "ERROR: backup is corrupt (gunzip failed); no backup was written" >&2
  exit 1
fi
# pg_dump writes this trailer as its last line only when the dump finished.
if ! gunzip -c "$PARTIAL_FILE" | tail -n 5 | grep -q '^-- PostgreSQL database dump complete'; then
  echo "ERROR: backup is truncated (no 'PostgreSQL database dump complete' trailer); no backup was written" >&2
  exit 1
fi
# grep -c prints 0 but exits 1 when nothing matches; under pipefail that must
# not abort the script.
SCHEMA_CHECK=$({ gunzip -c "$PARTIAL_FILE" | grep -c "CREATE TABLE"; } || true)
SCHEMA_CHECK="${SCHEMA_CHECK:-0}"

mv -f "$PARTIAL_FILE" "$BACKUP_FILE"
trap - EXIT

SIZE=$(stat -c%s "$BACKUP_FILE" 2>/dev/null || stat -f%z "$BACKUP_FILE")
echo "[$(date -u +%FT%TZ)] Backup complete: $BACKUP_FILE ($SIZE bytes)"
if [ "$SCHEMA_CHECK" -lt 5 ]; then
  echo "WARNING: backup $BACKUP_FILE has only $SCHEMA_CHECK CREATE TABLE statements. Expected >= 5."
else
  echo "[$(date -u +%FT%TZ)] Backup integrity OK ($SCHEMA_CHECK tables)"
fi

# --- Retention (scripts/backup-prune.sh) ---
# Keeps every backup from the last BACKUP_KEEP_DAILY_DAYS (14) days, then the
# newest one of each ISO week, and nothing older than BACKUP_MAX_AGE_DAYS (35).
# BACKUP_PRUNE_DRY_RUN=1 reports without deleting. Only this directory's
# familyplanner-*.sql.gz files are ever touched (never *.partial files).
bash "$(dirname "$0")/backup-prune.sh" "$(cd "$BACKUP_DIR" && pwd -P)"

echo "[$(date -u +%FT%TZ)] Backup done."
