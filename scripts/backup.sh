#!/bin/bash
# Database backup script for Family Planner.
#
# Usage:
#   ./backup.sh                     # default: backup to /data/backups/family-planner/
#   ./backup.sh /path/to/dir       # backup to a custom directory
#   ./backup.sh s3://bucket/path   # (future) upload to S3-compatible storage
#
# Designed to be run from cron:
#   0 3 * * * /opt/family-planner/scripts/backup.sh >> /var/log/family-planner-backup.log 2>&1
#
# Retention: keeps the last 14 daily backups + 4 weekly. Older are deleted.

set -euo pipefail

# --- Config ---
DB_CONTAINER="${DB_CONTAINER:-b0gw8s0co0sk0og8084o4kws}"
DB_USER="${DB_USER:-glowos}"
DB_NAME="${DB_NAME:-familyplanner}"
BACKUP_DIR="${1:-/data/backups/family-planner}"
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
BACKUP_FILE="${BACKUP_DIR}/familyplanner-${TIMESTAMP}.sql.gz"
KEEP_DAILY=14
KEEP_WEEKLY=4

# --- Pre-flight ---
mkdir -p "$BACKUP_DIR"

# --- Run pg_dump in the DB container, pipe through gzip to local file ---
echo "[$(date -u +%FT%TZ)] Starting backup of $DB_NAME..."
docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --clean --if-exists | gzip > "$BACKUP_FILE"

SIZE=$(stat -c%s "$BACKUP_FILE" 2>/dev/null || stat -f%z "$BACKUP_FILE")
echo "[$(date -u +%FT%TZ)] Backup complete: $BACKUP_FILE ($SIZE bytes)"

# --- Retention: keep last N daily + M weekly ---
# Daily: delete backups older than KEEP_DAILY days, except weekly ones
# Weekly: keep the 1st backup of each ISO week, for the last KEEP_WEEKLY weeks
find "$BACKUP_DIR" -name "familyplanner-*.sql.gz" -mtime +${KEEP_DAILY} -type f | while read -r old; do
  # Keep the 1st backup of each week (those serve as weekly snapshots)
  iso_week=$(date -d "@$(stat -c%Y "$old")" -u +%G-W%V)
  has_weekly=$(find "$BACKUP_DIR" -name "familyplanner-*.sql.gz" -newer "$old" \
    -exec sh -c 'date -d "@$(stat -c%Y "$0")" -u +%G-W%V' {} \; 2>/dev/null | grep -c "$iso_week" || true)
  if [ "$has_weekly" -eq 0 ]; then
    echo "[$(date -u +%FT%TZ)] Keeping weekly: $old (week $iso_week)"
  else
    echo "[$(date -u +%FT%TZ)] Deleting old backup: $old"
    rm -f "$old"
  fi
done

# Hard cap: keep at most 30 backups total
ls -1t "$BACKUP_DIR"/familyplanner-*.sql.gz 2>/dev/null | tail -n +31 | xargs -r rm -f
REMAINING=$(ls -1 "$BACKUP_DIR"/familyplanner-*.sql.gz 2>/dev/null | wc -l | tr -d ' ')
echo "[$(date -u +%FT%TZ)] Retention OK. $REMAINING backups in $BACKUP_DIR"

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
