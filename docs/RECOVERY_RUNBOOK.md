# Family Planner recovery runbook

## Release requirement

Every release candidate must pass `scripts/recovery-rehearsal.sh` inside the
Ashbi release gate. The rehearsal uses the same `backup.sh` and `restore.sh`
commands as operations, deliberately drops a probe table, restores the dump,
and verifies both the probe and schema table count. It refuses to run against a
Docker container without a `family-planner.ci.run-id` label.

This automated rehearsal proves the mechanics of backup and database restore.
It does not authorize restoring production or replace a pre-deployment backup.

## Pre-deployment backup

1. Record the exact candidate commit and immutable image digest.
2. Record the currently running image digest as the rollback target.
3. Run `scripts/backup.sh` against the production database container.
4. Record the backup path, UTC timestamp, byte size, and SHA-256 checksum.
5. Copy the backup to access-controlled storage outside the application host.
6. Restore that exact file into an isolated, CI-labeled PostgreSQL container.
7. Run migrations and authenticated smoke checks against the isolated restore.

Do not promote the candidate if any evidence is missing or the isolated restore
does not reconcile.

## Application rollback

The currently recorded rollback artifact is
`family-planner@sha256:7520c08a82282a450c40469830c09cb8712cc936fd568a1b5556b519fcdca698`
(production commit `9c9e315`). The Ashbi gate boots this exact digest against
the fully migrated disposable database and requires a connected health check.
After an approved production deployment and rollback-window verification,
update this digest in `.github/workflows/ci.yml` to the newly superseded image.

1. Stop promotion and preserve failing-container logs.
2. Redeploy the recorded prior immutable image digest; never rely on a mutable
   `latest` tag.
3. If the release changed data incompatibly, stop application writes and use
   `scripts/restore.sh <verified-backup.sql.gz> --force` only after confirming
   the exact production database target.
4. Verify `/api/health`, the parent-to-child core loop, and role/cross-family
   isolation before reopening access.
5. Record the restored image digest, backup checksum when used, verification
   results, and incident owner.

Production restore and rollback are destructive operations and always require
explicit approval for the exact database, backup, and image digest.
