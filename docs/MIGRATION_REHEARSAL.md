# Legacy family import rehearsal — #104

Restored 2026-10-24 from current source inspection. **Procedure only: not run.**
No approved export, identity map, restore, dry run, import, checksum calculation,
QA or production action was performed while authoring this guide. Historic CI
claims do not establish acceptance of the current candidate or real source data.

## Scope and ownership

Import one source module at a time using the existing parent-only
`/dashboard/settings/imports` and `POST /api/admin/imports/[source]` contracts.
Supported source keys are `chore-champs`, `meal-planner`, `budget-app` in
`src/lib/imports/run-family-import.ts`. No display-name identity guessing.

Codex prepares source mapping, isolated rehearsal evidence and reconciliation.
Cameron supplies/approves exact source exports, explicit identity maps and the
intended target household, and separately approves any real-data environment
access, production run, write freeze, restore or cutover. Task authorization to
prepare this runbook is not authorization to run those operations. Keep the
existing source repositories and approved exports recoverable until #104 closes.

## Prepare a private evidence packet

Use a restricted artifact location for exports, identity maps, row-level results,
backup paths and detailed mismatch reports. Do not attach private source data,
emails, user IDs, tokens or database credentials to GitHub or logs. The issue may
link the private packet and record approved non-content summaries.

| Required field | Record before running |
| --- | --- |
| Candidate | Exact Git SHA, dirty/clean state, schema/migration and generated-client identity |
| Target | Named isolated target, current household/parent ownership, restored-backup identity; credentials stored separately |
| Source | Source app/version, original repository/export provenance, export UTC time, byte count and SHA-256 of the exact original bytes |
| Mapping | Exact source-ID to current target-user-ID file, its SHA-256 and explicit approval; no inferred matches |
| Source inventory | Every supported input collection and count, including empty/absent collections and unsupported records |
| Approval | Who approved which source bytes, map bytes, target and allowed action; unresolved decisions remain Pending |
| Recovery | Pre-import backup identity/hash, restore evidence, expected rollback data-loss boundary and owner |
| Results | Dry-run artifact, first/second run job IDs and scoped before/after reconciliation artifacts, each with identity/hash |

Compute SHA-256 with an existing local hashing tool over immutable copies; record
its tool/version and compare the digest again before persistence. Source-file
SHA-256 is distinct from optional `ImportedRecord.checksum`; neither substitutes
for validating actual record values. A changed export or map starts a fresh
review packet. Keep source timezone/date-only/currency/unit metadata literal.

## Read current source contracts

| Source | Parser / plan | Persistence / special reconciliation |
| --- | --- | --- |
| ChoreChamps | `src/lib/imports/chore-champs.ts` | `persist-chore-champs.ts`: explicit kid/user mapping, chores/assignments/habits/rewards and other accepted collections; retain each skipped reason and current member-subject boundaries |
| Meal Planner | `src/lib/imports/meal-planner.ts` | `persist-meal-planner.ts`: reconcile current canonical Recipe/Meal/List/ListItem targets, links/archives and nulled references; old source models are not automatically current target tables |
| Budget App | `src/lib/imports/budget-app.ts` | `persist-budget-app.ts`: reconcile every accepted collection, exact monetary/date/category values and preserved financial archive records; archive preservation is not a usable finance UI |

Current parser schemas and returned plan/summary are authoritative for the exact
accepted fields/defaults. Do not invent a missing collection, turn an ambiguous
identity into a new account, or normalize money/dates by display locale. Inventory
unsupported input fields/records explicitly; schema acceptance alone is not proof
that all source data is represented in the target.

## Separate fixture acceptance from the real-export rehearsal

The following are existing executable sources to inspect for later QA, **not
commands executed by this document**:

- `.github/workflows/release.yml`: persisted-import and reconciliation jobs,
  migration repeat/schema checks, canonical meal import and recovery steps.
- `src/lib/imports/__tests__/persistence.integration.test.ts` and
  `reconciliation.integration.test.ts`: fabricated import/re-import/provenance.
- `src/lib/imports/__tests__/meal-planner-canonical.integration.test.ts`:
  canonical meal/list/recipe ownership and legacy source handling.
- `scripts/recovery-rehearsal.sh`: creates two throwaway databases, seeds fixtures,
  uses backup/restore, compares table counts/checksums/schema, repeats migration
  and runs Prisma smoke reads. It deletes its temporary databases/dump on exit.

The recovery script checks restricted `fp_rehearsal_*` names, host/environment
and distinct source/restore databases before connecting; it ignores an inherited
DATABASE_URL. See [release/rollback](runbooks/RELEASE_AND_ROLLBACK.md) for inputs
and machine-readable report fields. Its table fingerprints use MD5 for equality
comparison, not source SHA-256 provenance or financial-value reconciliation.

Import integration suites are opt-in through RUN_DB_INTEGRATION and perform
cleanup deletes. That opt-in is not a production-target safety guarantee. Do not
point them at an approved-data restore or a real household database. Later QA
must first independently verify the disposable target and fixture authority from
current source/config, then use a separate fabricated database. Do not seed,
reset or run cleanup suites against the real-export rehearsal copy.

## Real-export rehearsal sequence

1. Verify exact approvals, immutable source/map hashes and complete source
   inventory. Inspect the current candidate and importer/domain/erasure rules.
   Resolve contradictory IDs, unsupported records and missing source fields
   before any intended persistence. Document accepted exclusions explicitly.
2. Restore the approved backup into an isolated, access-restricted environment
   with provider/scheduler/email/background integrations disabled. Verify target
   identity before connection and the restored household/member ownership before
   import. Record restore completeness and baseline schema/client compatibility;
   current migration/old-client rehearsal remains a separate acceptance record.
3. Capture scoped baseline counts and critical values for the target household
   and an unrelated control household. Retain stable source/target IDs privately.
   Establish the expected target-model mapping from current importer source.
4. Run the existing dry-run request with the exact source bytes and reviewed
   identity map. Preserve the returned plan and summary, not just a screenshot.
   Reconcile every source row to an intended disposition and explain each skip,
   archive, link and dropped reference. A null jobId is the dry-run envelope;
   it is not a persisted ImportJob or a signed review receipt.
5. Review created/reused/skipped and domain-specific archived/linked/nulled
   information with the source inventory. Confirm values, statuses, balances,
   dates, relationships and exclusions, not just aggregate totals. Refuse any
   unexplained difference or cross-household target.
6. With the exact approved input/map still unchanged, explicitly persist only
   that source in the isolated restored copy. Preserve jobId, final status,
   summary and any failure record. A lost response is Unknown until inspected;
   do not label it failed or blindly issue another persistence request.
7. Inspect canonical targets and provenance. For each source record, identify
   its one intended current target/disposition or its recorded skip. Every
   ImportedRecord target must exist in the correct household and match the
   accepted source mapping/values. Skipped and imported accounting must not hide
   a duplicate or omitted record. Inspect job errors privately, never as logs.
8. Repeat the identical source/map import deliberately on the isolated copy.
   Record the new job and actual delta. Prove zero unintended new canonical or
   archive rows, zero duplicate source provenance and unchanged critical values.
   Reused provenance may belong to the earlier job; do not require replay to
   reassign its original import_job_id or misread that as a missing record.
9. Compare the unrelated control household before/after and verify ordinary
   authorized product reads, role/privacy behavior, history/credit/financial
   semantics and supported client behavior in the later QA pass. A successful
   HTTP response is not this evidence.
10. Rehearse the approved rollback on another isolated target, retain reports,
    then rebuild/restore the forward rehearsal as needed to prove repeatability.
    Record every failure and discrepancy; absence of evidence stays Pending.

## Provenance and rollback limits

`ImportJob` records source/version, household, actor, timestamps/status/summary;
`ImportedRecord` keys are unique by household + source app + source model + source
ID. Its target model/ID and optional checksum support traceability. A uniqueness
constraint alone does not prove value preservation, correct identity mapping or
atomicity of all domain effects. Inspect current per-importer transaction and
partial-failure behavior; do not assume every source shares one transaction.

There is no generic approved importer Undo here. Deleting an ImportJob can cascade
its ImportedRecord rows while leaving canonical targets; this can destroy replay
provenance and allow later duplication. Do not delete jobs/provenance as rollback.
Use an explicitly reviewed source-specific reversal only if one actually exists
for that operation, or the approved backup-restore procedure. The separate
[meal/grocery backfill reversal](runbooks/MEALS_GROCERIES_BACKFILL.md) is not a
universal import reversal and does not authorize legacy table contraction #254.

`scripts/backup.sh` backs up the database and invokes retention pruning; it is
not a read-only checksum command. `scripts/restore.sh` overwrites its target.
Use [BACKUPS.md](runbooks/BACKUPS.md) and the actual recovery runbook after exact
environment approval; protect the required backup from retention and include
any matching upload/config recovery needed by the chosen release. Restoring a
pre-import database can discard later legitimate writes. Any production rollback
therefore needs a separately approved write/recovery window and loss boundary.
Do not enable a backup timer, alter retention or drop tables from this procedure.

## Acceptance and handoff

The final #104 packet must identify exact source/map/candidate/target/backup
identities; all source dispositions; critical-value and unrelated-household
comparisons; both run job IDs/deltas; provenance; rollback/forward evidence;
remaining failures; and the owner's explicit cutover decision. Native/current/
previous-client acceptance, real data rehearsal and fixture CI are distinct.
No real-data production action follows automatically from source completion,
merge approval, a valid local preview or a fixture report.

Current state: guide restored; all real-export and runtime acceptance remains
unperformed/open. Codex owns preparation and later authorized isolated evidence;
Cameron owns missing source/map approval and exact production/cutover decisions.
