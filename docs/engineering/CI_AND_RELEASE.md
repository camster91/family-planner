# CI and Release Workflow Map

**Last reconciled:** 2026-09-24 (workflow states re-checked through the GitHub API on 2026-09-29)
**Default branch:** `master` (verify the live repository setting before changing it)

## Workflow ownership

| Workflow | Responsibility | Trigger | External effect |
| --- | --- | --- | --- |
| `release.yml` — `Build & Test` | Locked install, Prisma validation, typecheck, lint, format, unit tests, idempotent migration check, persisted-import and import-reconciliation integration tests, backup/restore/rollback-forward rehearsal (report artifact), production dependency audit, app build, Docker build and readiness smoke test | Pull request, `main`/`master` push, manual dispatch | Validation only |
| `release.yml` — `Release to VPS` | Transfer and promote the verified image for the exact workflow SHA | Manual dispatch on the actual default branch only | Production deployment after `production` environment credentials are configured |
| `e2e.yml` | Playwright journeys, accessibility smoke and visual snapshots (`docs/testing/E2E.md`) | Pull request, `main`/`master` push, manual dispatch | Validation only; informational, not a required check |
| `apk.yml` | Android APK build; signed release build and tagged GitHub Release upload | `main`/`master` push, `v*` tags, manual dispatch | Publishes a GitHub Release for version tags only when the APK is signed; fails the release job otherwise. **Disabled in GitHub (`disabled_manually`) as of 2026-09-29; last run 2026-09-08.** |
| `auto-merge.yml` | Merge a pull request carrying the explicit `auto-merge` label | `pull_request_target` label/change events | Can merge; does not deploy. Disabled in GitHub (`disabled_manually`) as of 2026-09-29 |
| `stale-issues.yml` | Apply the repository's stale-issue policy to issues | Manual dispatch only (no schedule, per AGENTS.md) | Labels and closes inactive issues; never touches pull requests. Disabled in GitHub (`disabled_manually`) as of 2026-09-29 |

The required check name remains exactly `Build & Test`. The former duplicate `ci.yml` validation and unused `build-push.yml` GHCR publication path were removed to keep one owner for application validation and avoid publishing a second, unused release artifact.

All third-party actions in the retained workflows are pinned to full commit SHAs. Workflow-level token permissions default to read; write permissions are scoped to the specific release or automation job that needs them. Checkout does not persist the token into the repository working tree.

## Production boundary

Pull requests and ordinary pushes never deploy and never receive production credentials. A manual workflow dispatch on the actual default branch builds and smoke-tests the container, stores the verified image ID with a short-lived artifact, then transfers that exact image to the VPS over SSH. The VPS verifies the image ID before the existing health-gated container swap. The workflow then requests the public readiness endpoint through the production hostname and requires both HTTP 200 and the expected release commit header. No container is rebuilt on the host, and the workflow withholds host/application logs from public Actions output.

The `production` GitHub Environment must contain:

- Variables: `FP_SSH_HOST`, `FP_SSH_USER`, and optionally `FP_SSH_PORT`.
- Secrets: `FP_SSH_PRIVATE_KEY` and `FP_SSH_KNOWN_HOSTS`.
- A dedicated deploy key, a pinned known-host entry, default-branch-only deployment policy, and a required reviewer.

The SSH account can control Docker and is therefore privileged. Treat its key accordingly, keep it limited to the production environment, and rotate it through the normal owner-controlled credential process.

## Planned Coolify path (not active)

`docs/runbooks/COOLIFY_DEPLOY.md` prepares an owner-run Coolify setup: Dockerfile build pack, Coolify-managed Postgres, `/api/health` health check, uploads volume, the full environment variable table, `TRUSTED_PROXY_HOPS` for Coolify's Traefik, release-commit verification and Coolify rollback. It is not the current production path and changes nothing in `release.yml`. The `Dockerfile` accepts Coolify's `SOURCE_COMMIT` build argument as a fallback when `RELEASE_SHA` is not passed, so `X-Release-Commit` and `/api/version` still name the deployed commit. Switching production to Coolify needs Cameron's approval, and only one of `Release to VPS` or Coolify may own the production hostname; update this document in the same change that switches.

## Android release signing

`android/app/build.gradle` applies a release signing config only when all of `ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` are set. In `apk.yml` these come from repository secrets `ANDROID_KEYSTORE_BASE64` (the base64-encoded keystore, decoded to a temporary file on the runner), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`. Without them the release build is unsigned, uploaded only as a workflow artifact, and the tag `release` job fails instead of publishing it. Whether these secrets exist has not been verified; creating them is an owner-controlled credential change.

## Legacy deploy path (not supported)

`scripts/webhook-receiver.sh` and `scripts/family-planner-webhook.service` implement a pull-based webhook deploy trigger on the host. They predate the `release.yml` SSH release path and are retained only as legacy reference. They must not be installed, enabled or used without Cameron's explicit approval for that exact action (AGENTS.md approval boundaries). If ever used, note that the unit's `docker` supplementary group is root-equivalent on the host, so the webhook secret is effectively a root credential. Whether this unit is installed on any host is unverified.

## Live repository settings observed on 2026-09-24

- The GitHub Actions setting requires live verification. The PR description records it as disabled, while this document previously recorded it as enabled. (Update 2026-09-29: `release.yml` and `e2e.yml` runs on `master` through `cbef026` show Actions is enabled.)
- The repository default workflow token permission was read-only.
- Branch protection requires the strict `Build & Test` check and enforces it for administrators; required pull-request approvals are zero.
- The `production` environment has no required reviewers or deployment-branch restrictions.
- No `FP_SSH_PRIVATE_KEY` or `FP_SSH_KNOWN_HOSTS` secret names are configured at repository or production-environment scope, so the release transport has no confirmed SSH credentials available.

Do not bypass the required `Build & Test` check; it must pass on the exact PR head before merge. Before configuring production credentials, add a required environment reviewer and default-branch deployment restriction, then verify the effective secret scopes. This PR changes no repository settings, secrets, or production credentials.

## Release limitations

The current production image contains application code and is identified by its exact image ID and source SHA. Database backups, isolated restore evidence, schema rollback compatibility, Android signing/release evidence, and a production rollback drill remain separate release gates tracked by issues #84, #85, #102–#110, and #145.

**Closed in CI by #288 (automated, synthetic data):**

- *Isolated restore evidence for the scripts and schema.* Every `Build & Test` run backs up a migrated, fixture-seeded throwaway database with the unchanged `scripts/backup.sh`, restores it with the unchanged `scripts/restore.sh` into a second throwaway database, and requires identical per-table row counts, per-table checksums and schema. The evidence is uploaded as the `recovery-rehearsal-report-<sha>` artifact (runbook: `docs/runbooks/RELEASE_AND_ROLLBACK.md`, "Recovery rehearsal").
- *Rollback-forward drill.* The same run applies `scripts/migrate.js` twice to the restored copy, requires data and schema to be unchanged, and reads the copy through the app's Prisma client (readiness query, both households, a fixture login, household isolation).
- *Import reconciliation.* `src/lib/imports/__tests__/reconciliation.integration.test.ts` requires that, for every supported import source, each source record ends as exactly one provenance row with a live target in the household or one recorded skip, and that each completed `ImportJob`'s stored counts add up.

**Still open, owner-side (not provable in CI):**

- A restore of a *real, current production backup* into an isolated database on or next to the VPS, with row counts compared against production, recorded before any risky data change (#254 contract, production backfill). CI proves the scripts and schema, not that production backups exist, are fresh or restore.
- Backup scheduling and retention on the host. `backup.sh` is not installed on a timer, and any scheduler needs Cameron's explicit approval (AGENTS.md).
- A production rollback drill: redeploying the previous image through `Release to VPS` and verifying health. This needs the production environment credentials and approval.
- Schema *down*-migration. `migrate.js` is forward-only (idempotent, mostly additive; a few guarded column and index drops), so rollback means redeploying the previous image against the expanded schema, or restoring a backup. There is no automated down path.
