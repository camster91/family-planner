# Web implementation handoff — 2026-10-22

## Latest execution instruction — 2026-10-22

Cameron asked to defer tests until implementation is finished. Resume the
implementation-first pass: reconcile the remaining source and plans against the
actual checkout and original issue criteria, complete missing approved code, then
freeze one integrated candidate for consolidated QA. Do not start further test,
build or browser runs, or publish a PR that automatically triggers CI, before
that implementation pass is complete. This changes sequencing, not release gates:
merge/deploy still require applicable passing QA under the existing authorization.
Retain all earlier evidence at its recorded SHA; do not count unverified code or
provider/native/customer acceptance as finished. The goal remains active.

The approved implementation-first web scope is handed to consolidated QA. This
is a source-coverage decision, not a passing check, issue closure, product rating,
activation or release. Source baseline before this handoff: `6c1a3c8a` on
`codex/sick-days-sheets-499`, checkout `work/sick-days-sheets-499`. The handoff commit
will be the initial QA candidate. Repairs produce new candidates and require the
applicable affected/final checks; do not reuse old green evidence as a new pass.

## Goal requirements and current code paths

| Required outcome | Source trace | What QA must establish |
| --- | --- | --- |
| Durable normalized capture with exact unknown recovery | `CaptureDraftBoundary`, `CaptureDraftFields`, `review-document-store`, `review-document-submit`, submit/receipt APIs and canonical event/chore/grocery adapters | Provider/read failure preservation, whole-batch freeze, partial results, exact retry/inspection, current target state, storage/owner/navigation lifecycle |
| Durable recipe review and curation | `RecipeDraftBoundary`, `RecipeEditor`, existing recipe canonical create/receipt, duplicate/favorite/collection controls | Edited normalized fields, duplicate/source identity, atomic submit/replay, save versus local dismissal, current source and local recovery |
| Personal parent/teen/child and shared/profile web views | Chore preparation-context API, personal own-context reader, `shared-discovery`, Today board projection, explicit account/profile assignment gates | No profile-as-actor inference, current role/household/session, paired and fridge omissions, shared-cache exclusion, six responsive layouts |
| Routine provenance and editor/history links | `event-preparation/origin`, immutable copy fact, `RoutineOriginEntry`, preparation-context API, canonical chore editor/history consumers | Exact source identity, copied task remains independent, unavailable/erased/foreign handling, current/later-history batches, no private parent projection to other roles |
| Review inbox and drafts | `ReviewInbox`, `review-inbox/saved-requests`, read-only owned snapshots, capture/recipe/food/bulk recovery hosts | All-store leases, no competing writer or automatic inspect/send, fixed minimal summaries, owner masks, source-deleted/paused work, overlay/Back/focus |
| Authorized What changed | `ChangeTimeline`, `review-inbox/timeline`, typed target/actor contract, canonical transactional facts including routine copy | Current parent authority, canonical current titles/links only, bounded filtered windows, no raw historical private content, erased/unknown actor distinction and no new historical Undo |
| Grounded AI references, canonical planning and controlled actions | Assistant reference/source/target proofs; typed canonical create/delete confirmation; `food-planning` read/review/apply/inspect/source versions; bulk recovery and canonical domain effects | Post-latency/post-review renewal, complete bounded sources, exact atomic effects/receipts, unknowns/units/timing, no model IDs/amount invention, opt-in groceries, original lease, pause and replay |
| Private AI usage, feedback and evaluation | `ai-usage-server`, parent limits/report, food ranking observer, signed optional feedback, `ai-evaluation` builders/fixtures | Reservation-before-dispatch, conservative unknown costs, kill/adoption gates, retention/erasure/export, opt-out and atomic one-choice counts, real measured results separated from contract scores |
| Aligned web journeys and discovery | Approved UI rollout sources plus compact planning/capture/recipe sheets, weekly/inbox/chat fixed handoffs and owned navigation barriers | All 22 feature/supporting routes, actual state/role/privacy/locale/responsive behavior and required accessibility/recovery journeys |

The traces above are connected application paths, not merely standalone helpers.
Earlier source checkpoints saying their initial implementation remained absent
are historical. None of these traces alone establishes runtime correctness.

## Consolidated QA sequence

Use the repository Definition of Done and release provenance gate. First generate
the local Prisma client (no database connection), then typecheck, lint, full unit
suite and optimized build. Fix failures without weakening assertions, guards,
privacy checks, skips or release policy. Record exact commands/results and SHA.

Then rehearse additive migrations/compatibility and isolation/concurrency/replay
against a verified disposable PostgreSQL target using the existing fixture guard.
Do not use production household data. Complete six-viewport rendered role/state/
EN/ES/accessibility/Back/navigation checks against the same build. Record native
compile compatibility separately from physical-device/store acceptance.

Run the versioned AI contract/report checks in this QA phase. Real provider
observations, eligibility, cost and voice/hardware acceptance remain separate;
never activate flags or spend on a provider merely to manufacture a green report.
Existing provider-free app paths must remain functional with readiness off.

After applicable checks and independent release review pass, use the existing
authorized protected merge/Coolify source-build route. Verify source identity,
protected backup/isolated restore/recovery owner, exact serving revision, health,
assets and safe user journeys. No alternative release workflow, infrastructure,
credential, provider or destructive database change is authorized by this handoff.

## Scope and remaining backlog

The full active goal remains unchanged through QA, repairs and authorized release.
All issue histories and acceptance criteria remain. Native binaries/physical
hardware/store, provider eligibility/activation, legal/operator decisions,
real-family/customer evidence, destructive legacy cutover and later research stay
separately tracked in the existing ledger/issues; web source is not their proof.
Do not close an epic or call the product accepted from this handoff.


## Implementation-first follow-through: deterministic guidance (#562)

The source-to-original-issue review found an actual gap: canonical chore guidance
was not offered in the app guide, and routine stacks/multi-dish prep had no direct
help topic. The guide and Help page now share EN/ES answers for chores, routines,
prep sessions, recipe discovery/curation/reuse and food inventory. Existing
canonical destinations are used, including Meals?view=bulk and Meals/explore;
there is no duplicate knowledge service or household-record context.

Guide links retain feature/role filtering and withhold dashboard links for an
unknown role. The Help page consults the same topic metadata before offering a
feature link. Guide navigation awaits the existing owned-draft exit router,
respects the assistant busy/lock guard and closes its host only on accepted
navigation. Explore's delegated close handler leaves guide handoffs to that
callback; a refused draft exit or modified-click does not dismiss the sheet.

Source is authored, not accepted. Following Cameron's latest sequencing request,
no tests/typecheck/lint/build/browser/CI were run for this slice. Source formatting
only was applied. Later consolidated QA must establish EN/ES, parent/teen/child/
unknown role, disabled features, busy/refused/successful owned exits, modified
clicks, focus and provider-free operation. Other source/backlog reconciliation
continues before the integrated QA candidate is frozen.


## Original-issue source/plan reconciliation follow-through

The live open inventory was re-read2026-10-22:all82 open issues have exactly one
ledger row; no open issue is absent and no ledger issue has since closed. Original
#254/#134/#377/#84 bodies were re-read rather than interpreting old titles as
missing implementation. Their exact next work/dependencies are now in the ledger:

- #254 is an explicitly destructive later contraction, requiring its production
  backfill/zero-access release-cycle/recovery evidence and exact drop approval.
  Keep legacy models/export/provenance until then; a local rehearsal is not proof.
- #134 has accepted modular-monolith/mobile/ownership contracts and diagnostic
  source. Existing uncapped list/item and meal/Today dinner collections remain a
  real source/compatibility planning gap, confirmed in current meal GET and
  OBSERVABILITY.md. Complete compatible full-result paging and domain query/load/
  retention planning before claiming the whole architecture criterion finished;
  do not silently hide rows or promise scale from a bounded date window.
- #377/#84 preserve their original launch loop, production email/proxy/backup/
  support evidence and post-release smoke, plus genuine independent-household beta
  work. Historical master/immutable-image wording is reconciled to the currently
  authorized protected-main/existing Coolify source-build route. This does not
  authorize infrastructure, scheduler, provider, destructive or native changes.

No tests, browser/build/CI dispatch, production reads/writes, issue closures or
acceptance claims were added during this source/plan reconciliation.


## Implementation-first meal-week collection follow-through (#134/#122)

The next proved source gap was the unbounded meal-week GET. `meal-paging.ts` now
provides opt-in1..200 keyset reads in existing date/created_at/ID order, with
limit+1 lookahead. Strict canonical-base64 cursors bind the current family and
UTC date range; malformed, foreign-range and duplicate paging parameters fail400.
The server still applies authenticated family and feature/date predicates. Cursor
contents are read positions, never actor credentials or write proofs. Existing
no-limit callers retain their complete plain `{ meals }` response; no installed
client is silently capped. Both read shapes use private/no-store.

The web week uses `useMealWeek` with100 rows per request and an explicit Load more
control. A typed response is checked for range, page size, duplicate IDs and
progress; repeated cursors cannot drive an automatic loop. Week changes abort and
invalidate prior reads before painting old rows/completeness under a new heading.
Only the first page loads automatically; explicit page requests extend the view.
Mutation/Undo refreshes retain the requested depth instead of collapsing a loaded
week to page1. It never automatically walks all records. Transient more-page
failures preserve loaded rows and retry the same cursor. Rejected owner/role/
feature/range reads clear the usable private snapshot. Loaded IDs reconcile once;
there is no competing write or persistent household-data store.

The week announces incompleteness and loaded-row counts in EN/ES. Unloaded slots
say no meals loaded yet rather than Nothing planned; other-meal counts show a
partial indicator. The continuation control remains mounted at completion with
an inert, aria-disabled All meals loaded state, preserving its focus target.
Ordinary complete/small weeks retain their previous empty-slot/add behavior.

No schema, index, provider or background work was added. Source formatting only;
no tests/typecheck/lint/build/browser/CI run was started. Later consolidated QA
must cover >100 and >200 rows, equal-date/creation ties, exact limits/end-exclusive
ranges, malformed/reused/foreign cursors, legacy response equality, all existing
role/feature/isolation gates, schema failures, stalled/empty continuation,
duplicate IDs, transient retry, owner refusal, overlapping refresh/more, week
switches/unmount, mutation/Undo loaded-depth preservation, partial empty labels,
EN/ES, keyboard/focus, reflow and old/native/new API compatibility.

This bounds only the opted-in API and connected web week source. Legacy no-limit
requests, Today dinner and list/item collections remain explicit #134 work;
existing date indexes and authored limits are not measured scale/N+1 acceptance.
