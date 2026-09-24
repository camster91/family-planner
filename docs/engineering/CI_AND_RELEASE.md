# CI and Release Workflow Map

**Last reconciled:** 2026-09-24
**Default branch:** `master` (verify the live repository setting before changing it)

## Workflow ownership

| Workflow | Responsibility | Trigger | External effect |
| --- | --- | --- | --- |
| `release.yml` — `Build & Test` | Locked install, Prisma validation, typecheck, lint, format, unit tests, idempotent migration check, persisted-import integration test, production dependency audit, app build, Docker build and readiness smoke test | Pull request, `main`/`master` push, manual dispatch | Validation only |
| `release.yml` — `Release to VPS` | Transfer and promote the verified image for the exact workflow SHA | Manual dispatch on the actual default branch only | Production deployment after `production` environment credentials are configured |
| `apk.yml` | Android APK build and tagged GitHub Release upload | `main`/`master` push, `v*` tags, manual dispatch | Publishes a GitHub Release for version tags |
| `auto-merge.yml` | Merge a pull request carrying the explicit `auto-merge` label | `pull_request_target` label/change events | Can merge; does not deploy |
| `stale-issues.yml` | Apply the repository's stale-issue policy | Weekly schedule or manual dispatch | Updates issues and pull requests |

The required check name remains exactly `Build & Test`. The former duplicate `ci.yml` validation and unused `build-push.yml` GHCR publication path were removed to keep one owner for application validation and avoid publishing a second, unused release artifact.

All third-party actions in the retained workflows are pinned to full commit SHAs. Workflow-level token permissions default to read; write permissions are scoped to the specific release or automation job that needs them. Checkout does not persist the token into the repository working tree.

## Production boundary

Pull requests and ordinary pushes never deploy and never receive production credentials. A manual workflow dispatch on the actual default branch builds and smoke-tests the container, stores the verified image ID with a short-lived artifact, then transfers that exact image to the VPS over SSH. The VPS verifies the image ID before the existing health-gated container swap. The workflow then requests the public readiness endpoint through the production hostname and requires both HTTP 200 and the expected release commit header. No container is rebuilt on the host, and the workflow withholds host/application logs from public Actions output.

The `production` GitHub Environment must contain:

- Variables: `FP_SSH_HOST`, `FP_SSH_USER`, and optionally `FP_SSH_PORT`.
- Secrets: `FP_SSH_PRIVATE_KEY` and `FP_SSH_KNOWN_HOSTS`.
- A dedicated deploy key, a pinned known-host entry, default-branch-only deployment policy, and a required reviewer.

The SSH account can control Docker and is therefore privileged. Treat its key accordingly, keep it limited to the production environment, and rotate it through the normal owner-controlled credential process.

## Live repository settings observed on 2026-09-24

- The GitHub Actions setting requires live verification. The PR description records it as disabled, while this document previously recorded it as enabled.
- The repository default workflow token permission was read-only.
- Branch protection requires the strict `Build & Test` check and enforces it for administrators; required pull-request approvals are zero.
- The `production` environment has no required reviewers or deployment-branch restrictions.
- No `FP_SSH_PRIVATE_KEY` or `FP_SSH_KNOWN_HOSTS` secret names are configured at repository or production-environment scope, so the release transport has no confirmed SSH credentials available.

Do not bypass the required `Build & Test` check; it must pass on the exact PR head before merge. Before configuring production credentials, add a required environment reviewer and default-branch deployment restriction, then verify the effective secret scopes. This PR changes no repository settings, secrets, or production credentials.

## Release limitations

The current production image contains application code and is identified by its exact image ID and source SHA. Database backups, isolated restore evidence, schema rollback compatibility, Android signing/release evidence, and a production rollback drill remain separate release gates tracked by issues #84, #85, #102–#110, and #145.
