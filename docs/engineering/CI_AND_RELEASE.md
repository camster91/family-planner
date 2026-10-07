# CI and Release Workflow Map

**Release route reconciled:** 2026-10-07. Older workflow/configuration observations remain dated below.
**Default branch:** `main` (renamed from `master` on 2026-10-01) (verify the live repository setting before changing it)

## Current production route

Protected `main` plus existing Coolify source builds is the route recorded by deployment records #362/#363/#377. The question about permitting its automatic production deployments for this goal remains unanswered; these records do not supply current approval. GitHub validation checks do not deploy; a merge can separately trigger Coolify's existing Auto Deploy. Record the reviewed green source SHA and merged SHA, then verify `/api/version`, `/api/health`, approved assets and safe journeys. Do not call the Coolify build the checked immutable CI image.

Do not dispatch the retained SSH `Release to VPS` workflow, enable the dormant immutable publisher or change Auto Deploy during this task. #363 is the owner policy decision. This reconciliation changes documentation only; secrets, infrastructure, routing, backup/proxy/security policy and all paused Hermes schedules remain untouched. Candidate-specific evidence and applicable scoped authorization: `COMPLETION_CONTRACT.md`.

## Workflow ownership

### Checked image transport for Coolify preparation (#145)

After the existing build and container readiness gate, `Build & Test` saves the
exact runtime image plus a receipt naming the repository, full source revision,
workflow run/attempt, image configuration ID and archive checksum. The separate
`Checked image on fresh runner` job downloads that artifact, verifies it before
import, and compares the loaded image configuration, filesystem layer identities
and platform with the saved image. It then runs the imported container against a
throwaway PostgreSQL 16 database (the existing VPS major version inspected on
October 1, 2026), complementing the original PostgreSQL 17 CI smoke, and requires
readiness, the baked release header and writable
image-owned uploads directory. The manual `Release to VPS` job also waits for this
transport gate. It continues to transfer the original checked image bundle.

The imported image also runs selected existing login/logout, parent-role and
two-household privacy journeys on all six responsive viewport projects. This
uses a fixed loopback PostgreSQL 16 fixture database and no provider credentials.
The existing E2E clock shim is mounted read-only solely to align synthetic dates;
application code and migrations remain in the saved image. Playwright reuses the
already-started container and never builds another application for this job.
The broad E2E workflow remains separate; the focused image cases complement it.

This prepares artifact transport; it does not publish to a registry or activate
Coolify. Artifact names include the workflow attempt to avoid collisions. The
seven-day Actions artifact is temporary: a full rerun can remove prior artifacts,
so durable image/receipt retention remains required before automatic promotion.
Production backup, restored persistent uploads, authenticated acceptance on the
actual adopted staging resource, routing ownership and registry access remain
separate handoff gates.

`Publish checked image` is a separate, initially disabled publisher: only a push
to the repository's default branch (`github.ref_name ==
github.event.repository.default_branch`, the same rule as `Release to VPS`; today
`main`) with `FP_IMMUTABLE_RELEASE_ENABLED=true` can run it after both the full
build and imported-image security gate pass. It loads and verifies the saved
image, publishes to `ghcr.io/camster91/family-planner` with a source/run/attempt
tag, and records the immutable registry digest. It never runs a Docker build.
Its validated receipt is saved as a draft GitHub release asset and downloaded
again to compare bytes, preserving metadata beyond the Actions rerun lifecycle.
Existing assets must match; they are not overwritten. This publisher has no VPS
credentials and does not deploy or change package visibility. Its flag, actual
registry publication, registry access and production ownership remain separate
activation/handoff steps. `checked-image.py publish` and
`preserve-image-receipt.mjs` repeat the branch check themselves: they refuse
unless `GITHUB_REF` is `refs/heads/$FP_DEFAULT_BRANCH`, which the workflow sets
from `github.event.repository.default_branch`.

| Workflow | Responsibility | Trigger | External effect |
| --- | --- | --- | --- |
| `release.yml` — `Build & Test` | Secret scan (gitleaks, see below), locked install, Prisma validation, typecheck, lint, format, unit tests, idempotent migration check, schema drift check (`prisma migrate diff` of the migrated database against `prisma/schema.prisma`, must be empty), persisted-import and import-reconciliation integration tests, backup/restore/rollback-forward rehearsal (report artifact), production dependency audit, app build, Docker build and readiness smoke test | Pull request, `main`/`master` push, manual dispatch | Validation only |
| `release.yml` — `Release to VPS` | Transfer and promote the verified image for the exact workflow SHA | Manual dispatch on the actual default branch only | Production deployment after `production` environment credentials are configured |
| `e2e.yml` | Playwright journeys, accessibility smoke and visual snapshots (`docs/testing/E2E.md`) | Pull request, `main`/`master` push, manual dispatch | Validation only; informational, not a required check |
| `apk.yml` | Android APK build; signed release build and tagged GitHub Release upload | `main`/`master` push, `v*` tags, manual dispatch | Publishes a GitHub Release for version tags only when the APK is signed; fails the release job otherwise. **Disabled in GitHub (`disabled_manually`) as of 2026-09-29; last run 2026-09-08.** |
| `auto-merge.yml` | Merge a pull request carrying the explicit `auto-merge` label | `pull_request_target` label/change events | Can merge; does not deploy. Disabled in GitHub (`disabled_manually`) as of 2026-09-29 |
| `stale-issues.yml` | Apply the repository's stale-issue policy to issues | Manual dispatch only (no schedule, per AGENTS.md) | Labels and closes inactive issues; never touches pull requests. Disabled in GitHub (`disabled_manually`) as of 2026-09-29 |

### Secret scanning (#136)

The first step after checkout in `Build & Test` runs gitleaks and fails the check on any finding:

- It scans the checked-out tree, then the commits the run adds (pull request: base..head; push: before..after), so a secret added and removed again inside a pull request still fails. The checkout uses `fetch-depth: 0` for this.
- gitleaks is built from source with the runner's Go toolchain: version pinned (`v8.30.1`, tag commit `8d1f98c7`), module content hash compared with the pinned `GITLEAKS_MODULE_SUM` and checked by the Go checksum database. No third-party action, no token, no licence key, no SARIF/report artifact, no PR comment. Output uses `--redact`, so a finding shows the rule, file, line and commit but never the value.
- Config: `.gitleaks.toml` (default rules plus one narrow allowlist for fake `Idempotency-Key` values in test files). Run it locally with `gitleaks dir . --redact --verbose`. A finding on a real credential means rotating it (owner action), not allowlisting it.

The required check name remains exactly `Build & Test`. The former duplicate `ci.yml` validation and unused `build-push.yml` GHCR publication path were removed to keep one owner for application validation and avoid publishing a second, unused release artifact.

All third-party actions in the retained workflows are pinned to full commit SHAs. Workflow-level token permissions default to read; write permissions are scoped to the specific release or automation job that needs them. Checkout does not persist the token into the repository working tree.

## Historical manual SSH production boundary

GitHub validation jobs do not deploy or receive production credentials. Main merges may separately trigger existing Coolify source builds. The retained manual SSH workflow behaves as follows. A manual workflow dispatch on the actual default branch builds and smoke-tests the container, stores the verified image ID with a short-lived artifact, then transfers that exact image to the VPS over SSH. The VPS verifies the image ID before the existing health-gated container swap. The workflow then requests the public readiness endpoint through the production hostname and requires both HTTP 200 and the expected release commit header. No container is rebuilt on the host, and the workflow withholds host/application logs from public Actions output.

The `production` GitHub Environment must contain:

- Variables: `FP_SSH_HOST`, `FP_SSH_USER`, and optionally `FP_SSH_PORT`.
- Secrets: `FP_SSH_PRIVATE_KEY` and `FP_SSH_KNOWN_HOSTS`.
- A dedicated deploy key, a pinned known-host entry, default-branch-only deployment policy, and a required reviewer.

The SSH account can control Docker and is therefore privileged. Treat its key accordingly, keep it limited to the production environment, and rotate it through the normal owner-controlled credential process.

## Existing Coolify source-build path

`docs/runbooks/COOLIFY_DEPLOY.md` records the current scoped route and preserves the dormant immutable-image handoff as a separate owner-gated plan. `SOURCE_COMMIT` is a supported Dockerfile fallback for release identity; read the actual deployed commit from `/api/version`. Only one owner may control the production hostname. No route/policy/settings switch is authorized by this documentation update.

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
- Backup scheduling on the host. A daily systemd timer and retention are ready in `deploy/systemd/` and `scripts/backup-prune.sh` but not installed; installing them needs Cameron's explicit approval (AGENTS.md). Steps: `docs/runbooks/BACKUPS.md`.
- A production rollback drill: redeploying the previous image through `Release to VPS` and verifying health. This needs the production environment credentials and approval.
- Schema *down*-migration. `migrate.js` is forward-only (idempotent, mostly additive; a few guarded column and index drops), so rollback means redeploying the previous image against the expanded schema, or restoring a backup. There is no automated down path.
