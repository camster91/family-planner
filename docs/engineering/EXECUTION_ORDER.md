# Build Execution Order

Use `docs/START_HERE.md` for authority and the live GitHub issue records for scope.
This document orders work; it does not replace acceptance criteria or create a
second backlog. The current issue directory is in
`docs/engineering/ISSUE_COMPLETION_LEDGER.md` and programme issue #128.

## Current continuation — 2026-11-03

Cameron requested completion of the advanced connected features after the
recipe-to-meal release preparation. The historical code-only/no-QA restriction
below is superseded by the later request to verify fixes before release.
Continue the existing issues, not another feature backlog.

- Release candidate PR #622 remains separate from this continuation. Its passing
  checks do not mean it is merged or deployed.
- Start with #464/#499 connected food planning: existing D1 preview, review,
  apply and recovery code must be exercised together. The local-only runtime
  option `--exercise-connected-planning` enables food planning, weekly review
  and the two queue-owner recovery flags without enabling provider calls or mail.
- Fresh meal/prep entries now initialize an empty local draft directly; existing
  drafts and unresolved requests take precedence. Recovery-only links do not
  create a new draft. This does not send or save a meal automatically.
- Local checks: typecheck and production build passed; 28 food-planning suites
  passed (121 tests), with four existing suites/20 tests skipped. An isolated D1
  browser journey previewed, reviewed and saved a recipe-linked meal. These are
  local checks, not production activation or full feature acceptance.
- D1 smoke checks passed for food preview/review/apply/replay, grocery outcomes
  and undo, source-version guards, weekly progress/recovery, and review-inbox
  household isolation. Weekly review also passed 64 tests in nine suites.
- Candidate configuration enables food planning, weekly review and both
  queue-owner recovery flags. No production configuration has been changed.
  The updated planner component passed phone/tablet/desktop browser checks and
  preview/review/save against isolated D1 (router stubbed; backend artifact
  `6a6c0b61`). Weekly review passed start, step completion, finish and reload
  against that same isolated runtime. Before release, finish candidate
  multi-meal/prep journeys and exact-candidate CI; production approval remains
  a separate gate.
- D1 migration `0017_event_preparation_lifecycle.sql` now ports preparation
  identity, source/revision and lifecycle guards. Local native-schema checks
  cover immutable relationships, plan delete/recreate, task status changes,
  household movement and failed-batch rollback. Event/chore mutation and
  deletion, assistant deletion, review inbox and archive/export smoke checks
  passed with the migration. No production migration has run.
- Migration `0018_event_preparation_step_bounds.sql` adds canonical 1–99
  ordering and all-or-none timing-cue validation. Real D1 checks prove stable-ID
  atomic reorder and rollback to the original links/revision on failure.
  Chore reads, archive export and assistant-delete guards pass; the oversized
  legacy-data fixture explicitly restores its temporarily disabled insert guard.
- The native preparation storage check now requires all 34 source/lifecycle
  triggers on their expected tables. Parent context reads event backlinks and
  copied-routine provenance in one primary snapshot with household, role and
  session-generation checks. Chore context and personal Today now use this
  reader; fridge mode does not receive parent links. Native checks cover missing
  guards, stale sessions, foreign households and corrupt/removed routine origins.
- Preparation source projection and strict state parsing are now shared between
  PostgreSQL and D1. Native source reads use captured query witnesses and refuse
  authority/content changes before returning. The native writer commits canonical
  chores, stable preparation link identities, provenance and its replay receipt
  in one batch. Real local D1 checks pass for create/reorder/detach, stale review
  refusal, repeat receipt replay, replay after pause, failed-batch rollback and
  authority races. Domain tests: 13 suites/66 tests passed, 1 suite/8 tests skipped;
  TypeScript passed. These are local backend results, not rendered acceptance.
- Native preparation HTTP context/read/preview/write/picker/recovery now dispatch
  without PostgreSQL. Discovery preserves literal search and bounded pagination;
  inspection checks committed receipts before age, pause or target availability.
  Real D1 checks additionally pass recovery, pickers, profile pagination and
  routine-copy creation/provenance for an email-free profile. API/domain/component
  tests: 17 suites/76 tests passed, 1 suite/8 tests skipped; typecheck/lint passed.
- Built Cloudflare candidate `6741841b` and exercised its real local Worker/D1
  in Chromium: calendar event → preparation task → review/save → reload passed;
  phone/tablet/desktop sheets fit the viewport. Dropping the committed PATCH
  response then using rendered Check status recovered success with exactly one
  canonical task. Screenshots and evidence are retained under
  `artifacts/connected-family-features-20261103` beside the checkout. No external
  provider/mail/network was enabled. The preparation release flag is now enabled
  in the candidate config only; no production activation or merge has occurred.
  Profile/routine candidate flags are now enabled after the following local checks:
  mixed account/profile routine creation and duplicate-safe expansion; foreign
  profile refusal; archived profile stops new occurrences; native shared-device
  profile completion/replay and parent authorization checks. The real Worker
  phone flow created an email-free age-three profile, assigned child and parent
  steps, reviewed/saved a daily routine and retained it after reload. Removed the
  repeated review-scope paragraph seen in the screenshot (shared dialog header
  retains that explanation). Harness `--exercise-profile-routines` is local only.
  Physical-device acceptance and production rollout remain separate.
  Continue routine/profile
  parity and connected capture/review journeys through their existing issues.
  Do not bypass disabled capability checks to expose incomplete work.
- Live issue #464 reconciliation found schedule-conflict HTTP still PostgreSQL-only.
  The existing bounded planner now has native D1 context/read/preview/save/recovery.
  Complete comparison witnesses guard event identities, newly inserted conflicts,
  calendar-source status and current actor authority; event/timeline/receipt commit
  atomically. Real local D1 checks pass stale/phantom conflict refusal, canonical
  move/epoch, exact replay, cross-family and child restrictions, failed-write
  rollback, recovery after target deletion/pause, and revoked-session refusal.
  API/domain/component checks pass 16 suites/141 tests (one PostgreSQL suite/six
  tests skipped); typecheck and changed-source lint pass. The schedule readiness
  flag is still off: exact built-candidate browser checks and activation are next.
  No provider refresh, external calendar write, production migration or deployment
  was performed. Evidence: `schedule-*` in the continuation artifact directory.
- Keep live Google/provider eligibility, signed native builds, physical-device
  behavior and store publication explicit. Existing source is not evidence
  those external requirements are complete.

## Historical execution basis — 2026-10-25

A fresh GitHub metadata read confirms **all seventeen foundation issues
#147–#163 are closed**. In particular, #150/#151/#152/#160/#163 are no longer
open as the older refresh below states. Do not recreate those foundation tasks
or use their historical status to block current bounded source work. Preserve
their accepted work and provenance; closure alone is not current candidate,
physical-device, restore, production or household-beta acceptance.

There are **37 open issues**. No issue is closed by this reconciliation. Queue
recovery defects #564 and #565 keep their separate original acceptance; existing
source does not prove restart/storage/concurrency behavior. The current pass
continues code and planning work only: QA, tests, builds, lint/typecheck, browser,
CI, database/migration/generation, push/merge/deployment and activation remain
deferred by Cameron. Authored fixtures are unrun source, not completion evidence.

## Work from the existing canonical slices

| Existing work | Canonical issues | Execution and dependency boundary |
| --- | --- | --- |
| Product flows and calm connected UI | #450, #480, #557, #460, #464, #499, #125, #142 | Continue existing chore/profile, recipe/capture, assistant and compact-view source through their existing plans and canonical APIs. Preserve selected Glance and act behavior. Missing original visual references are not recreated approval; source work is not rendered acceptance. |
| Shared architecture, sync, privacy and quality contracts | #134, #135, #136, #141, #144, #140, #137 | Finish bounded domain/read/write/recovery work without a second backend or queue. Keep privacy/grounding/cost/telemetry requirements separate from feature completion. Do not start deferred evaluations, scale runs or delivery. |
| Native compatibility and lifecycle | #138, #465, #473, #563, #564, #565 | Author only bounded contracts/source that do not require hardware or permission/provider activation. Keep actual binaries, current/previous server compatibility, storage faults and physical lifecycle acceptance open. |
| Household-bound summary defect | #470 | Retain the authored binding/day-claim source and explicit no-delivery state; actual two-household/concurrency acceptance must precede enabling delivery. |
| External inputs and specific owner decisions | #124, #567, #103, #104, #254, #372, #363 | Complete independent adapter/contracts/plans, but do not fabricate provider eligibility, callbacks/secrets, delivered mail, approved legacy exports, legal identity or Auto Deploy decisions. Destructive contraction/restore remains separately gated. |
| Final release and operations | #377, #139, #145, #146 | Preserve final-candidate acceptance, reusable quality gates and operations evidence as distinct work. No source checklist, closed foundation issue or old passing result authorizes a release or proves this local candidate. |
| Real household and commercial learning | #107, #108, #110 | Keep consented recruitment, four scorecards/exit interviews and packaging decisions dependent on real approved participants/evidence. Do not replace them with fabricated households or add billing. |
| Programme and checkpoint | #128 | Record exact local source identity, scoped issue progress and genuine remaining dependencies. Close only evidenced completed or redundant tracking while preserving all original requirements. |

## Selection and handoff rule

Choose a bounded unresolved requirement in the current issue/source, preserving
existing changes and original scope. Finish independent work while owner inputs
are pending. The unresolved profile deletion/credit ownership decisions in
#557/#480 must not be inferred from routine/profile source work; do not repeatedly
ask the same question. External/provider/hardware dependencies do not block
unrelated ordinary code or planning.

Before a later QA pass, retain each issue's original assertions and identify the
exact candidate and required commands/journeys under the definition of done.
After QA is resumed, its results must refer to that candidate; old results and
metadata reconciliation are not substitutes. Keep source, hosted QA, production,
physical devices and customer acceptance separate. No deployment permission is
implied by this execution order.

## Historical dependency map — not current issue status

The following 2026-10-08 sequence is preserved for dependency history. Its open/
closed assertions and execution restrictions are superseded by the current
basis above and live issue records. Do not select work from its stale status.

Issue dependencies are authoritative within the source order in `docs/START_HERE.md`. The foundation gate #147 / PR #129 is complete: #129 merged normally on 2026-09-23 as `2538499`. The sequence below preserves the original dependencies; it is not a list of currently open issues.

### Execution refresh — 2026-10-08

GitHub issue state was checked against source `bfb74e6d` before this refresh. #148/#149/#153–#159/#161/#162 are closed foundation issues; do not restart their implemented work or treat their original dependency gates as pending. #150/#151/#152/#160/#163 remain open. A closed foundation issue does not establish the broader Android, release, household-beta or product acceptance criteria.

Use the current issue records and #377 for remaining acceptance and owner dependencies. #150 now has source-linked foundations, journey maps, reference/mood studies and composition proposals; native reading-distance and composition acceptance are still open. #135 has a bounded grocery-check queue and a merged shared-board cache (#389) validated locally and in CI for API-outage restoration after the shell loads. Fully offline navigation, native WebView restart, queue metrics and broader multi-device acceptance remain open. #160/#242 retain physical Android evidence. Choose one bounded, unblocked slice from these current gaps; avoid recreating the foundation plan.

### Gate 0 — repository reconciliation

1. #147 repository foundation and source-of-truth cleanup — closed; PR #129 merged on 2026-09-23 (`2538499`).
2. #84/#85 and the remaining open #103–#108/#110 acceptance are release/security gates. #102/#109 are closed records; closing them does not establish missing production, household-beta, email or hardware evidence.

### Wave A — remove ambiguity

1. #148 route/component/domain and placeholder-data audit.
2. #149 canonical meal/recipe/grocery/list decision.
3. #150 Figma reference board and original premium visual direction.
4. #151 adaptive information architecture and five user modes.
5. #157 shared-device contract may be analysed after #147 and coordinated with #151.

#149 must follow #148. #151 must use #148 and coordinate with #150. Design analysis may overlap, but no competing data, navigation or visual contract may be implemented.

### Wave B — reusable foundations

1. #152 design tokens/components after #150.
2. #153 adaptive app shell after #151 and stable #152 direction.
3. #154 deterministic two-household fixtures; exclude unresolved meal/grocery fixture shapes until #149.
4. #155 E2E/visual/accessibility harness after #154.
5. #156 protected design/state gallery; it may begin from existing primitives but final variants follow #152.
6. #160 Android foundation may proceed as an isolated platform track; do not add kiosk/shared-session product behaviour before #157.
7. #161 narrow privacy-safe observability foundation.

### Wave C — first product verticals

1. #158 inventory backend after #147; keep its API boundary independent of unresolved meal/list decisions.
2. #159 real-data Today dashboard after #149, #151, #152 and #153. Inventory remains an explicit unavailable state until #158.
3. #162 idempotency/offline queue after #154 and #157; only explicitly approved domain actions opt in.
4. #163 original graphics after #150, integrated through #152/#156.

### Broader programme

Continue into #119–#146 only when their relevant #147–#163 foundations and #84/#85/#102–#110 gates are satisfied. Evidence-dependent implementation in #109, #110, #124–#126 and beta/commercial work must wait for the beta or usage evidence named in those issues.

### Selection rule

Choose the earliest unblocked issue that fits one reviewable PR. Split oversized work before implementation. Use `AGENTS.md`, `docs/engineering/AGENT_WORKFLOW.md` and `docs/engineering/DEFINITION_OF_DONE.md`.
