#!/bin/bash
# Backup retention for Family Planner (#145). Called by scripts/backup.sh after
# each backup; can also be run on its own.
#
# Usage:
#   scripts/backup-prune.sh /data/backups/family-planner
#   BACKUP_PRUNE_DRY_RUN=1 scripts/backup-prune.sh /data/backups/family-planner
#
# Rules (ages come from the timestamp in the file name, not the file's mtime):
#   - younger than BACKUP_KEEP_DAILY_DAYS (default 14): every backup is kept;
#   - from then up to BACKUP_MAX_AGE_DAYS (default 35): the newest backup of
#     each ISO week is kept, the others are deleted;
#   - older than BACKUP_MAX_AGE_DAYS: deleted;
#   - the newest backup is never deleted, whatever its age.
# 35 days is the "about five weeks" promised on the privacy page and in
# docs/product/ACCOUNT_DELETION.md. Changing it changes that promise.
#
# Safety:
#   - only regular files directly inside the directory, named exactly
#     familyplanner-YYYYMMDDTHHMMSSZ.sql.gz, are ever considered. Anything else
#     (other names, symlinks, subdirectories) is left alone;
#   - the directory must be an absolute path to an existing directory, and not /;
#   - BACKUP_PRUNE_DRY_RUN=1 prints what would be deleted and deletes nothing.
#
# BACKUP_PRUNE_NOW (epoch seconds) overrides "now"; it exists for tests.

set -euo pipefail

DIR="${1:-}"
KEEP_DAILY_DAYS="${BACKUP_KEEP_DAILY_DAYS:-14}"
MAX_AGE_DAYS="${BACKUP_MAX_AGE_DAYS:-35}"
DRY_RUN="${BACKUP_PRUNE_DRY_RUN:-0}"
NOW="${BACKUP_PRUNE_NOW:-$(date -u +%s)}"

log() { echo "[$(date -u +%FT%TZ)] prune: $*"; }
fail() {
  echo "prune: REFUSED: $*" >&2
  exit 2
}

[ -n "$DIR" ] || fail "no backup directory given"
case "$DIR" in
  /*) ;;
  *) fail "backup directory must be an absolute path: $DIR" ;;
esac
[ -d "$DIR" ] && [ ! -L "$DIR" ] || fail "not a directory (or a symlink): $DIR"
DIR="$(cd "$DIR" && pwd -P)"
[ "$DIR" != "/" ] || fail "refusing to prune /"
for n in "$KEEP_DAILY_DAYS" "$MAX_AGE_DAYS" "$NOW"; do
  [[ "$n" =~ ^[0-9]+$ ]] || fail "retention settings must be whole numbers: $n"
done
[ "$MAX_AGE_DAYS" -ge "$KEEP_DAILY_DAYS" ] || fail "BACKUP_MAX_AGE_DAYS must be >= BACKUP_KEEP_DAILY_DAYS"
[ "$MAX_AGE_DAYS" -ge 1 ] || fail "BACKUP_MAX_AGE_DAYS must be at least 1"
case "$DRY_RUN" in 0 | 1) ;; *) fail "BACKUP_PRUNE_DRY_RUN must be 0 or 1" ;; esac

NAME_RE='^familyplanner-([0-9]{4})([0-9]{2})([0-9]{2})T([0-9]{2})([0-9]{2})([0-9]{2})Z\.sql\.gz$'

# "epoch<TAB>name" for each candidate, newest first.
entries=()
while IFS= read -r -d '' path; do
  name="${path##*/}"
  [[ "$name" =~ $NAME_RE ]] || continue
  [ -f "$path" ] && [ ! -L "$path" ] || continue
  r=("${BASH_REMATCH[@]}")
  epoch=$(date -u -d "${r[1]}-${r[2]}-${r[3]} ${r[4]}:${r[5]}:${r[6]}" +%s 2>/dev/null) || continue
  entries+=("$epoch"$'\t'"$name")
done < <(find "$DIR" -mindepth 1 -maxdepth 1 -type f -name 'familyplanner-*.sql.gz' -print0)

if [ "${#entries[@]}" -eq 0 ]; then
  log "no backups in $DIR"
  exit 0
fi

mapfile -t sorted < <(printf '%s\n' "${entries[@]}" | sort -r -n -k1,1)

daily_cutoff=$((NOW - KEEP_DAILY_DAYS * 86400))
max_cutoff=$((NOW - MAX_AGE_DAYS * 86400))
declare -A week_kept=()
kept=0
deleted=0
first=1

for line in "${sorted[@]}"; do
  epoch="${line%%$'\t'*}"
  name="${line#*$'\t'}"
  reason=""
  if [ "$first" -eq 1 ]; then
    first=0
  elif [ "$epoch" -lt "$max_cutoff" ]; then
    reason="older than $MAX_AGE_DAYS days"
  elif [ "$epoch" -lt "$daily_cutoff" ]; then
    week=$(date -u -d "@$epoch" +%G-W%V)
    if [ -n "${week_kept[$week]:-}" ]; then
      reason="not the newest backup of $week"
    fi
  fi
  if [ "$epoch" -lt "$daily_cutoff" ]; then
    week_kept[$(date -u -d "@$epoch" +%G-W%V)]=1
  fi

  if [ -z "$reason" ]; then
    kept=$((kept + 1))
  elif [ "$DRY_RUN" = 1 ]; then
    log "would delete $name ($reason)"
    deleted=$((deleted + 1))
  else
    log "deleting $name ($reason)"
    rm -f -- "$DIR/$name"
    deleted=$((deleted + 1))
  fi
done

if [ "$DRY_RUN" = 1 ]; then
  log "dry run: $kept kept, $deleted would be deleted in $DIR"
else
  log "$kept kept, $deleted deleted in $DIR"
fi
