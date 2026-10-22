# Integrated web source audit — 2026-10-22

Source inspected:9975866a on codex/sick-days-sheets-499, checkout
work/sick-days-sheets-499. The working tree was clean. This is a source-coverage
checkpoint, not runtime proof, full issue completion or release acceptance.
Cameron's sequence is unchanged: finish the code first, then consolidated QA.
This audit finishes that implementation pass for the active goal and hands the
integrated candidate to QA. Failures discovered there require repairs, not waived
gates or a return to speculative feature expansion.

## Requirement-by-requirement source trace

| Active goal requirement | Inspected connected source | Source disposition / later proof |
| --- | --- | --- |
| Owner-scoped capture drafts | CaptureBox mounts CaptureDraftBoundary; reviewed fields/owner context use review-document-contract/browser/store | Authored; actual storage/ownership/failed extraction/restore/navigation cases must pass |
| Exact capture submission and unknown recovery | Store freeze compares exact predecessor before promote; sendExact inspects receipts before same-key transport; CaptureDraftBoundary freeze/send/check/finish controls and canonical submit/receipt adapters are connected | Authored; no absent/pending/expired/committed outcome may become a fresh create; prove atomicity/replay on PostgreSQL and browser lifecycle |
| Recipe drafts, duplicates/favorites/collections and reuse | RecipeEditor mounts RecipeDraftBoundary; source/refusal inspection, normalized fields and canonical recipe receipts/curation paths are retained | Authored; full save/edit/source duplicate/collection and unknown-result journeys still need acceptance |
| Role/profile/shared-device web views | preparation-context renews current user/token/family and uses distinct parent vs own child/teen readers; Today calls shared-discovery; device cache deliberately omits preparation relationships | Authored; prove profile subjects never act as accounts, paired/private omissions and six-size lifecycle/role matrix |
| Routine provenance and editor/history links | event-preparation/origin, immutable copy facts, RoutineOriginEntry and canonical ChoresContent/RoutineStacks/EditChoreForm consumers | Authored; prove exact source/independent copy/erased/foreign/unavailable and later history behavior |
| Review inbox draft integration | parent server page renews verified session generation; ReviewInbox mounts SavedRequestsReview, CaptureInboxReview and typed recovery hosts; saved-requests reads existing stores under leases | Authored; prove minimal summaries, original owner, no competing writer/replay, pause/source deletion and Back/focus behavior |
| Authorized what-changed timeline | ChangeTimeline masks on blur/storage/hidden/source change, binds original owner and rejects late replies; timeline server uses typed transactional facts and current canonical targets | Authored; prove current parent/household/feature authority, bounded filtering, erasure and no raw old content or fabricated historical Undo |
| Grounded AI references and planning | assistant route validates reference catalog/reply, renews actor/features/config after latency; source/target proofs and canonical typed confirmations; food-planning source/version/review/apply/receipt/recovery and bulk UI/handoffs | Authored; prove full bounded sources, source freshness, exact canonical atomic effects, units/timing/unknowns, original request lease, pause and opt-in groceries |
| Private usage/cost/feedback | ai-usage-server reserves in observer.start before dispatch, retains unknown pricing, fixed parent reports/policies, lazy scoped retention and own export; signed optional food feedback and lifecycle erasure paths | Authored; prove concurrency/quotas/unknown costs, opt-out, export/erasure and no household content in reports |
| Evaluation | versioned fifteen-case canonical fixture/report and separate eighteen-case reviewed provider-observation builder | Authored; execute contract checks; real semantics/latency/cost remain unmeasured until genuine separately authorized observations, never synthesize them |
| Aligned web discovery and compact journeys | approved UI rollout and current handoff cover22 feature/supporting routes; deterministic guide shares canonical EN/ES Help, owned navigation and role/feature filters; new list/week/detail paging and Today preview are connected | Authored; existing design/older passes do not prove this candidate's full rendered role/state/locale/recovery coverage |

Source findings already repaired in this pass include canonical help gaps, inbox
session-generation admission, truthful meal-week continuation, list overview/item
paging with matching sync and independent pending recovery, typed recovery copy
and bounded Today dinner previews. CORE_QUERY_PLAN.md records actual limits,
legacy compatibility exceptions and the remaining measurement/retention/index
acceptance rather than pretending every read or SQL scan is bounded.

## Backlog reconciliation

The GitHub open inventory was freshly read via gh issue list on2026-10-22:
82 open records,82 unique canonical ledger rows, no missing/closed/duplicate rows.
The raw read is retained locally at
/tmp/herewoven-source-audit-open-20261022.json. Original #128/#499 bodies were
also re-read during this pass. Their older production/PR checkpoints remain
history; they do not prove current deployment or acceptance. #134 source progress
was read back after updating its existing comment; no issue was closed.

Original issue criteria remain attached to their existing issues. Later native
binaries/hardware/store, provider/OAuth/eligibility/spend, owner/operator settings,
real consenting household beta/customer evidence and destructive legacy table
contraction remain separately tracked. Legacy no-limit API contracts are explicit
compatibility exceptions, not silently truncated to satisfy a performance claim.
No new scheduler, service, provider activation, production mutation or acceptance
criterion is substituted for those dependencies.

## QA handoff and release state

Source coverage permits QA to start; it does not prove the goal complete. The
metadata handoff commit becomes the next candidate. Capture exact SHA/dirty state,
runtime/lock/schema inputs and command results. Earlier6971-unit/561-database
passes and recovery receipts remain at their recorded older SHAs. Failed ENOSPC
builds remain failures. No current successful optimized artifact is claimed.

Proceed with client generation, typecheck/lint/format, full units/contracts,
disposable PostgreSQL compatibility/isolation/replay/recovery and optimized build,
then rendered six-size/role/state/EN/ES/accessibility/navigation checks and original
hosted gates. Fix failures without weakening assertions, skips, privacy contracts
or release policy. The local disk has only about630MiB free; an optimized local
build previously failed ENOSPC. Use the authorized clean hosted build route when
needed, preserving source/evidence/dependencies and exact source identity.

Merge/deploy remain conditional on applicable passing QA, fresh protected backup/
restore and exact serving-source proof through the existing protected-main/Coolify
route. Prior explicit merge/deploy authorization persists. No alternate SSH release,
provider/scheduler/infrastructure/secret setting or destructive data action is
implied. The full goal remains active through repair, QA and verified release.
