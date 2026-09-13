# CI and Release Workflow Map

**Last reconciled:** 2026-09-08  
**Canonical branch:** `plan/fridge-tablet-program` / PR #129

This document describes repository workflow intent. GitHub branch-protection settings remain authoritative for required-check enforcement and must be inspected by a repository administrator when the integration cannot read them.

## Pull-request validation

| Workflow file | Workflow / check | Trigger | External effect |
| --- | --- | --- | --- |
| `ci.yml` | CI Build / `Build` | PR and `master` | Validation only |
| `format.yml` | Format / `Format check` | PR and `master` | Validation only |
| `lint.yml` | Lint / `Lint` | PR and `master` | Validation only |
| `deploy-coolify.yml` | Build, Test & Deploy to Coolify / `Build & Test` | PR, `master`, manual | PR/push validates only |
| `build-and-push.yml` | Build and Push Image / `Build & push image` | PR, manual, reusable call | PR/reusable call builds only; manual dispatch may publish |
| `apk.yml` | Build Android APK / `Build APK` | `master`, version tags, manual | Produces artifacts; version tags may create a GitHub release |

Issue #85 records `Ashbi release gate` and `Build & Test` as protected required checks. The repository integration received 403 when reading live protection, so administrators must verify the exact current list before merge.

## Image and deployment ownership

- `build-and-push.yml` is the preferred image path. It never pushes during a pull request or reusable call. GHCR publication requires manual dispatch.
- `build-push.yml` is legacy/reference-only and can run only by manual dispatch.
- `deploy-coolify.yml` is the only active Coolify deployment path. PR and branch events validate only. Deployment requires manual dispatch and the `production` environment.
- `deploy-from-ghcr.yml` is retained only for historical run links and intentionally stops; it cannot deploy.
- `auto-merge.yml` remains label-gated. Adding `auto-merge` is an explicit merge action and does not authorize deployment.

## Current PR #129 evidence

At head `058631c02caf3f3313863de6148a79bacd992ffb`, before the workflow-safety commits, `Build`, `Format check`, `Lint`, `Build & Test` and `Build & push image` failed with zero job steps. This is pre-checkout runner failure evidence, not source failure evidence. Issue #85 records GitHub's billing/spending annotation as the established hosted-runner cause.

The workflow-safety commits after that head also received pre-checkout hosted-runner failures. No workflow execution has validated their YAML or application commands.

## Merge gate

Before PR #129 merges:

1. Confirm the exact required checks in branch protection.
2. Restore GitHub-hosted execution or configure the legitimate required Ashbi runner/check without weakening protection.
3. Run required validation on the exact PR head.
4. Confirm no workflow publishes an image or deploys during PR validation.
5. Merge only through the protected flow after Cameron's exact merge approval.
6. Treat production deployment as a separate approval and manual action.

## Release identity and rollback

A release must record the exact commit, immutable image digest/tag, database migration state, backup, isolated restore evidence and rollback candidate. Do not use `latest` as the approved deployment identity.
