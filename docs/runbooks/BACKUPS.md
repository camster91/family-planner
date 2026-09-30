# Scheduled Database Backups

Owner runbook for #145. Everything here is **ready but not installed**. Installing the timer is a new scheduler on the production host, so it needs Cameron's explicit approval for that exact action (`AGENTS.md`). Agents must not install, enable or run it on a real host.

## What is in the repository

| File                                           | What it does                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `scripts/backup.sh`                            | `pg_dump` inside the database container, gzip, prune, then an integrity check of the newest file |
| `scripts/backup-prune.sh`                      | Retention (below). Called by `backup.sh`; can be run on its own                                  |
| `scripts/restore.sh`                           | Restores one backup into a database. **Overwrites** that database                                |
| `deploy/systemd/family-planner-backup.service` | Runs `backup.sh` once, as a sandboxed oneshot job                                                |
| `deploy/systemd/family-planner-backup.timer`   | Starts the service daily at 03:15 host time plus up to 30 minutes of random delay                |

CI already proves the scripts work: every `Build & Test` run backs up and restores a throwaway database (`docs/runbooks/RELEASE_AND_ROLLBACK.md`, "Recovery rehearsal"). CI does not prove production backups exist.

## Retention

Backup file names carry their UTC time (`familyplanner-20260930T031500Z.sql.gz`). `backup-prune.sh` uses that time, not the file date:

- every backup from the last **14 days** is kept (`BACKUP_KEEP_DAILY_DAYS`);
- from 14 to **35 days**, only the newest backup of each week is kept;
- anything older than 35 days is deleted (`BACKUP_MAX_AGE_DAYS`);
- the newest backup is never deleted.

With one backup a day that is about 17 to 18 files. 35 days is the "about five weeks" the privacy page and `docs/product/ACCOUNT_DELETION.md` promise for deleted data in backups. Raising it breaks that promise, so update both if you change it.

Safety: it only looks at files directly in the backup directory named exactly like above. Other files, symlinks and subfolders are never touched. It refuses a relative path, a missing directory or `/`. `BACKUP_PRUNE_DRY_RUN=1` prints what it would delete and deletes nothing.

```bash
BACKUP_PRUNE_DRY_RUN=1 /opt/family-planner/scripts/backup-prune.sh /data/backups/family-planner
```

Tests: `src/__tests__/backup-prune.test.ts`.

## Install (owner step, needs approval)

On the production host, as root:

1. Find the database container name and the database role and name. Do not paste them into GitHub.

   ```bash
   docker ps --format '{{.Names}}\t{{.Image}}' | grep -i postgres
   ```

2. Copy the scripts and units from the reviewed commit (both scripts must sit in the same folder):

   ```bash
   install -d -m 0755 /opt/family-planner/scripts /opt/family-planner/config
   install -m 0755 scripts/backup.sh scripts/backup-prune.sh scripts/restore.sh /opt/family-planner/scripts/
   install -m 0644 deploy/systemd/family-planner-backup.service deploy/systemd/family-planner-backup.timer /etc/systemd/system/
   install -d -m 0700 /data/backups/family-planner
   ```

3. Create the settings file. It holds names, not passwords, but keep it private:

   ```bash
   install -m 0600 /dev/null /opt/family-planner/config/backup.env
   # then add three lines:
   #   DB_CONTAINER=<container name>
   #   DB_USER=<database role>
   #   DB_NAME=<database name>
   # optional: BACKUP_PRUNE_DRY_RUN=1 for the first week
   ```

4. Run it once by hand and read the log:

   ```bash
   systemctl daemon-reload
   systemctl start family-planner-backup.service
   journalctl -u family-planner-backup -n 50 --no-pager
   ls -l /data/backups/family-planner
   ```

   Expect `Backup complete`, a `prune:` line and `Backup integrity OK (N tables)`. The file should be `-rw-------`.

5. Do the restore test below. Only then turn on the timer:

   ```bash
   systemctl enable --now family-planner-backup.timer
   systemctl list-timers family-planner-backup.timer
   ```

## Restore test (do this before trusting the backups, then monthly)

Restore into a **separate throwaway database**, never the live one. `restore.sh` overwrites whatever `DB_NAME` points at.

```bash
. /opt/family-planner/config/backup.env
LATEST=$(ls -1t /data/backups/family-planner/familyplanner-*.sql.gz | head -1)
docker exec "$DB_CONTAINER" createdb -U "$DB_USER" fp_restore_test
DB_CONTAINER="$DB_CONTAINER" DB_USER="$DB_USER" DB_NAME=fp_restore_test \
  /opt/family-planner/scripts/restore.sh "$LATEST" --force 2>&1 | grep -c '^ERROR' || true
```

Then compare a few row counts between the live database and the copy (counts only, no content):

```bash
for t in '"Family"' '"User"' '"Chore"' '"Event"'; do
  echo "$t live=$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -Atc "select count(*) from $t") \
restored=$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d fp_restore_test -Atc "select count(*) from $t")"
done
docker exec "$DB_CONTAINER" dropdb -U "$DB_USER" fp_restore_test
```

Pass: no `ERROR` lines and matching counts (small differences are fine if people used the app since the backup). Record the date, backup file name, table count and PASS/FAIL in the release notes. Do not record household content.

## Turn it off

```bash
systemctl disable --now family-planner-backup.timer
```

Existing backups stay until you delete them. They contain every household's data.

## Known gaps (owner decisions)

- **Same host only.** Backups sit on the server they protect. A disk or host loss loses both. Copying them off the host (another server or object storage) is a separate decision: it may cost money and adds a data processor.
- **Uploaded photos are not backed up.** `backup.sh` dumps the database only. Chore photos live in the upload directory (`/opt/family-planner/uploads` by default, see `.github/scripts/deploy-vps.sh`).
- **No alert on failure.** A failed run shows as a failed unit (`systemctl --failed`) and in the journal. Nobody is paged. Check `systemctl list-timers` and the newest file date during the weekly beta scorecard (`docs/product/BETA_OPERATIONS.md`).

## Alternative: Coolify scheduled backups

If production moves to Coolify, its built-in scheduled database backups (with retention and optional S3 upload) can replace this timer. Use one or the other, not both. Coolify is not the current deployment (`DEPLOYMENT.md`), and there is no Coolify runbook on `master` yet. The same restore test and the 35-day limit apply either way.
