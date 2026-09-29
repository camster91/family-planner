#!/usr/bin/env bash
# Automated restore and rollback-forward rehearsal (#288, PR101 D-7).
#
# Proves, on THROWAWAY databases only, that a Family Planner database can be
# backed up with scripts/backup.sh, restored with scripts/restore.sh into a
# second fresh database, and that the restored copy is identical, still
# migrates forward idempotently and is readable by the application's Prisma
# client.
#
#   1. create a fresh source database and run scripts/migrate.js
#   2. seed the deterministic two-household fixtures (npm run fixtures:seed, #154)
#      and run migrate.js again (its backfills make the steady state production has)
#   3. back it up with scripts/backup.sh
#   4. restore the dump with scripts/restore.sh into a second fresh database
#   5. compare per-table row counts, per-table checksums and a schema fingerprint
#   6. run scripts/migrate.js twice on the restored copy (data and schema must
#      not change after either run)
#   7. smoke-read the restored copy through Prisma (scripts/recovery-rehearsal-smoke.mjs)
#
# Writes <report dir>/recovery-rehearsal.json and <report dir>/SUMMARY.md, and
# drops both databases and deletes the dump on exit (pass or fail).
#
# Usage:
#   scripts/recovery-rehearsal.sh               # full rehearsal
#   scripts/recovery-rehearsal.sh --guard-only  # evaluate the target guard, touch nothing
#
# Environment (standard libpq variables; no production defaults):
#   PGHOST (default localhost)  PGPORT (default 5432)  PGUSER (default postgres)
#   PGPASSWORD                  optional
#   REHEARSAL_RUN_ID            suffix for the database names (default: local_<utc time>_<pid>)
#   REHEARSAL_SOURCE_DB         default fp_rehearsal_<run id>_src
#   REHEARSAL_RESTORE_DB        default fp_rehearsal_<run id>_dst
#   REHEARSAL_REPORT_DIR        default ./recovery-rehearsal-report
#   REHEARSAL_DB_CONTAINER      optional: run backup.sh/restore.sh with a real
#                               `docker exec` into this container (CI service
#                               container). Without it, a local shim runs the
#                               same pg_dump/psql commands against PGHOST.
#
# The guard REFUSES (exit 3) before any connection unless every database name
# matches ^fp_rehearsal_[a-z0-9_]+$, contains no production marker, the two
# names differ, NODE_ENV is not production, and PGHOST is loopback (or the
# `postgres` service name inside GitHub Actions). DATABASE_URL from the caller
# is ignored: every step gets a URL built for the throwaway database.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly REPO_ROOT
readonly GUARD_EXIT=3
readonly NAME_PATTERN='^fp_rehearsal_[a-z0-9_]{1,48}$'

MODE=run
case "${1:-}" in
  "") ;;
  --guard-only) MODE=guard ;;
  *)
    echo "Usage: $0 [--guard-only]" >&2
    exit 2
    ;;
esac

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
unset DATABASE_URL

RUN_ID="${REHEARSAL_RUN_ID:-local_$(date -u +%Y%m%d%H%M%S)_$$}"
SOURCE_DB="${REHEARSAL_SOURCE_DB:-fp_rehearsal_${RUN_ID}_src}"
RESTORE_DB="${REHEARSAL_RESTORE_DB:-fp_rehearsal_${RUN_ID}_dst}"
REPORT_DIR="${REHEARSAL_REPORT_DIR:-$PWD/recovery-rehearsal-report}"
DB_CONTAINER_MODE=shim
if [ -n "${REHEARSAL_DB_CONTAINER:-}" ]; then DB_CONTAINER_MODE=docker; fi

log() { echo "[rehearsal $(date -u +%FT%TZ)] $*"; }

# ---------------------------------------------------------------- guard ----
refuse() {
  echo "REFUSED: recovery rehearsal will not run: $*" >&2
  echo "REFUSED: it only targets throwaway fp_rehearsal_* databases on localhost (or the CI service)." >&2
  exit "$GUARD_EXIT"
}

guard() {
  local name lower
  for name in "$SOURCE_DB" "$RESTORE_DB"; do
    if ! [[ "$name" =~ $NAME_PATTERN ]]; then
      refuse "database name '$name' does not match $NAME_PATTERN"
    fi
    lower="${name,,}"
    if [[ "$lower" == *prod* || "$lower" == *ashbi* ]]; then
      refuse "database name '$name' contains a production marker"
    fi
  done
  if [ "$SOURCE_DB" = "$RESTORE_DB" ]; then
    refuse "source and restore database must differ"
  fi
  # Normalised like src/lib/fixtures/guard.ts: " Production " is still production.
  local node_env
  node_env="$(printf '%s' "${NODE_ENV:-}" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
  if [ "$node_env" = production ]; then
    refuse "NODE_ENV is production"
  fi
  case "${PGHOST,,}" in
    localhost | 127.0.0.1 | ::1 | '[::1]') ;;
    postgres)
      if [ "${GITHUB_ACTIONS:-}" != true ]; then
        refuse "host 'postgres' is only accepted as the GitHub Actions service container"
      fi
      ;;
    *) refuse "host '$PGHOST' is not loopback or the CI service" ;;
  esac
}

guard
log "guard: allowed host=$PGHOST port=$PGPORT source=$SOURCE_DB restore=$RESTORE_DB"
if [ "$MODE" = guard ]; then exit 0; fi

# ------------------------------------------------------------- plumbing ----
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/fp-rehearsal.XXXXXX")"
readonly WORK_DIR
mkdir -p "$REPORT_DIR" "$WORK_DIR/bin" "$WORK_DIR/backups"
STEPS_FILE="$WORK_DIR/steps.tsv"
: >"$STEPS_FILE"
CREATED_DBS_FILE="$WORK_DIR/created-dbs"
: >"$CREATED_DBS_FILE"
CURRENT_STEP=""
STARTED_AT="$(date -u +%FT%TZ)"
START_SECONDS=$SECONDS

psql_admin() { psql -X -v ON_ERROR_STOP=1 -q -tA -d postgres "$@"; }
psql_db() {
  local db="$1"
  shift
  psql -X -v ON_ERROR_STOP=1 -q -tA -d "$db" "$@"
}

db_url() {
  # shellcheck disable=SC2016 # JavaScript template literal, not shell.
  node -e '
    const [user, pass, host, port, db] = process.argv.slice(1);
    const auth = encodeURIComponent(user) + (pass ? ":" + encodeURIComponent(pass) : "");
    const h = host.includes(":") && !host.startsWith("[") ? "[" + host + "]" : host;
    console.log(`postgresql://${auth}@${h}:${port}/${db}`);
  ' "$PGUSER" "${PGPASSWORD:-}" "$PGHOST" "$PGPORT" "$1"
}

record_step() { printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "${4:-}" >>"$STEPS_FILE"; }

# run_step <id> <description> <command...>: logs to $REPORT_DIR/logs/<id>.log
run_step() {
  local id="$1" description="$2" t0 rc
  shift 2
  CURRENT_STEP="$id"
  t0=$SECONDS
  log "step $id: $description"
  # Subshell with errexit so every command inside a step is checked.
  set +e
  (
    set -e
    "$@"
  ) >"$REPORT_DIR/logs/$id.log" 2>&1
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    record_step "$id" fail "$((SECONDS - t0))" "$description (exit $rc; see logs/$id.log)"
    tail -n 30 "$REPORT_DIR/logs/$id.log" >&2 || true
    return "$rc"
  fi
  record_step "$id" pass "$((SECONDS - t0))" "$description"
  CURRENT_STEP=""
}

create_fresh_db() {
  local db="$1" exists
  exists="$(psql_admin -c "SELECT 1 FROM pg_database WHERE datname = '$db'")"
  if [ -n "$exists" ]; then
    echo "database $db already exists; the rehearsal only uses fresh databases" >&2
    return 1
  fi
  psql_admin -c "CREATE DATABASE \"$db\""
  echo "$db" >>"$CREATED_DBS_FILE"
}

# Returns non-zero if any database this run created could not be dropped, so
# the run cannot report PASS while leaving seeded databases behind.
drop_created_dbs() {
  local db failed=0
  while IFS= read -r db; do
    [ -n "$db" ] || continue
    if ! psql_admin -c "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE)" >/dev/null 2>&1; then
      echo "ERROR: could not drop $db" >&2
      failed=1
    fi
  done <"$CREATED_DBS_FILE"
  return "$failed"
}

write_report() {
  local status="$1"
  STATUS="$status" STARTED_AT="$STARTED_AT" FINISHED_AT="$(date -u +%FT%TZ)" \
    DURATION="$((SECONDS - START_SECONDS))" FAILED_STEP="$CURRENT_STEP" \
    REHEARSAL_WORK_DIR="$WORK_DIR" REHEARSAL_OUT_DIR="$REPORT_DIR" SOURCE_DB="$SOURCE_DB" \
    RESTORE_DB="$RESTORE_DB" MODE="$DB_CONTAINER_MODE" GIT_SHA="${REHEARSAL_COMMIT:-${GITHUB_SHA:-unknown}}" \
    CLEANUP_OK="$CLEANUP_OK" \
    node "$REPO_ROOT/scripts/recovery-rehearsal-report.mjs"
}

on_exit() {
  local rc=$?
  trap - EXIT
  # Cleanup runs to the end whatever fails. The databases are dropped first so
  # the report records the real cleanup outcome; a failed drop or a failed
  # report turns a passing rehearsal into a failure (the gate promises both).
  set +e
  CLEANUP_OK=true
  if ! drop_created_dbs; then
    CLEANUP_OK=false
    if [ "$rc" -eq 0 ]; then
      rc=4
      CURRENT_STEP="cleanup"
    fi
  fi
  local status=pass
  [ "$rc" -eq 0 ] || status=fail
  if ! write_report "$status"; then
    echo "ERROR: report generation failed" >&2
    [ "$rc" -eq 0 ] && rc=5 && CURRENT_STEP="report"
  fi
  rm -rf "$WORK_DIR"
  local cleanup_note="databases dropped, dump deleted"
  [ "$CLEANUP_OK" = true ] || cleanup_note="some databases could NOT be dropped, see above; dump deleted"
  if [ "$rc" -eq 0 ]; then
    log "PASS; report in $REPORT_DIR ($cleanup_note)"
  else
    log "FAIL at step '${CURRENT_STEP:-setup}' (exit $rc); report in $REPORT_DIR ($cleanup_note)"
  fi
  exit "$rc"
}
trap on_exit EXIT
trap 'exit 130' INT TERM

rm -rf "$REPORT_DIR/logs"
mkdir -p "$REPORT_DIR/logs"
rm -f "$REPORT_DIR/recovery-rehearsal.json" "$REPORT_DIR/SUMMARY.md"

# backup.sh and restore.sh run pg_dump/psql through `docker exec`. On a host
# without the database container, this shim runs the same command locally
# against PGHOST (and refuses anything but `exec` into the sentinel container).
SHIM_CONTAINER="fp-rehearsal-local"
cat >"$WORK_DIR/bin/docker" <<'SHIM'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" != exec ]; then
  echo "recovery-rehearsal docker shim: only 'docker exec' is supported" >&2
  exit 64
fi
shift
if [ "${1:-}" = -i ]; then shift; fi
if [ "${1:-}" != "$REHEARSAL_SHIM_CONTAINER" ]; then
  echo "recovery-rehearsal docker shim: unexpected container '${1:-}'" >&2
  exit 64
fi
shift
exec "$@"
SHIM
chmod +x "$WORK_DIR/bin/docker"

with_backup_env() {
  if [ "$DB_CONTAINER_MODE" = docker ]; then
    DB_CONTAINER="$REHEARSAL_DB_CONTAINER" DB_USER="$PGUSER" "$@"
  else
    PATH="$WORK_DIR/bin:$PATH" REHEARSAL_SHIM_CONTAINER="$SHIM_CONTAINER" \
      DB_CONTAINER="$SHIM_CONTAINER" DB_USER="$PGUSER" "$@"
  fi
}

# -------------------------------------------------------------- inventory --
# One line per public base table: name|row count|md5 of the rows ordered by
# their text form (order-independent of physical layout).
table_inventory() {
  local db="$1" query
  query="$(psql_db "$db" -c "
    SELECT coalesce(string_agg(format(
      'SELECT %L AS t, count(*) AS n, coalesce(md5(string_agg(x::text, E''\\n'' ORDER BY x::text)), md5('''')) AS h FROM public.%I x',
      table_name, table_name), ' UNION ALL ' ORDER BY table_name), 'SELECT NULL, NULL, NULL WHERE false')
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")"
  psql_db "$db" -F '|' -c "SELECT * FROM ($query) s ORDER BY 1"
}

# Columns, types, nullability, defaults, indexes and constraints, one per line.
schema_description() {
  psql_db "$1" -c "
    SELECT 'column ' || concat_ws(':', table_name, column_name, data_type, udt_name, is_nullable, column_default)
      FROM information_schema.columns WHERE table_schema = 'public'
    UNION ALL
    SELECT 'index ' || indexdef FROM pg_indexes WHERE schemaname = 'public'
    UNION ALL
    SELECT 'constraint ' || conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid)
      FROM pg_constraint WHERE connamespace = 'public'::regnamespace
    ORDER BY 1"
}

snapshot() {
  local db="$1" label="$2"
  table_inventory "$db" >"$WORK_DIR/$label.tables"
  schema_description "$db" >"$WORK_DIR/$label.schema-lines"
  md5sum <"$WORK_DIR/$label.schema-lines" | cut -d' ' -f1 >"$WORK_DIR/$label.schema"
  cp "$WORK_DIR/$label.schema-lines" "$REPORT_DIR/logs/$label.schema.txt"
  cp "$WORK_DIR/$label.tables" "$REPORT_DIR/logs/$label.tables.txt"
}

compare_snapshots() {
  local left="$1" right="$2"
  if ! diff -u "$WORK_DIR/$left.tables" "$WORK_DIR/$right.tables"; then
    echo "per-table counts/checksums differ between $left and $right" >&2
    return 1
  fi
  if ! diff -u "$WORK_DIR/$left.schema-lines" "$WORK_DIR/$right.schema-lines"; then
    echo "schema fingerprint differs between $left and $right" >&2
    return 1
  fi
  echo "identical: $(wc -l <"$WORK_DIR/$left.tables") tables, schema $(cat "$WORK_DIR/$left.schema")"
}

# ------------------------------------------------------------------ steps --
SOURCE_URL="$(db_url "$SOURCE_DB")"
RESTORE_URL="$(db_url "$RESTORE_DB")"

step_migrate_source() {
  create_fresh_db "$SOURCE_DB"
  DATABASE_URL="$SOURCE_URL" node "$REPO_ROOT/scripts/migrate.js"
}

step_seed() {
  (cd "$REPO_ROOT" && DATABASE_URL="$SOURCE_URL" FIXTURES_ALLOW=1 NODE_ENV=test npm run --silent fixtures:seed)
  # migrate.js also backfills derived rows for existing households (default
  # budget categories, chore assignments). Every container start runs it, so a
  # production database is always in this post-migrate steady state.
  DATABASE_URL="$SOURCE_URL" node "$REPO_ROOT/scripts/migrate.js"
  snapshot "$SOURCE_DB" source
}

step_backup() {
  with_backup_env env DB_NAME="$SOURCE_DB" bash "$REPO_ROOT/scripts/backup.sh" "$WORK_DIR/backups"
  local dumps dump
  dumps=("$WORK_DIR"/backups/familyplanner-*.sql.gz)
  if [ "${#dumps[@]}" -ne 1 ] || [ ! -s "${dumps[0]}" ]; then
    echo "expected exactly one non-empty dump from backup.sh, found: ${dumps[*]}" >&2
    return 1
  fi
  dump="${dumps[0]}"
  echo "$dump" >"$WORK_DIR/dump.path"
  stat -c%s "$dump" >"$WORK_DIR/dump.bytes"
  sha256sum "$dump" | cut -d' ' -f1 >"$WORK_DIR/dump.sha256"
}

step_restore() {
  create_fresh_db "$RESTORE_DB"
  with_backup_env env DB_NAME="$RESTORE_DB" bash "$REPO_ROOT/scripts/restore.sh" "$(cat "$WORK_DIR/dump.path")" --force \
    2>&1 | tee "$WORK_DIR/restore.out"
  # restore.sh pipes into psql without ON_ERROR_STOP; any SQL error is a failed restore.
  if grep -E '(^|: )(ERROR|FATAL):' "$WORK_DIR/restore.out"; then
    echo "restore reported SQL errors" >&2
    return 1
  fi
}

step_compare() {
  snapshot "$RESTORE_DB" restored
  compare_snapshots source restored
}

step_migrate_restored() {
  DATABASE_URL="$RESTORE_URL" node "$REPO_ROOT/scripts/migrate.js"
  snapshot "$RESTORE_DB" remigrated_once
  compare_snapshots restored remigrated_once
  DATABASE_URL="$RESTORE_URL" node "$REPO_ROOT/scripts/migrate.js"
  snapshot "$RESTORE_DB" remigrated
  compare_snapshots restored remigrated
}

step_smoke() {
  (cd "$REPO_ROOT" && DATABASE_URL="$RESTORE_URL" node --experimental-strip-types \
    --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --disable-warning=ExperimentalWarning \
    scripts/recovery-rehearsal-smoke.mjs "$WORK_DIR/smoke.json")
}

run_step 1-migrate-source "create $SOURCE_DB and run scripts/migrate.js" step_migrate_source
run_step 2-seed-fixtures "seed deterministic two-household fixtures, then scripts/migrate.js (steady state)" step_seed
run_step 3-backup "scripts/backup.sh ($DB_CONTAINER_MODE)" step_backup
run_step 4-restore "scripts/restore.sh into fresh $RESTORE_DB" step_restore
run_step 5-compare "per-table counts, checksums and schema: source vs restored" step_compare
run_step 6-migrate-restored "scripts/migrate.js twice on the restored copy; data and schema unchanged" step_migrate_restored
run_step 7-smoke "Prisma smoke read of the restored copy" step_smoke
