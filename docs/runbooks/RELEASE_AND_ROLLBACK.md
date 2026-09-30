# Release & Rollback Runbook

This runbook defines evidence and sequencing. It does not authorize a production release.

## Candidate requirements
Before asking for production approval, record:
- exact Git commit SHA;
- immutable server image/artifact identity;
- Android APK/AAB versionCode/versionName and artifact identity when applicable;
- successful applicable Definition of Done gates;
- migration/backfill plan and rehearsal evidence;
- backup freshness and isolated restore evidence for risky data changes;
- role/two-family negative tests;
- representative UI/device QA;
- known issues and rollback limitations.

## Promotion principle
Promote the exact reviewed artifact. Do not rebuild different code during production promotion.

## Server rollout
1. Confirm approval applies to exact candidate.
2. Confirm prior healthy artifact/rollback target is retained.
3. Confirm DB compatibility with both new and supported old clients.
4. Apply only approved migration sequence.
5. Promote candidate.
6. Verify release identity, health, DB connectivity, logs and core smoke.
7. Verify negative authorization cases using disposable/safe data as approved.
8. Remove disposable QA data.
9. Record outcome.

## Android rollout
Use internal/closed/staged tracks before broad release as planned in #138. Verify install/update from prior supported version, app links, cold/warm start, process restart and server compatibility.

## Halt/rollback triggers
Examples:
- cross-family exposure;
- authentication/session failure;
- destructive data corruption;
- material crash/ANR regression;
- core household mutation failure above release threshold;
- incompatible installed Android client behaviour;
- migration failure or unexpected load.

## Rollback
- Stop rollout/disable feature via approved kill switch when available.
- Roll server to the last healthy compatible artifact when safe.
- Do not automatically roll back database schema/data unless the migration runbook proves it safe.
- For Android, halt staged rollout; server must remain compatible with already-updated and not-yet-updated clients.
- Re-verify health and data integrity after rollback.

## Recovery rehearsal (automated restore and rollback-forward drill)

`scripts/recovery-rehearsal.sh` (#288) proves the backup and restore scripts and the migration path work together, on throwaway databases only. It never touches production and cannot be pointed at it: it refuses (exit 3, before any connection) unless both database names match `fp_rehearsal_*`, neither contains a production marker, `NODE_ENV` is not `production` (in any case or spacing), and the host is loopback, or `postgres` inside GitHub Actions. An inherited `DATABASE_URL` is ignored. A run that passed every step still fails if a database it created cannot be dropped (exit 4, `droppedOnExit: false` in the report) or the report cannot be written (exit 5).

What it does:

1. Creates a fresh `fp_rehearsal_<run>_src` database and runs `scripts/migrate.js`.
2. Seeds the deterministic two-household fixtures (`npm run fixtures:seed`, #154), then runs `migrate.js` again. Its backfills (default budget categories, chore assignments) put the database in the same steady state a production container restart leaves.
3. Backs it up with `scripts/backup.sh` (unchanged).
4. Restores that dump with `scripts/restore.sh` (unchanged) into a fresh `fp_rehearsal_<run>_dst`. Any `ERROR:` from `psql` fails the step, because `restore.sh` itself does not stop on SQL errors.
5. Compares every public table's row count and md5 checksum (rows ordered by their text form), plus a schema description (columns, types, defaults, indexes, constraints), between the source and the restored copy.
6. Runs `migrate.js` twice on the restored copy. Data and schema must be unchanged after each run (idempotent rollback-forward onto a restored database).
7. Reads the restored copy through the app's Prisma client (`scripts/recovery-rehearsal-smoke.mjs`). It runs the `/api/health` readiness query, reads both households and their members, checks that a fixture parent's password still verifies, checks that no Family A member is attached to Family B, and reads events, chores, lists and meals.

Both databases and the dump are dropped/deleted on exit, pass or fail.

`backup.sh` and `restore.sh` run `pg_dump`/`psql` through `docker exec`. In CI the rehearsal sets `REHEARSAL_DB_CONTAINER` to the Postgres service container, so they run exactly as on the VPS. Locally, without that variable, a shim that accepts only `docker exec <sentinel>` runs the same commands against `PGHOST`, so your `pg_dump` must be the server's major version or newer.

Run it locally (Postgres on localhost; `pg_ctlcluster 16 main start` if it is stopped):

```bash
PGPASSWORD=postgres scripts/recovery-rehearsal.sh               # full drill (about 15 s)
scripts/recovery-rehearsal.sh --guard-only                      # check the target guard only
REHEARSAL_SOURCE_DB=family_planner scripts/recovery-rehearsal.sh  # refused, exit 3
```

Inputs are the standard `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD` (defaults `localhost`/`5432`/`postgres`), plus optional `REHEARSAL_RUN_ID`, `REHEARSAL_SOURCE_DB`, `REHEARSAL_RESTORE_DB`, `REHEARSAL_REPORT_DIR` (default `./recovery-rehearsal-report`, git-ignored) and `REHEARSAL_COMMIT` (recorded in the report; CI uses `GITHUB_SHA`).

Evidence it produces, in the report directory:

- `SUMMARY.md` is the human summary: overall PASS/FAIL, dump size and sha256, `identical/total` tables, total rows on each side, schema fingerprints, one line per step with its time, and the smoke checks.
- `recovery-rehearsal.json` (`schema: family-planner/recovery-rehearsal@1`) is the machine-readable report. Check `status` (`pass`/`fail`) and `failedStep`. `totals.tablesMatching` must equal `totals.tables`. `tables[]` gives per table `sourceRows`, `restoredRows`, both md5s, `match` and `unchangedAfterRemigrate`. `schemaFingerprint` has the source, restored and after-re-migrate values, which must all be equal. `smoke.checks[]` lists the smoke results.
- `logs/` holds one log per step, the per-table inventories (`*.tables.txt`) and schema descriptions (`*.schema.txt`). On failure, read the failed step's log first. A diff between two inventories names the exact table that differs.

CI runs the drill in `release.yml` `Build & Test` ("Rehearse backup restore and rollback-forward") and uploads the directory as the `recovery-rehearsal-report-<sha>` artifact, kept for 30 days.

What it does not prove: that the production backups exist, are fresh, or restore. It rehearses the scripts and the schema on synthetic data in an isolated Postgres. Before a risky data change, the owner still restores a real, current production backup into an isolated database and records the result (see `docs/engineering/CI_AND_RELEASE.md`, "Release limitations").

## Post-release
Record exact versions, evidence, incidents and follow-up issues. A successful deployment claim requires observed runtime verification, not CI alone.

## Approval boundary
Merge approval, deployment approval and Play production publication are separate approvals.