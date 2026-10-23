# Release validation source reconciliation

2026-10-20, #85/#145/#84/#128. This records source/configuration reads and authored
wiring. No validation job, build, database suite or deployment ran in this pass.

## Historical issue versus current authority

#85 describes unprotected `master` at an August head. Current GitHub repository
metadata read on this date identifies `main` as the default branch. The current
branch-protection API returns strict `Build & Test` required, enforce_admins on,
conversation resolution on, force pushes/deletions off. Required approval count
is zero; last-push approval/code-owner review are not required. No rulesets were
returned. These are configuration observations, not permission to change policy,
proof that a specific source head passed or a guarantee about bypass actors.
No branch/repository/credential/security setting was changed.

Current source `.github/workflows/release.yml` owns application validation for
PR/push on main and master plus manual dispatch. `Build & Test` has frozen npm
install, generated/validated Prisma client/schema, typecheck, lint, format, unit
suite, twice-run migrations, schema drift, fixture/reconciliation/database suites,
backup/restore rehearsal, production dependency audit, application build, container
build/readiness and image receipt. `Checked image on fresh runner` consumes that
same candidate and validates transport/runtime separately. Existing E2E viewport
and native Android workflows remain separate. Workflow source is not execution
or enabled-workflow proof; current-head hosted evidence is deliberately deferred.

The manual `Release to VPS` requires build + checked-image and the production
environment; default-branch manual dispatch only. The immutable publisher stays
flagged separately. Existing Coolify source-build deployment is a distinct path;
its settings are not inferred from GitHub validation. Do not change Auto Deploy,
production environment reviewers, registry, secrets, branch rules or schedules
as part of this source reconciliation. `CI_AND_RELEASE.md` remains the release
owner/runbook reference.

## Missing suite wiring found and authored

The generic unit command skips opt-in integration describes. An integration
source file existing on disk is therefore not enough: the database command's
explicit paths must include it with its opt-in environment.

Eighteen existing omitted source suites now join the normal guarded ephemeral
PostgreSQL route/library step: project send-to-calendar; family code and lean
defaults; profile HTTP and management; paired-device/person auth; recipe editor,
write and curation; morning summary; inventory intake/change/restock and private
food-product intake; meal create/prep/recipe history; chore rotation. This adds
no new test cases and executes nothing during implementation.

Three existing catalog/backfill suites are wired in a separate blocking step:
household-member backfill, chore-member backfill, member-audit subject migration.
Each gets its own new database in the hosted disposable PostgreSQL service,
canonical migrations before the suite and migration/schema-drift checks after.
A trap removes only that generated disposable database on failure. Deliberately
malformed catalog cases cannot contaminate the ordinary route fixture database.
They run in the same required Build & Test job, with no continue-on-error or
conditional pass, production configuration or external credentials.

This source wiring requires later hosted/runtime acceptance: runner tools,
fixture cleanup, migration restore/drift, process-exit behavior, and normal
45-minute job budget. No command was tested or reported green here. If the
integrated run fails, keep its failure, repair the cause and rerun the affected
candidate; do not drop suites or weaken a protected check.

## Exact-candidate acceptance sequence, deferred

1. Finish source and plans; record final branch/source SHA, additive schema set,
   dependency lock and native/feature compatibility. Preserve unrelated work.
2. In one consolidated pass run repository-required local/DB/browser/native
   gates against that candidate with fabricated guarded data. Retain failures,
   opt-in skips, inaccessible external/device checks and screenshots separately.
3. After authorized push/PR, inspect executable hosted runs on the actual PR/head
   and merged default-branch SHA. Require named protected checks and the separate
   E2E/image/native coverage required by the changed scope. Historical green
   results and this configuration read cannot cover local new commits.
4. Retain reviewed source, exact image/digest/receipt, schema/migration/rollback
   evidence, backup + isolated restore, acceptance report and explicit promotion
   authority. Then use only the adopted deployment owner/path and verify actual
   version/readiness and approved journeys. Merge, source-build deploy, checked
   immutable image, signed native package and store acceptance are separate.
5. Close #85 only with current exact-head execution and enforcement evidence;
   close #84 only after its release and real four-week/five-household milestones
   are proved. No issue is closed by this source-only reconciliation.
