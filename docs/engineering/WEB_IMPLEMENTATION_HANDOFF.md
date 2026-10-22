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
