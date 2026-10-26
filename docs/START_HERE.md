# Start Here

This file defines the repository's documentation authority. It is a map, not a second product plan.

## Authority order

When information conflicts, use this order:

1. `AGENTS.md` — operating rules and approval boundaries.
2. `docs/START_HERE.md` — this authority map.
3. `docs/CURRENT_STATE.md` — dated, verified repository/branch/CI state.
   - `docs/LAUNCH_CHECKLIST.md` — what must be true before the first real families use the app, and who does each item.
4. `docs/FRIDGE_TABLET_PROGRAM.md` — approved unified product direction and programme.
5. `docs/PRODUCT_PROGRAM.md` — existing release/security/beta gates that the fridge programme must preserve.
6. Accepted ADRs under `docs/architecture/adr/`.
7. Active GitHub issues — scoped execution and current dependencies; Cameron's latest explicit decision controls within its authorized scope.
8. Executable source/configuration — authoritative for actual runtime, dependency, schema, auth, Android and workflow facts.
9. Older planning documents — historical/reference only.

If an active issue conflicts with a higher authority, reconcile the issue before implementation. If executable source differs from prose, do not guess: record the actual source state and update the affected current-state/architecture documentation.

## Canonical programme

- Unified product direction: `docs/FRIDGE_TABLET_PROGRAM.md`
- Existing release/security gate: `docs/PRODUCT_PROGRAM.md`
- Master roadmap: #128
- Repository foundation: #147 / PR #129
- First implementation audit: #148 (`docs/refactor/ROUTE_AND_DOMAIN_INVENTORY.md`)
- Canonical meal/list decision: #149
- Design/IA: #150–#153
- Test foundations: #154–#156
- Shared device, inventory, dashboard, Android, observability, sync and graphics: #157–#163
- Broader programme: #119–#146

- Event preparation execution contract (#123): `docs/plans/event-preparation-v1.md` (source in progress; not activated or verified).
- Unified review inbox (#123): `docs/plans/review-inbox-v1.md` (parent reads, owned draft adapters/recovery hosts and authorized change timeline source authored; consolidated QA remains).

## Engineering references

- Notification event/delivery follow-through (#141): `docs/plans/notification-delivery-v1.md` (source inventory plus N1–N5; generic dedupe/admission, recovery, exact destinations and provider/native rollout remain unfinished).

- Stable-profile rotation proposal (#480/#450): `docs/plans/profile-rotation-v1.md` (source-backed namespace/lifecycle/rollout contract; implementation and credit/retention decisions remain pending).

- Current source screen directory (#499): `docs/product/SCREEN_ROUTE_MANIFEST.md` and adjacent JSON (82 page sources, 71 route patterns, 22 feature keys; documentation only, rendered/role/native acceptance remains open).

- Retained localization baseline: `docs/testing/REMAINING_COPY_DISPOSITION.md` (#142 source disposition; literal/legal records retained, no new scanner or rendered acceptance).


- Legacy import rehearsal: `docs/MIGRATION_REHEARSAL.md` — restored current-source procedure for #104; fixture acceptance, approved real-export rehearsal and production cutover remain separate and unperformed.

- Current deferral boundary and preserved earlier implementation handoff: `docs/engineering/WEB_IMPLEMENTATION_HANDOFF.md` (historical candidate coverage is not current source completion or permission to start QA/release).

- AI evaluation source/observation contract (#144): `docs/testing/AI_EVALUATION.md` (versioned builders/fixtures authored; no evaluation or provider run claimed).

- Canonical bulk draft/action recovery (#123/#144): `docs/plans/meal-prep-recovery-v1.md` (contracts/endpoints/browser journal, panel-owned controller and bulk form/discovery/recovery source authored; parent inbox/personal weekly discovery source also authored; broader chat/provider coordination and all acceptance remain).

- Grounded food planning (#123/#122/#144): `docs/plans/grounded-food-planning-v1.md` (canonical reads/planner, internal atomic write composition and signed read-review/source renewal authored; positive-row version source also authored; strict save/inspection and exact owned browser journal also authored; compact UI/inbox/grocery outcomes and optional metered AI ranking/draft adoption also authored; fixed chat handoff and opt-in choice counts also authored; wider semantic evaluation, migration acceptance and QA remain).

- Execution order: `docs/engineering/EXECUTION_ORDER.md`
- Agent backlog: `docs/engineering/AGENT_BACKLOG.md`
- Definition of done: `docs/engineering/DEFINITION_OF_DONE.md`
- CI/release ownership: `docs/engineering/CI_AND_RELEASE.md`
- Beta SLOs and performance budgets: `docs/engineering/SLO_AND_PERFORMANCE.md`
- Agent workflow: `docs/engineering/AGENT_WORKFLOW.md`
- Architecture: `docs/architecture/**`
- Testing: `docs/testing/**`
- Design: `design/**`, `BRAND.md` and the Warm Paper visual system `docs/product/BRAND.md`
- Navigation and information architecture (one home, tabs, More, undo): `docs/product/NAVIGATION.md`
- Standalone profile/account unlink and rejoin (#557/#480): `docs/plans/profile-account-unlink.md` (source-backed transaction/domain design; writer and acceptance remain unfinished).
- Calendar interoperability source/acceptance (#124): `docs/product/CALENDAR_INTEROPERABILITY.md`
- Product measurement and learning (#140): `docs/product/PRODUCT_MEASUREMENT.md`
- Chores (parent check, picture routines for young kids, taking turns): `docs/product/CHORES.md`
- Provider-free weekly reset (#123, source foundation; not activated): `docs/plans/weekly-reset-v1.md`
- Schedule conflict review (#123, concrete-event planner/source/API/receipt/recovery/UI/weekly integration source; unverified): `docs/plans/schedule-conflict-review-v1.md`
- Responsibility acceptance and backup (#123, consent/storage/API/recovery/canonical UI/weekly-review source; unverified): `docs/plans/responsibility-and-backup-v1.md`
- Release/incident operations: `docs/runbooks/**` (including `BACKUPS.md`, `TRANSACTIONAL_EMAIL.md` and `SUPPORT.md`)
- Preserved finance to native screens (#566): `docs/plans/finance-archive-product.md` (planning scope; no archive promotion)
- Existing Coolify source-build deployment (2026-10-07 reconciliation; settings changes remain owner-gated): `docs/runbooks/COOLIFY_DEPLOY.md`
- Design-partner beta operations (#107, #108): `docs/product/BETA_OPERATIONS.md`
- Conditional packaging/lifecycle definition and official price observations (#110): `docs/plans/packaging-validation.md` (no billing implementation, offer adoption or demand evidence).

## Historical/reference-only material

`docs/CONSOLIDATION_PLAN.md`, `docs/ISSUE_TRIAGE.md`, everything under `docs/archive/`, old phase implementation files, archived source-app plans and stale branch-specific status notes are superseded for current planning. They may explain history but must not be used as current scope, dependency or runtime truth.

`CLAUDE.md` is only an agent pointer. It must not duplicate or override `AGENTS.md`.

## Reconciliation rule

Do not leave a discovered material conflict unresolved. Fix it in the same safe documentation/governance PR, or record a blocking issue with the exact conflict, owner and next action.
