#!/usr/bin/env bash
# Prove that Family Planner's real backup and restore scripts recover data.
# This must only be pointed at a disposable database container.

set -Eeuo pipefail

for command in docker mktemp sha256sum; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "ERROR: required command '$command' is unavailable" >&2
    exit 1
  fi
done

db_container="${DB_CONTAINER:-}"
db_user="${DB_USER:-}"
db_name="${DB_NAME:-}"

if [ -z "$db_container" ] || [ -z "$db_user" ] || [ -z "$db_name" ]; then
  echo "ERROR: DB_CONTAINER, DB_USER, and DB_NAME are required" >&2
  exit 1
fi

ci_label="$(docker inspect -f '{{ index .Config.Labels "family-planner.ci.run-id" }}' "$db_container" 2>/dev/null || true)"
if [ -z "$ci_label" ] || [ "$ci_label" = "<no value>" ]; then
  echo "ERROR: refusing to rehearse against an unlabeled database container" >&2
  exit 1
fi

recovery_dir="$(mktemp -d "${TMPDIR:-/tmp}/family-planner-recovery.XXXXXX")"
cleanup() {
  find "$recovery_dir" -type f -delete 2>/dev/null || true
  rmdir "$recovery_dir" 2>/dev/null || true
}
trap cleanup EXIT

probe_id="recovery-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
probe_id="$(printf '%s' "$probe_id" | tr -cd '[:alnum:]-')"

echo "==> Seeding a recovery probe"
docker exec "$db_container" psql -v ON_ERROR_STOP=1 -U "$db_user" -d "$db_name" \
  -c 'CREATE TABLE IF NOT EXISTS recovery_probe (id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now())' \
  -c "INSERT INTO recovery_probe (id) VALUES ('$probe_id') ON CONFLICT (id) DO NOTHING" >/dev/null

echo "==> Capturing a backup with the production backup script"
DB_CONTAINER="$db_container" DB_USER="$db_user" DB_NAME="$db_name" \
  bash scripts/backup.sh "$recovery_dir"

backup_file="$(find "$recovery_dir" -maxdepth 1 -type f -name 'familyplanner-*.sql.gz' -print -quit)"
if [ -z "$backup_file" ]; then
  echo "ERROR: backup script did not create a backup" >&2
  exit 1
fi
backup_size="$(stat -c%s "$backup_file")"
backup_checksum="$(sha256sum "$backup_file" | awk '{print $1}')"
echo "==> Backup evidence: $backup_size bytes, sha256:$backup_checksum"

echo "==> Simulating destructive data loss"
docker exec "$db_container" psql -v ON_ERROR_STOP=1 -U "$db_user" -d "$db_name" \
  -c 'DROP TABLE recovery_probe' >/dev/null

echo "==> Restoring with the production restore script"
DB_CONTAINER="$db_container" DB_USER="$db_user" DB_NAME="$db_name" \
  bash scripts/restore.sh "$backup_file" --force >/dev/null

restored_probe="$(docker exec "$db_container" psql -v ON_ERROR_STOP=1 -U "$db_user" -d "$db_name" -Atc \
  "SELECT id FROM recovery_probe WHERE id = '$probe_id'")"
restored_tables="$(docker exec "$db_container" psql -v ON_ERROR_STOP=1 -U "$db_user" -d "$db_name" -Atc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")"

if [ "$restored_probe" != "$probe_id" ]; then
  echo "ERROR: restored database is missing the recovery probe" >&2
  exit 1
fi
if [ "$restored_tables" -lt 5 ]; then
  echo "ERROR: restored database has only $restored_tables public tables" >&2
  exit 1
fi

echo "==> Recovery rehearsal passed ($restored_tables tables and probe restored)"
