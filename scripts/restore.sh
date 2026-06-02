#!/bin/bash
# Database restore script for Family Planner.
#
# Usage:
#   ./restore.sh                                    # restore most recent backup
#   ./restore.sh /path/to/backup.sql.gz             # restore specific backup
#   ./restore.sh /path/to/backup.sql.gz --force    # skip confirmation prompt
#
# WARNING: this will OVERWRITE the current database. Use with care.
# The app must be stopped during restore to avoid race conditions.

set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-b0gw8s0co0sk0og8084o4kws}"
DB_USER="${DB_USER:-glowos}"
DB_NAME="${DB_NAME:-familyplanner}"
BACKUP_DIR="${1:-/data/backups/family-planner}"

# Resolve which backup to use
if [ -n "${1:-}" ] && [ -f "$1" ]; then
  BACKUP_FILE="$1"
elif [ -n "${1:-}" ] && [ -d "$1" ]; then
  # First arg is a directory — pick latest
  BACKUP_FILE=$(ls -1t "$BACKUP_DIR"/familyplanner-*.sql.gz 2>/dev/null | head -1)
else
  BACKUP_FILE=$(ls -1t "$BACKUP_DIR"/familyplanner-*.sql.gz 2>/dev/null | head -1)
fi

if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
  echo "ERROR: no backup found in $BACKUP_DIR"
  echo "Usage: $0 [/path/to/backup.sql.gz]"
  exit 1
fi

# Confirm unless --force
if [ "${2:-}" != "--force" ]; then
  echo "About to restore from: $BACKUP_FILE"
  echo "This will OVERWRITE the current $DB_NAME database."
  read -p "Type 'yes' to continue: " confirm
  if [ "$confirm" != "yes" ]; then
    echo "Aborted."
    exit 1
  fi
fi

echo "[$(date -u +%FT%TZ)] Restoring from $BACKUP_FILE..."

# Restore in the DB container. The dump uses --clean --if-exists so
# it drops existing objects before recreating them.
gunzip -c "$BACKUP_FILE" | docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME"

echo "[$(date -u +%FT%TZ)] Restore complete."
echo "Verify with: docker exec $DB_CONTAINER psql -U $DB_USER -d $DB_NAME -c '\\dt'"
