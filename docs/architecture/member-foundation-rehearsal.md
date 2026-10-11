# Dormant household-member foundation (#480)

This slice adds independent household-person IDs without enabling profile-only setup, assignment, login or shared-device selection. Existing User fields, account authentication, chores, points and recorded actors remain unchanged. The application's startup migration creates three empty additive tables. It never runs a backfill.

The existing explicit whole-household deletion plan includes links, mappings and profiles in child-before-parent order after device credentials. Its two-household fake and PostgreSQL tests seed the new tables and verify household deletion coverage. This does not enable member-only erasure or change the separate account-deletion contract.

HouseholdMember stores presentation fields and an immutable household. HouseholdMemberLegacyMapping records the deterministic legacy conversion, not authorization. HouseholdMemberAccountLink is reserved for an explicitly verified future link flow. Composite foreign keys enforce the same household for both references. A database timestamp alone is not account-owner verification.

## Disposable rehearsal

Use Node 22 and the existing isolated fixture environment. The CLI requires the fixture-target guard before connecting, a single `fx_` family argument, and exclusively `fx_` account rows. It has no production override and prints counts or a fixed error code, never names, emails or connection errors.

```sh
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/rehearse-household-members.mjs --family fx_family_a
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/rehearse-household-members.mjs --family fx_family_a --apply
```

The default dry run rolls back. Explicit apply creates members and mappings in one transaction after locking the family and current household users. Unassigned users remain unassigned. IDs derive from the household/account tuple; conflicts are refused rather than adopted. Repeated runs preserve existing member edits, archive state and revisions. The rehearsal creates no active links and does not copy credentials, email, notification settings or account XP. Its library helper accepts an idle database client; callers must enforce the disposable-target guard. It is not a production migration API.

## Evidence and limits

The foundation's initial twenty focused checks covered the inventory contract, argument/identity behavior and thirteen disposable PostgreSQL cases: repeated SQL, dry run, apply and rerun, unchanged legacy rows, foreign-household/unassigned references, duplicate links, name-only schema rows, immutable household, unmanaged account moves, family deletion after mapping/link creation, injected rollback, concurrency, conflicting mappings and invalid/nonfixture accounts. The lifecycle continuation adds private erasure provenance and its guard coverage; see [the lifecycle contract](member-lifecycle-compatibility.md). The complete custom startup migration path and Prisma validation/generation also passed against disposable data.

These checks do not establish account-owner linking, name-only application journeys, shared-device attribution, complete erasure, old-client compatibility, production rollout or native device readiness. Browser tests are not claimed for this schema/tool-only slice.

## Activation dependencies and recovery

Before production backfill, complete common membership transitions: mappings intentionally prevent an unmanaged User household move. Existing removal and account erasure now handle copied profiles through the lifecycle contract, including removal followed by account deletion in another household. Neither unlink nor profile archive constitutes permanent erasure. Review the full member-domain erasure ledger before migrating subjects/history; do not activate until deletion, unlink/revocation, replay and recovery cannot resurrect erased information.

The two account-side composite foreign keys are deferred until transaction completion in the SQL migration so family deletion can clear account membership and cascade profiles in either trigger order. Prisma cannot express that deferral or the erasure-provenance trigger; use the custom migration and database regression checks. Removal transitions mappings/links before clearing membership. Cross-table legacy-mapping/account-link agreement is not enforced by the current unique keys: lifecycle operations refuse contradictions, and the future linking transaction must reject them under common locks and verify account ownership. Dormant table presence is not evidence that linking is ready.

Before profile-only writes, migrate every member-subject domain and non-FK identity, verify dual writes/readers, old queued operations and explicit client capability negotiation, and provide original adaptive onboarding/member UX evidence. Selecting a parent-looking profile must never grant parent account authority. Keep private account, finance, medical and provider data outside shared selection.

For a dormant rollback, revert consumers and retain additive empty tables; do not delete valuable records or rewrite legacy IDs. If future member writes have been enabled, follow ADR-0009's capability-aware recovery and erasure contract rather than reverting to an account-only server that hides work. Production backup, migration activation and physical/store/customer evidence remain separate gates.
