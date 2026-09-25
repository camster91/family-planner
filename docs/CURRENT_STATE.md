# Current State

**Last reconciled:** 2026-09-08 (whole document); the "Verified source baseline" workflow/deploy bullets were re-reconciled against repository files on 2026-09-24  
**Repository:** `camster91/family-planner`  
**Protected default branch:** `master` at `6553f4d6971e6b0fab53d37f3a9883a0f3018202` when reconciled  
**Canonical planning branch:** `plan/fridge-tablet-program`  
**Canonical planning PR:** #129 (open; not merged when reconciled)

This is a dated snapshot. Inspect GitHub and executable source again before changing code or reporting status.

**Re-verification scope (2026-09-24):** only the workflow, deployment and Android-signing bullets under "Verified source baseline" were re-checked, and only against files in the working tree (`.github/workflows/*.yml`, `.github/scripts/*`, `android/app/build.gradle`). The branch/planning state, CI check evidence, domain overlap, release gates, open pull requests and current phase sections below were **not** re-verified on 2026-09-24 and still reflect 2026-09-08. Live GitHub settings, secrets and production health were not re-verified.

## Branch and planning state

PR #129 contains the complete fridge-tablet programme and agent-ready repository foundation. Until it merges, `master` does **not** contain the canonical planning files. The older `plan/agent-ready-foundation` branch is superseded by `plan/fridge-tablet-program`; agents must not split new work between them.

PR #129 was mergeable at the Git level but GitHub reported `mergeable_state: blocked`. Normal protected merge was not available. Do not force-update `master`, weaken protection or claim the plan is merged.

## Verified source baseline

- Exact dependencies/scripts: `package.json`. At reconciliation it specified Next `^16.3.2`, React 18, Prisma 7.9.x, Tailwind 3.4 and Capacitor 8.
- Actual schema: `prisma/schema.prisma`.
- Auth: self-hosted JWT/session implementation. `src/lib/supabase/server.ts` is legacy-named and is not proof of active Supabase auth.
- Android: a Capacitor project exists under `android/`; generated `ExampleUnitTest` and `ExampleInstrumentedTest` remain and are tracked by #160.
- Workflows (last reconciled 2026-09-24): four YAML files exist under `.github/workflows/`: `release.yml`, `apk.yml`, `auto-merge.yml` and `stale-issues.yml`. Ownership and triggers are mapped in `docs/engineering/CI_AND_RELEASE.md`. The earlier ten-workflow layout, Coolify deployment, GHCR image publication and `deploy-from-ghcr.yml` no longer exist in the repository.
- Deployment (last reconciled 2026-09-24, repository files only): `release.yml` runs `Build & Test` on pull requests, `main`/`master` pushes and manual dispatch. Only a manual `workflow_dispatch` on the default branch runs `Release to VPS`, which transfers the exact smoke-tested image over SSH (`.github/scripts/deploy-over-ssh.sh`) and performs a health-gated container swap on the host (`.github/scripts/deploy-vps.sh`), then checks `https://family.ashbi.ca/api/health` for the released commit header. Whether production credentials are configured, and whether this path has run successfully, is unverified here; see `docs/engineering/CI_AND_RELEASE.md`.
- Legacy deploy path: `scripts/webhook-receiver.sh` with `scripts/family-planner-webhook.service` is a secondary, pull-based deploy trigger. It is not the supported path and must not be installed or used without Cameron's explicit approval.
- Scheduled jobs (last reconciled 2026-09-24): no workflow has a `schedule:` trigger. `stale-issues.yml` is manual-dispatch only, per the AGENTS.md scheduler rule.
- Android release signing (last reconciled 2026-09-24): `android/app/build.gradle` signs release builds only when `ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` are set. `apk.yml` decodes the keystore from the `ANDROID_KEYSTORE_BASE64` secret and refuses to publish an unsigned APK to GitHub Releases. Whether those secrets are configured is unverified.
- Production identity/health was not re-verified during this repository-only reconciliation.

## CI and required-check evidence for PR #129

Canonical workflow intent and exact ownership: `docs/engineering/CI_AND_RELEASE.md`.

Exact PR head before this reconciliation commit series: `e7f3f611f99d06d01de1214a2e7246c15f43c991`.

Observed check runs:

- `Format check` — failure
- `Lint` — failure
- `Build` — failure
- `Build & push image` — failure
- `Build & Test` — failure
- `Deploy to Coolify` — skipped
- Cursor security review — success
- Cursor approval router — success
- GitGuardian — success
- auto-merge — skipped

The failed GitHub-hosted jobs exposed `steps: []`; they failed before checkout/execution. Issue #85 records GitHub's billing/spending-limit annotation as the established hosted-runner failure mode. This evidence does not prove source code is green or red. The repository integration cannot read the protected branch's required-check configuration (GitHub returned 403), but issue #85 records `Ashbi release gate` and `Build & Test` as required. Re-check settings in GitHub before merging.

Earlier issue #85 evidence records successful Ashbi/VPS release-gate and Android runs for PR #101, not for the current PR #129 head. Therefore Ashbi/VPS CI existence is confirmed historically; current-head health is unverified. Android validation did not run successfully on the reconciled PR head.

## Current domains and unresolved data overlap

The schema contains:

- legacy/current UI paths: `FamilyMeal`, `List`, `ListItem`;
- newer imported/foundation paths: `Recipe`, `Ingredient`, `RecipeIngredient`, `MealPlan`, `MealPlanEntry`, `ShoppingList`, `ShoppingItem`.

Issue #149 is the canonical decision issue. None of these overlapping generations has been declared the universal canonical write model. Do not add another model generation or begin cross-domain inventory → meal → grocery writes first.

## Release/security gates

Issues #84, #85 and #102–#110 remain active gates. The fridge programme does not authorize bypassing CI, isolation/security, email, migration, QA, exact-artifact release, beta evidence, calendar validation or billing validation.

## Open pull requests that affect the baseline

- #101 `codex/launch-readiness-gaps`: 80 changed files and 43 commits covering release/security, migrations, tests, workflows and application code. Its recorded checks are green, but it remains protected-merge blocked and is not contained in PR #129. Its disposition must be decided before a route/domain audit can claim completeness.
- #112: Dependabot throttling only.
- #116: CI consolidation that overlaps #101 and the workflow-safety changes in #129. Do not merge independently until the canonical release-check names and #101 disposition are resolved.
- #111, #113–#115, #117–#118: isolated Dependabot updates, all protected-merge blocked by hosted CI.
- #129: canonical fridge-tablet/repository reconciliation plan.

No open PR above was merged or closed during reconciliation.

## Current phase and first work

1. Decide whether PR #101 is the release/security baseline to merge, replace or supersede. Do not silently abandon its 80-file candidate.
2. Restore/confirm required CI and protected check names under #85.
3. Complete and merge PR #129 using the normal protected flow, rebasing/reconciling it if #101 changes `master`.
4. Run #148 only against the resulting canonical source baseline.
5. Decide #149, then continue #150/#151 and `docs/engineering/EXECUTION_ORDER.md`.

## Approval state

Documentation and non-production implementation may proceed in reviewed PRs. This snapshot does not authorize a merge, production deployment, Play publication, secrets/DNS/access/billing changes, spending, participant outreach or destructive production data changes.
