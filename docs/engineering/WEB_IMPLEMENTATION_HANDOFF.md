## Renewed test deferral and adopted Capture coverage source — 2026-10-22

Cameron again asked to finish all code before further test runs. No new test,
build, browser session, CI dispatch or CI-triggering push accompanies this
follow-through. Existing hosted runs remain bound to77c115e1 and may finish.

The source audit still covers the approved application paths. The remaining
identified evidence gap now has authored browser coverage: an isolated adopted
Capture/inbox journey, EN/ES at all six representative sizes. The separate
playwright.review-documents.config.ts selects .journey.ts source outside ordinary
legacy collection, requires the four explicit local adoption gates and a guarded
disposable database, refuses a reused server and blanks extraction credentials.
The new hosted job owns its database/server; ordinary jobs retain their defaults.
The existing aggregate additionally requires this isolated job to pass.

The scenario uses the real inbox/editor/journal, manual grocery rows, sibling
pane navigation, reload restoration, minimal saved-work summaries and the real
canonical submission adapter. It drops only the committed HTTP reply, then
requires same-save recovery to inspect the original receipt without another POST.
It checks exactly one canonical row with the expected household/quantity and
retired draft discovery. Unexpected writes and page errors fail the scenario;
only uniquely named fabricated fixture rows are cleaned. Runtime identity and
request hashes accompany successful proof. These are authored assertions, not
observed results. Production flags/providers/data are unchanged.

No new application feature gap was identified in this bounded source pass.
This coverage source must join the integrated candidate for consolidated QA;
current hosted results cannot validate these new additions. All original
release checks, failure repairs, protected merge and Coolify verification remain.

# Web implementation handoff — 2026-10-22

## Resumed source follow-through — 2026-10-22

Following Cameron's renewed implementation-first instruction, the list-detail
Add/Undo repair now refreshes paged hosts from canonical data instead of appending
a tail-position row to the current page. EN/ES confirmation explains that saved
items can be on a later page. Nonpaged hosts retain immediate insertion; restored
checked state still uses the existing owned tick queue. Regression source covers
single creation, canonical later-page reconciliation and checked Undo recovery.
No new test, build or browser run, CI dispatch or push accompanied this repair.

The open GitHub inventory was read again:82 open issues,82 unique ledger rows,
no missing, closed or duplicate entries. Existing capture/recipe boundaries,
inbox/timeline mounts, routine links, shared projections and usage reservations
remain connected; the earlier requirement source audit remains the coverage map.
This follow-through closes the identified source repair, not runtime acceptance.
The next phase is consolidated QA of the committed candidate, including these
new cases. Existing hosted jobs belong to5b2503cd and cannot validate this repair.
The full web release goal stays active; no issue is closed and no deployment is
claimed. Native/provider/operator/customer dependencies retain their own gates.

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


## Implementation pass handed to consolidated QA — 2026-10-22

The active goal source audit at9975866a found connected paths for every named web
requirement and all82 open issues mapped exactly once in the ledger. This ends
the implementation-first pass and permits consolidated QA under Cameron's
existing sequence. It does not claim the code correct, issues accepted or release
ready. See WEB_SOURCE_AUDIT_20261022.md for inspected paths, remaining evidence,
legacy compatibility and external/native/operator boundaries. Earlier dated
source/QA checkpoints remain history. The full goal stays active through repairs,
passing applicable checks and authorized protected merge/Coolify verification.

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


## Implementation-first inbox generation follow-through (#123/#136)

The inbox's current-parent SQL now also binds the verified cookie generation,
carried only in the new internal getServerActor projection. getServerUser keeps
its existing four fields; the browser receives only userId/familyId. Bounded
lateral candidate reads distinguish a valid empty inbox from revoked/foreign/
downgraded authority without returning private titles under an earlier session
snapshot. Saved/capture/change host admission is renewed too. Read-free paused
preparation and raw candidate-window continuation remain intact. Full contract,
source pointers and deferred cases:`docs/plans/review-inbox-v1.md` latest section.
No tests/typecheck/lint/build/browser/CI were run; existing typed fixture generation
was updated, with formatting only. Goal remains in implementation-first phase.

While saving, the disk filled and initial source formatting failed ENOSPC. The
four edited source files were confirmed nonempty afterward. Only this checkout's
obsolete failed .next output was removed after verifying both retained build
manifests report exit1 at45252ce1. The source/dependencies/QA logs/manifests were
preserved, then the intended nullable-version guard and formatting were saved.
Ignored cleanup receipt:discarded-failed-build-final-20261022.json. This is not a
new build or runtime pass; further testing remains deferred as instructed.


## Implementation-first list-overview read follow-through (#134/#136)

Current source still selected every item checkbox in the server Lists overview,
only to count checked rows. `readListOverview` now performs database aggregation
instead: list summaries with total item counts, plus checked counts grouped by
list across the authenticated family. It does not hydrate item rows or read item
content, and does not construct an unbounded list-ID parameter array. An empty
household skips the aggregate query.

The verified-cookie actor is renewed against current User family/role/generation
inside a repeatable-read transaction before either summary/count read. Totals,
checked counts, household name and canCreate derive from the same snapshot. A
changed/revoked/deleted actor returns no overview and the page redirects through
ordinary dashboard access. Unknown aggregate results or inconsistent counts enter
the existing localized retry view, with creation withheld; they are not displayed
as an empty household or zero progress. The returned summary field names, all
list types/filter behavior, images, creator labels and total/checked semantics
remain; ties in updated_at now have ID order. Pending tick recovery retains its
existing own-account host and independent canonical guards.

This is source-only. No tests/typecheck/lint/build/browser/CI or DB query was run;
formatting only. Later consolidated QA must compare aggregate totals to canonical
items across mixed/empty/full lists and two families, concurrent checks/creates/
deletes, role/family/generation changes between authentication and reads, parent/
teen/child creation controls, denied authority versus transient failure, default/
grocery/custom filters, gallery/long text/locale and pending tick recovery.
No schema/index/provider/scheduler/write or new permission was introduced.

The list-summary collection, legacy list API and list-detail item collection are
still uncapped and stay explicit #134 work. Aggregation removes item hydration
from this overview only; it is not a complete pagination/N+1/scale acceptance claim.


## Implementation-first recovery explanations (#123/#144)

Read-through confirmed `review-document-store.refresh` calls the owned journal's
snapshot, which renews ownership under its lease and compares all storage copies
to the controller's exact baseline before returning rows. The apparent risk of
refresh silently adopting another tab's changes is already prevented at this
boundary. Preserve that refusal; do not initialize a replacement journal to bypass
it, erase storage or convert an unknown submitted intent into a fresh request.

The actual remaining usability gap was one generic storage notice for all recovery
reasons. CaptureDraftBoundary and RecipeDraftBoundary now share fixed EN/ES copy
for each typed reason: unavailable, owner changed, paused, unsupported format,
divergent copies, expired review window, capacity and changed intent. The locale
map is renewed through a ref for asynchronous controller errors. Divergence and
unsupported formats explain preserving work/storage; capacity explains reducing
unsubmitted input. No message includes storage contents, prompts, household fields
or request keys. Existing owner retirement/masking, explicit recover controls,
lease/baseline enforcement and exact unknown-result receipt paths are unchanged.

Source formatting only; no tests/typecheck/lint/build/browser/CI ran. Consolidated
QA must cover both boundaries in EN/ES, all eight reasons and ordinary transport
errors, locale change during pending recovery, full/partial/failed persistence,
external-tab modification/retirement, hidden/foreground refresh, dirty fields,
explicit discard/restore and exact submitted receipt recovery. Confirm notices
do not imply an unverified save, automatically pick a copy or enable bypassing
journal refusal. Source completion, acceptance and release remain separate.


## Implementation-first list API continuation (#134)

Canonical GET /api/lists now offers explicit optional limit1..200 and opaque
versioned cursor. It reads limit+1 summaries with existing count/creator fields,
returns a cursor only when an extra row was observed and applies family/type
scope to every page. Paged order uses created_at descending/id ascending, avoiding
updated_at movement from ordinary checks/renames. Canonical encoding, duplicate/
malformed/overlong/cross-family/filter/version refusal and cursor-without-limit
handling are authored. Successful responses are private/no-store. No-limit
clients retain the complete response and old updated-first order. DELETE and
canonical authorization/feature rules remain unchanged.

Source-only formatting; no tests/typecheck/lint/build/browser/CI or database reads.
Later QA must compare legacy compatibility; empty/single/full/multi-page results;
all list types; ties/deleted anchors/concurrent checks/renames/new creations;
forged/cross-household/filter/duplicate/invalid cursors; current auth/feature
refusals; no item hydration; and privacy-safe diagnostics. A cursor is never a
snapshot/authority proof. The server overview, list-item detail, legacy no-limit
reads, Today dinners and broader query/index/load acceptance remain explicit
#134 work. This API option does not claim those consumers are paged already.


## Implementation-first web Lists overview continuation (#134)

`readListOverview` now reads at most101 summaries for a100-row server page using
the canonical family/type cursor and creation-descending/ID-ascending order.
The existing repeatable-read actor/family/role/session renewal remains. Server
filtering covers the entire household, not just visible rows. One aggregate over
the six fixed known type keys supplies exact filter counts and legacy meal-plan/
shopping discovery even when absent from the page. Checked-item group results
are restricted to the at-most100 displayed IDs plus household scope; count/creator/
image/total fields keep their prior semantics. No item contents are hydrated.

The overview parses cursor positions against current family/type, resets invalid
positions to that filter's first page and uses explicit localized Next lists /
Back to first page navigation. The Next link does not prefetch. Continued empty
pages have their own explanation instead of a false household-empty/create-first
state. Server-owned filters never optimistically relabel a previous page while
navigation is pending or a draft exit is refused. Nonpaged component hosts retain
their existing local filter behavior. EN/ES copy explains paged creation order and
whole-household type counts.

Opening a detail carries only a fixed `overviewCursor` parameter; the detail page
validates it against current family/filter before exposing return context. Back,
missing-list Back and successful list deletion return to that page/filter.
There is no arbitrary return URL or new read authority. Create continues returning
to the first page, where the newest created list is visible. Native no-limit API
contracts, canonical mutations, owned pending tick recovery and shared-device
policy are unchanged. No schema/index/infrastructure/provider activation.

Source/formatting only: no tests/typecheck/lint/build/browser/CI or DB queries.
Later QA must cover100/101/200+lists, creation-time ties, selected type absent from
first all-page, cross-family/changed-filter/malformed/duplicate cursors, exact
counts under concurrent ticks/renames/deletes and session/role changes, unknown
legacy types, direct detail and deleted anchors, return after deletion, invalid
return context, empty later pages, failed reads/retry, child creation refusal,
owned-draft navigation refusal, keyboard/Back/focus/reflow and EN/ES six sizes.
The item-detail collection, legacy no-limit paths, Today dinners and full #134
query/index/load/acceptance work remain separate; this is not a release pass.


## Implementation-first list-item continuation and scoped sync (#134/#135)

New `list-item-paging.ts` provides opt-in limit1..200 and canonical base64url
positions bound to family/list, using position/created_at/ID ascending. Checked
state is deliberately outside page order so ticks do not move rows across pages.
Cursor shape/version/ownership/list/canonical encoding/size/duplicate/limit errors
refuse; the position is not a snapshot or credential. Deleting an anchor does not
prevent later reads. Explicit position edits can move rows; refresh from the first
page for a new traversal rather than claiming snapshot completeness.

The web detail uses100-row server pages with one lookahead. The new typed reader
renews actual user role/family/session generation, reads the canonical list/rows
and resolves page-only grocery metadata in one repeatable-read transaction.
Rows retain creator/checker/recipe/ingredient/amount fields. No full-item-count or
item-content hydration outside the101-row read is introduced. Actual failure now
has localized Retry instead of a false not-found/empty result; missing/foreign
lists stay the same minimal not-found state. Forbidden renewed authority redirects
to the normal dashboard. No raw database error is logged. Actor/session-qualified
client keys prevent carrying local state into a new actor generation.

Item next/first links preserve validated overview return context, use fixed internal
destinations and do not prefetch. Client identity remains stable across item-page
navigation, preserving typed generic add text; initial item reconciliation runs
before paint. Partial-page progress/section grouping is labelled as shown items,
with a distinct continued-empty state and an online loading explanation. Missing
rows in a partial snapshot are never labelled removed. Exact pending operations
remain in the existing owner queue and independent PendingTickRecovery, including
on missing/failed detail reads; there is no implicit discard or new replay writer.
A complete one-page list retains its prior missing-row recovery behavior.

The optional version endpoint limit/cursor query hashes the same list metadata
and at-most101 lookahead rows as initial rendering. The client polls that exact
page; late replies from another page context cannot signal terminal access or
supply its version. This avoids full-list hashes mismatching partial initial data
and repeatedly refreshing. Legacy unpaged version responses stay compatible.
The deprecated item GET also offers optional limit/cursor and nextCursor, keeps
its full legacy no-limit response/checked-first order and deprecation headers,
and retains grocery sectionSort metadata. Paged GET order matches the web query.
Successful responses are private/no-store. Canonical writes and queue contracts,
schema/index/infrastructure/provider/readiness settings remain unchanged.

Source-only formatting, no tests/typecheck/lint/build/browser/CI or DB reads.
Consolidated QA must cover100/101/200+rows; tied positions/dates/IDs and deleted
anchors; generic and all grocery types/section overrides/group splits; exact page
hash parity/lookahead changes and late page polling; source/role/generation/family
changes; malformed/duplicate/wrong-list/foreign/expired-context cursors; legacy
API/version/deprecation compatibility; continued empty vs missing vs read failure;
queued ticks outside the page, failed storage/retry/discard, complete-page removal,
new additions on later pages, generic typed text across navigation and modal edit/
move/Undo behavior; EN/ES/offline/keyboard/Back/focus/reflow on all six sizes.
No source change proves #134 scale or #135 native lifecycle acceptance. Legacy
unpaged API/version and Today dinner consumers plus full query/index/load/retention
acceptance remain explicit follow-through, not silently capped legacy responses.


## Implementation-first Today dinner bounds and query plan (#134/#122)

The board previously loaded every dinner in its date window although dinnerOn
renders only the first per day. `today-dinners.ts` now reads at most two candidates
for each of the fixed six covered UTC days (covering viewer timezone extremes),
retains the stable date/creation/ID first choice and emits one preview plus an
optional hasMoreDinners boolean. Today and Coming up explain additional dinners
in EN/ES; personal readers can use their existing authorized Meals destination,
shared readers get no private link. This is a preview, never the full collection.

Recipe/cook labels are kept only for current household pointers. Nested recipe
ingredient reads take201; missing counts require at most200 complete lines plus
complete inventory and household ingredients. Oversized/foreign/unknown data
withholds the count, never showing a partial count as exact. Shared audiences do
not read ingredients. The private board cache permits the optional fixed boolean
and older saved snapshots stay valid. Canonical meal collections/mutations, AI
loaders and their source-proof catalogs are not replaced by this display helper.
Board and version paths still use the same builder, so more-dinner state is hashed.

The new CORE_QUERY_PLAN.md maps current core query boundaries, remaining legacy
unpaged compatibility exceptions, index/retention work and the fabricated load
model to original #134 criteria. OBSERVABILITY.md no longer describes newly paged
Lists/item/meal paths as missing. It explicitly distinguishes returned-row bounds
from scans/relation SQL/performance results. No index/DDL/provider/infrastructure/
scheduler change or manufactured load evidence is added.

Source-only, formatter applied to new/selected files; no tests/typecheck/lint/build/
browser/CI or DB read ran. Consolidated QA must exercise six-day UTC coverage and
viewer-zone/DST extremes, many dinners in one day without hiding another day's
first, ties and first deletion, more flag/Coming up/cache/version/old snapshots,
foreign recipe/cook/ingredient pointers,200/201 ingredient boundaries and incomplete
inventory, shared ingredient omission, feature-off/read failure and query fanout.
Compare source strategies/actual SQL/latency on realistic fabricated households;
six fixed queries can cost more than one small unbounded read. No N+1, capacity,
production, provider or native acceptance is inferred from this code.

## Stock recovery history ownership repair — 2026-10-22

Existing77c115e1 Inventory E2E exposed the editor remaining after final removal
recovery even though the recovery sheet disappeared. Source inspection found two
Back/history owners for one stock request: ItemModal's locked mutation and the
parent's stockChange each created a sentinel. The parent's completion awaited
history release before closing the editor. ItemModal now owns a sentinel only
for manual intake; edit/consume/remove retain the parent stock-change sentinel
through pending/unknown recovery. Local mutation dismissal guards and the exact
frozen request/key are unchanged. The original failing browser assertions remain
and must pass in consolidated QA; no new tests/build/browser were run for this
repair. Controlled cook fixtures additionally supply the actual read-scope and
strict comparison fields; Spanish capped counts use the locale's number format.

## Assistant launcher hydration repair — 2026-10-23 UTC

The adopted Capture ES browser journey exposed AssistantHost hydrating a deferred
Suspense boundary after the ancestor's persisted locale had already switched to
Spanish. Its server HTML was English. Launchers now use the existing per-consumer
useHydrated boundary: preserve English for the actual hydration pass, then use
the active scoped dictionary immediately afterward. Roles, panel lazy loading,
provider behavior and permissions are unchanged. An existing-suite SSR-English/
late-client-Spanish regression checks zero recoverable/console errors and final
Spanish labels. Runtime acceptance still requires the repaired browser journey.
