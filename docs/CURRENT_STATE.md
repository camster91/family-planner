# Current no-QA issue follow-through — 2026-10-24

## Source identity and boundaries

Recovery checkout: `/Users/Cameron/Documents/Codex/2026-10-24/family-planner-recovery/repo`,
branch `codex/issue-followthrough-recovered-20261024`, based on shipped-main
`3b4e1046fee45e5924ac24b3498f0e2ef26b5669`. Local follow-through is **unpushed,
unverified and unreleased**. Exact commits are in Git and programme issue #128;
`../issue-followthrough-20261024.patch` and its receipt preserve the full local
change series. Production has not been checked in this no-QA pass.

The earlier checkout and unpublished commits f53b2df5/d403bb1e/648e6f27/5ada9688
were not recovered. The selected connected behavior was reconstructed from the
recorded direction/current source; original image assets remain unavailable.
Earlier reported results belong to their exact old candidates and do not prove
this tree. No QA, tests, build, lint, typecheck, browser, CI, push, merge, deploy,
provider/scheduler activation, signing/provisioning or production data mutation
ran. Authored regression source is not a passing result.

## Current disposition

The earlier clearing pass reviewed68 and retired27 duplicate trackers after
preserving complete requirements. The subsequent41-issue pass closed #566 for
its complete planning deliverable only, leaving **40 genuine open issues**.
Ten documentation-only criteria are now reconciled in #134/#140/#146/#254/#563; all
runtime/device/customer/production criteria remain separate and unchecked.
No unverified feature is declared completed by source authorship.

| Issue / area | Current local work | Remaining boundary |
| --- | --- | --- |
| #470 summary mail | Original-family binding, User/household locks and bounded transport; daily claim retained | Concurrency/two-household acceptance; scheduler remains disabled |
| #450 routines | Reviewed-start/viewer-day defaults; bounded per-series reads; gated household cursor with one-root claims and isolated failures authored | Broader routine/recurrence/role/device acceptance |
| #134/#450 routine visibility | API/SSR/Today/probe candidate+metadata batches before caps; other reads scoped; history skips open policy | Remaining core-query audit, dense-range latency, PostgreSQL/date/root-join plans and original acceptance remain unverified |
| #567 provider setup | Remove stale model/free-tier examples and misleading blank OpenAI hints; typed EN/ES prompts | Exact provider eligibility/privacy/transport decision; no activation |
| #142 localization | Chore/recipe/Meals/food-plan, board/activity settings and sync/shared controls and household join copy in typed EN/ES; stale preview/navigation guards; only owned copy records removed | Rest of localization and rendered/layout acceptance |
| #372 product brand | Lowercase wordmark in Settings product heading and account/invite email wording/default sender label | Legal operator/copyright decision pending Cameron; overrides unchanged; no mail sent |
| #499/#460 selected design | Compact Today controls, sibling calendar/chore cards, personal two-column composition, correct grocery totals and day-preserving dinner/recipe/prep links | Full accepted all-feature/role/device/rendered criteria remain |
| #464 helper | Help/Today/Add shortcuts with existing role/feature filters and draft-aware navigation | Existing AI/voice/review/privacy/runtime criteria; no second write path |
| #473 native contract | Per-platform capability/fallback matrix, support-window decision boundary and forward/rollback sequence | Actual supported binaries/old operations/hardware evidence and signing inputs |
| #557/#480 identity | Existing gated linking reconciled; unlink/rejoin design plus dormant pure routine/batch preflight authored | Unlink writer, former-association provenance, credit/Undo and wider member-domain parity remain unfinished |
| #564/#565 queue recovery | Existing source already implements retirement/generation and candidate retry; no duplicate engine added | Original storage fault/concurrency/lifecycle/rollback acceptance |
| #566 finance | Complete source-reconciled plan retained in its completed issue and local plan | FIN-0–FIN-7 implementation remains #134/#499 with #104 source approval |
| #146 support | 20-case runbook, response ownership, communication strategy and support scaling triggers defined | Actual recovery/privacy/dashboard/backup, publishing and staffed operating evidence remain |
| #134 Projects overview | Web24-card keyset pages and opt-in API paging; one grouped task-count query per returned page | Legacy API remains unbounded; query plans, compatibility, isolation/concurrency and rendered acceptance remain unverified |
| #141/#134 Notifications | Opt-in personal keyset API and older-page inbox reads; bounded timeout, exact retry, truthful loaded-state copy and old-server fallback | Original authorization/snooze/Undo/concurrency/rendered acceptance remains unverified; no delivery activation |
| #134 Wishlist | Opt-in household/requester keyset API; web24-item explicit continuation; canonical target inspection for write recovery; loaded-only EN/ES state | Legacy unpaged API remains unbounded; UI fixtures adapted/unrun; role/feature/concurrency/compatibility/query/rendered acceptance unverified |
| #134 Project detail tasks | SSR40-task keyset pages, whole-project grouped progress, draft-aware EN/ES page controls; opt-in API paging and additive index source | Legacy unpaged API remains unbounded; index unapplied; database/query-plan/concurrency/isolation/rendered acceptance unrun |
| #134 Project calendar send | Locked authority, 200-task candidate/match reads and opt-in count-only web summary; legacy event response retained | Legacy full result and all-send total work/lock duration remain unbounded within existing timeout; indexes unapplied; real acceptance unrun |
| #134 Recent changes | Canonical 20-entry page validation, bounded transport/body read, generation/abort and exact-cursor recovery source | Runtime/navigation/reconnect/body-timeout/loop and original household/privacy acceptance remain unverified |
| #104/#142 import form | Review-bound form plus opt-in actor/household precondition; locked writer renewal, scoped job accounting and rehearsal guide authored | Approved exports/maps and real reconciliation remain unavailable; server snapshot/lifecycle, repeat/concurrency/rollback and all QA remain open |
| #254 contraction | Backup-restore-only rollback contract defined separately from canonical backfill reversal | No drop/retarget/rehearsal; all original approval, no-legacy-use, restored-count/re-import and recovery evidence remain open |
| #563 voice modes | Tap-to-talk, Android system actions, Apple App Intents/Shortcuts, foreground phrase parsing and future local wake detector separated with source/official references | No native/permission activation or hardware go/no-go; all implementation/runtime/device/privacy acceptance remains open |

Latest bounded source work adds opt-in summary-v1 project-calendar responses
and connects the web sender (#134). Summary mode retains only a created count,
not a full event array, and returns a strict versioned created/no-tasks/all-sent
result. Legacy requests retain complete event-array responses. Unsupported modes
refuse before effects. Web requests the summary and validates coherent counts;
legacy/malformed success bodies, network failures and server errors are shown
as unconfirmed without automatic retry. No-tasks copy is distinct from already-
sent; generation/pending guards ignore late project results and duplicate taps.
Protocol/server/UI cases authored/unrun; original assertions adapted/retained.
No QA/tests/check/build/browser/API/database/household or release ran. Legacy
result memory, total transaction/lock duration, index application, true replay
receipts and original concurrency/compatibility/rendered acceptance remain open.

Selected connected plan: `docs/plans/simple-connected-experience-20261024.md`.
Standalone unlink contract: `docs/plans/profile-account-unlink.md`.
Native contract: `docs/architecture/NATIVE_API_COMPATIBILITY.md`.
Finance plan: `docs/plans/finance-archive-product.md`.

## Documentation completion evidence

#563's voice-mode documentation criterion is now defined in
`docs/product/CROSS_DEVICE_ROADMAP.md`; source inspection and official reference
review do not establish any native/permission/hardware acceptance.

Additional definition-only criteria on 2026-10-24: #146 public communication
strategy and support scaling triggers in `docs/runbooks/SUPPORT.md`; #254
backup-restore-only rollback in `docs/runbooks/MEALS_GROCERIES_BACKFILL.md`.
Their execution/readiness criteria remain unchecked. Exact mutation receipts
are retained in the recovery packet beside this checkout.

Only source/document-definition criteria were checked. This is issue metadata
reconciliation, not a QA run or validation of operating procedures:
- #134: https://github.com/camster91/family-planner/issues/134#issuecomment-6390456598
- #140: https://github.com/camster91/family-planner/issues/140#issuecomment-6390456925
- #146: https://github.com/camster91/family-planner/issues/146#issuecomment-6390457242

Repeated recovery notes were consolidated here after preserving named backups in
`../docs-before-status-consolidation-20261024/`; Git and #128 retain prior history.
The unchanged older release/checkpoint notes below are historical evidence.

---

## Web release shipped; bounded household follow-through — 2026-10-23

PR #595 merged as `3691e131010ffa98ac7c5ade0f41c440261b99ea` from checked
head52157152 with an identical source tree. Build/Test/fresh-runner container
39990787419, browser/accessibility/visual and ordinary/expanded Settings
39990787426, and unsigned Android39990787469 all passed. Coolify deployment594
finished; public version/health and running OCI revision match the merged source.
Live public phone/desktop journeys passed. This is web production verification,
not native hardware/store, external delivery or real household acceptance.

Current user scope is to close proved shipped issues, test core household flows
and fix observed bugs; extra features remain later. Nine bounded issues are
closed with evidence: #462/#461/#459/#458/#452/#447/#454/#536/#463. Additional isolated
PostgreSQL cover-lifecycle/chore-save proof passes9cases, and real phone/desktop
weekly create/edit/reload plus private list upload/overview/detail/foreign-file
checks pass against the unchanged b284 application source.

Household follow-through exposed strict selectors matching hidden streamed
content in signup/routine parent review. The bounded QA repair scopes existing
assertions to the accessible dashboard main and Get started region; app behavior,
API effects, expectations, privacy checks and test policies are unchanged. The repaired original signup/routine flows pass9/9 setup/journey cases on
phone390/desktop1366 without retries. Monthly history/empty-anchor deletion and
four-duration snooze/reload/Show now/private-child checks pass7/7 setup/journey
cases in the same isolated artifact. Older dated release-pending entries
below remain historical, not current production state. Current release receipts
and remaining original acceptance stay in #128 and the original issues.
Notification snooze #463 additionally passes controlled expiry against its real
PostgreSQL timestamp, persisted mark-read, and delete/Undo on phone and desktop;
notification UI/API source is unchanged from the served merge.

## Household validation security repair — 2026-10-23

PR #598 also repairs the newly disclosed runtime Zod resource-exhaustion issue
(GHSA-mrhx-c7xc-m3w5) by pinning patched4.6.6 and migrating the existing schemas
without a legacy-v3 bypass. Declared bounded arrays reject excess length before
walking their elements. Message read requests additionally enforce a256KiB body
and1000 explicit IDs; mark-all behavior and authorization order are preserved.
Independent source review found no concrete blocker. At `f8dcef98`, all three hosted
gates pass, including 703 suites/7,002 unit tests, PostgreSQL checks, six browser
viewports, unchanged loading limits, recovery rehearsal and the checked image on
a fresh runner. Existing guarded skips remain unchanged. Fresh protected backup,
81-table exact restore, repeat migrations and rollback-image verification also
pass; production3691e131 has not been replaced.

Final retry review reproduced a grocery-add readiness gap: going offline before
secure queue-owner bootstrap completes leaves Add active while new changes are
paused. The draft stays intact and no ownership check is bypassed. PR #598 is
held for a bounded readiness/submit guard and affected verification. Two other
retry diagnostics involve selectors matching canonical and recovery row copies,
not duplicate database records. Source changes after `f8dcef98` need their own
passing checks before the authorized merge and deployment. Extra features and
provider/native-store activation remain deferred.

## Loading budget repaired; current main integrated — 2026-10-23

Atad1657b1 all six original cold-start JavaScript budgets pass on phone390 and
desktop1366: Today246146 bytes against250000; the other five routes stay below
300000. The optimized build and all15 budget/setup cases pass, and the owned
database is dropped. Layout membership grouping removes duplicate code without
making async-only features eager; no budget, collector or feature gate changes.

The Settings0f0a916d run passes93 cases and fails12. Four local native-select
keyboard failures reproduce outside the app on macOS Chrome; the original
keyboard flow passed on hosted Linux and is retained for exact-candidate CI.
Eight readiness failures receive bounded test repairs preserving exact one-read/
no-refetch assertions. Hosted Settings/expanded QA remains required. Details and
failed evidence are preserved in docs/testing/WEB_QA_20261023.md.

Production and main now reportcd5521fe (dependency PR593), which has been merged
into this branch. A fresh combined build and hosted checks must pass before the
user-authorized protected merge/existing Coolify deployment. Previous755685f8
recovery evidence must be refreshed against the current image. No current-candidate
release or household acceptance is claimed.

## Today startup and Settings acceptance repairs — 2026-10-23

The latest user instruction authorizes the remaining Today startup-size and
Settings repairs, followed by merge/deployment when QA passes. The f3eada48
optimized artifact passes five route budgets, while Today remains286606 against
its unchanged250000-byte limit. Inventory ordinary acceptance passes64 cases
with2 original viewport skips atd0743925. Settings diagnostic improves to90
passing/15 failed atf3eada48; optional subscriptions readiness and platform-native
keyboard selection remain under repair. That Settings run crossed a dirty E2E
source boundary and is not exact-candidate release acceptance. Full evidence and
cleanup are recorded in docs/testing/WEB_QA_20261023.md.

The next source candidate separates core locale context and initial shell copy
from legacy route dictionaries and defers only the explicit legacy queue
migration engine. Canonical queue discovery/refusal, ownership, dictionaries and
provider-free/hydration behavior remain. A clean optimized measurement and
Settings rerun are required before hosted gates and the authorized release.
No merge, deployment, provider activation or issue acceptance is claimed.

## Integrated source repair batch frozen for consolidated QA — 2026-10-23

The implementation review of this repair batch is complete. It follows the
requirement-by-requirement source map in WEB_SOURCE_AUDIT_20261022.md; remaining
work is verification, repair of observed failures, and authorized release. No
additional feature expansion is needed to postpone QA. The fresh GitHub read
still has82 open issues with82 unique ledger rows and no missing/closed/duplicate
entries. All remain open pending their actual evidence and external dependencies.

Source review also removed hidden, mounted bulk/routine workspaces introduced
by the loading optimization: hidden dialogs must not retain an active focus trap
when a person changes views. The original view lifecycle and owned recovery
protocol remain in place. Calendar import has a localized loading status. This
checkpoint starts the consolidated QA phase; the unverified changes below must
pass before merge/deployment. Existing failed runs are retained as failures.

## Latest instruction: finish implementation before more tests — 2026-10-23

Cameron renewed the instruction to defer tests until the remaining implementation
is finished. No new test, build, browser run or CI-triggering push accompanies
this source follow-through. The current unverified repair batch restores the
approved personal Today geometry, keeps phone project menus inside the viewport,
resets fabricated fixture display preferences, and defers optional Today,
Explore, calendar-import, chore-review, routine and meal-editor code. Today customization retains its mounted opener and editor state; bulk/routine
view navigation keeps its existing mount and recovery lifecycle. Provider-independent
Capture ownership remains part of the implementation contract. Calendar import now shows a localized
loading status while its optional chunk loads.

The original77c115e1 hosted E2E run is terminal failure: Settings, Inventory,
portrait and fridge failed; phone and large-tablet/desktop timed out. Its
Build/Test/checked-image and Android checks passed, as did password recovery and
profile routines. These older results do not validate the current repair batch.
JavaScript budgets and visual acceptance remain unverified after the new changes;
limits and baselines have not been relaxed. Finish source review, freeze the
integrated candidate, then run consolidated QA and repair failures before the
already-authorized protected merge and existing Coolify deployment. No release
or household acceptance is claimed.

## Consolidated repair QA resumed — 2026-10-23 UTC

The latest implementation-first follow-through is complete and consolidated QA
has resumed. At46de5302, typecheck and changed assistant/Capture/config lint pass;
affected AssistantHost tests pass46 cases, including deferred EN/ES hydration.
The isolated development Chrome owned Capture/inbox/unknown-result journey passes
both phone locales with one canonical save each, exact receipt recovery, no page
errors/unexpected writes and database cleanup. This is not optimized/hosted proof.

The older77c115e1 Build/Test/checked-image, Android, password-recovery and six-size
profile-routine checks pass. Settings/Inventory failed and have local source
repairs; four viewport shards are still live. Preserve their results before the
next integrated CI-triggering push. No merge/deployment/provider activation or
full issue acceptance is claimed. See WEB_QA_20261022.md for exact evidence.

## Latest instruction: finish code before further tests — 2026-10-22

New test/build/browser runs and CI-triggering pushes are deferred for this
implementation follow-through. Existing hosted77c115e1 runs may finish and retain
their own identity. Adopted Capture/inbox recovery browser coverage and its
isolated provider-free six-viewport hosted job are now authored but unrun; see
WEB_IMPLEMENTATION_HANDOFF.md. Ordinary legacy gates/defaults and production
settings stay unchanged. No merge, deployment or acceptance is claimed. The full
web goal remains active through consolidated QA and verified release.

# Current State

## Repaired candidate ready for hosted QA — 2026-10-22

All currently identified source repairs are complete. The integrated candidate
adds guarded auth-form hydration, late-reveal Capture focus, body-independent
401/403 availability revocation, foreground inventory recovery and Next parallel
slot typing. Adaptive UI browser scenarios preserve current canonical protocols,
role/privacy/recovery assertions and original gate coverage. No deployment or
provider/production activation is implied.

Typecheck passes atd4cccf40, full configured format passes, repository lint passes
with45 warnings and final changed-file lint has0 errors/warnings. Auth units pass
82 cases, Capture units63 and inventory-area units105 at the source identities
recorded in WEB_QA_20261022.md. All3375 E2E cases collect; collection is not a
runtime pass. The repaired legacy Capture phone journey passes on loopback-only
development source with no page errors/canonical writes. Its preview/browser are
closed and its isolated database is dropped; existing QA PostgreSQL is retained.
A new hosted candidate must pass original full-build/database/image/browser/visual
gates before protected merge and existing Coolify source-build deployment.

## Consolidated browser failures and Capture focus repair — 2026-10-22

Run39874900393 is terminal failure. Inventory failed; all four general viewport
jobs and Settings reached their40-minute limit and were cancelled by the runner.
Password recovery and six-size profile-routine jobs passed at2125c339. None of
the unfinished/expanded/visual coverage is treated as passing. Completed job
logs are retained locally and source repairs are being batched before another
CI-triggering push, with explicit per-agent file ownership.

Source review confirms a legacy Capture focus race: the Dialog opens while the
owner-renewal boundary hides its input, and a successful renewal did not repeat
the missed focus. A pending-open focus request now waits for that same boundary
to reveal the available input, without stealing later focus. A real-boundary
regression covers deferred owner renewal, close/reopen and unsent text retention.
Adopted manual rows/saved reviews remain provider independent; no availability
policy is changed to satisfy old extraction-only assertions.

## Preserve typed inventory refusal semantics — 2026-10-22

The wider14-suite inventory check found4 EN/ES/pseudolocale failures in the
new collision change. Canonical idempotency rejects a different request hash
before applying this input; current intake correctly reports a definite refusal,
keeps it editable and creates a new key only for a fresh explicit send. The
2349bae6 collision change is reverted; legacy browser assertions now match the
typed refusal without guessing earlier commitment or showing raw server text.
Unknown-result frozen-key recovery and the foreground editor repair remain.
The failed area run remains failed evidence until the repaired suite passes.

## Repaired source handed back to consolidated QA — 2026-10-22

Local commit2349bae6 completes the known inventory code repairs after renewed
test deferral. Source inspection traced the updated intake/change/read envelopes,
foreground recovery, collision exclusion and fixture cleanup against their
canonical implementations. The prior requirement-by-requirement source audit
continues to cover the approved web scope; no new speculative scope is added.
Consolidated verification can resume on this integrated candidate. Existing
hosted39874900393 jobs remain on2125c339; their pending/failing results cannot
validate these repairs. No release readiness, production change or issue closure
is claimed. Native/provider/operator/customer acceptance stays separate.

## Renewed test deferral and inventory repairs — 2026-10-22

Cameron asked again to finish code and known repairs before more test runs.
No new test/build/browser run or CI-triggering push accompanies this follow-through.
Existing hosted runs keep their original source identity and can finish.

Source inspection of the failed inventory job120158591798 at2125c339 found
legacy browser interception/receipt expectations and a missing bound-read scope
header in controlled paging. Scenarios now target owner-scoped intake/change,
validate owner envelopes, distinguish definitive refusals from unknown outcomes,
and retain exact retry/body/key, canonical database and duplicate-exclusion proof.
Two application repairs keep the item editor below the stock recovery sheet and
require explicit selection after a scan key collision. Existing unit/browser
coverage is updated but unrun. These changes are not a passing QA result; no
merge, deployment or issue closure is claimed. Remaining hosted outcomes and the
full repaired candidate still require consolidated acceptance before release.

## Consolidated QA active after completed source pass — 2026-10-22

The implementation-first pass is complete, including the canonical-page list
Add/Undo repair. Consolidated QA is now active under Cameron's sequence. Current
follow-through fixes QA parent-home synchronization and its formatting; application
and migration source remain stable. Earlier implementation-only/deferred-test
entries below retain their original checkpoint meaning. See WEB_QA_20261022.md
and PR595 / the existing #128 checkpoint for current failures, repairs, source
identities and running gates. No production merge/deploy or activation is claimed.

## Renewed implementation-first instruction — 2026-10-22

Cameron again asked to skip tests until everything is implemented. Defer further
local tests, builds, browser QA and pushes that trigger CI while remaining code
is finished. Existing hosted runs and earlier evidence retain their original
source identity. The remaining list-detail Add/Undo pagination repair now
refreshes canonical pages instead of inserting a newly appended row into an
unrelated page, with localized confirmation. This repair is source only and
now has authored regression coverage awaiting consolidated QA. Merge and deployment remain
subject to the existing release gates after implementation is complete.

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

## Implementation-first bounded Today dinner previews — 2026-10-22

Today now reads at most two dinner candidates per covered UTC day, shows the
first and explicitly signals additional dinners. This replaces the unbounded
window read without claiming the preview is every meal. Nested ingredient reads
use a lookahead cap; missing counts remain unknown for incomplete data. Shared
readers still omit ingredients, cache accepts the optional more flag and canonical
Meals remains the full collection. Query/compatibility/index/retention/load work is
mapped in CORE_QUERY_PLAN.md. Source/formatting only; QA remains deferred.

## Implementation-first list item pages and matching sync — 2026-10-22

List detail now reads100 items plus one lookahead in a repeatable-read snapshot
with current actor/family/role/generation renewal and bounded section metadata.
Explicit EN/ES Next/first controls and page-only progress/grouping avoid implying
a partial list is complete. Partial absence no longer means deletion; independent
pending tick recovery stays reachable. Version polling uses the same bounded
page/lookahead, with stale page-response guards. Optional item API paging keeps
legacy full responses and deprecation headers. Failed reads now show Retry rather
than not-found/empty. Source/formatting only; consolidated QA remains deferred.

## Implementation-first web list pages — 2026-10-22

The Lists overview now uses100-summary server pages with explicit Next/first-page
navigation. Type filters query the full household, fixed bounded type aggregates
keep counts/discovery exact, and checked-item aggregates cover only page IDs in
the same renewed-authority snapshot. Later empty pages do not claim an empty
household. List detail/Back/delete return context preserves the validated overview
cursor. Formatting/source only; tests and rendered QA remain deferred. List-item
detail and legacy unpaged API consumers still need separate follow-through.

## Implementation-first compatible list API paging — 2026-10-22

The canonical list-summary GET now supports optional limit/cursor paging with
family/type-bound cursors and stable creation-time/ID order. Older no-limit
clients retain their complete response and updated-first order. No write/schema/
index/provider change. The web overview/detail still need their own continuation;
this is not full collection/scale acceptance. Source formatting only; tests and
builds remain deferred. API_CONTRACTS.md records compatibility and deferred cases.

## Implementation-first draft recovery explanations — 2026-10-22

Capture and recipe draft boundaries now share EN/ES explanations for conflicting
copies, unsupported saved formats, size limits, changed intents, paused saving,
expired retry windows, changed owners and unavailable storage. Messages contain
no saved fields/keys, promise no automatic conflict resolution and retain the
existing recovery/owner masking controls. The journal's exact-baseline refresh
already refuses external changes; no replacement journal or automatic adoption
was added. Formatting only; consolidated QA remains deferred. Details and later
QA cases are recorded in WEB_IMPLEMENTATION_HANDOFF.md.

## Implementation-first list summary counts — 2026-10-22

Lists overview now uses same-snapshot database counts instead of hydrating all
item checkbox rows. Its new reader renews verified cookie generation/family/role
and derives progress/creation controls in a repeatable-read transaction; failed
reads remain retry states. Formatting only, further QA deferred. This does not
cap list-summary/legacy API/detail collections or prove performance; those stay
explicit in#134. See WEB_IMPLEMENTATION_HANDOFF.md and OBSERVABILITY.md.

## Implementation-first inbox session boundary — 2026-10-22

The review page now carries its verified cookie generation into current-parent
SQL. Bounded checks/preparation reads distinguish authorized empty results from
revoked/foreign/downgraded authority; saved/capture/change admission renews too.
Legacy getServerUser/client identity shapes are preserved. Source/fixture field
and formatting only; no new tests, build, browser, CI or DB queries. The disk-full
formatting interruption was resolved by deleting only verified failed .next output;
source/dependencies/evidence remain. Details and later QA matrix:
`docs/plans/review-inbox-v1.md` and WEB_IMPLEMENTATION_HANDOFF.md.

## Implementation-first meal-week paging source — 2026-10-22

Opt-in meal API keyset paging and the connected web Load more/read hook are now
written. Range/family cursor binding, explicit incomplete-state copy, abort/
request guards, repeat-cursor refusal, outage retry, auth-refusal clearing and
mutation/Undo loaded-depth preservation are authored. Legacy no-limit responses
remain complete. No schema/index/provider change; formatting only, all further
QA deferred. Today dinner, legacy unpaged and list/item collection work remain
explicitly open in#134; no full-scale or runtime acceptance claim. See
WEB_IMPLEMENTATION_HANDOFF.md and API_CONTRACTS.md.

## Implementation-first guidance gap filled — 2026-10-22

Original#562 review found missing chore/routine/prep discovery in the deterministic
app guide. Five direct topics now share EN/ES canonical Help answers, role/feature
links and owned draft navigation; assistant/Explore hosts close only after an
accepted guide handoff. No model/household-context/write source was added.
Source formatting only; further checks remain deferred by Cameron's latest
instruction. Source/backlog reconciliation continues. This does not renew earlier
QA receipts or claim release/issue acceptance. See WEB_IMPLEMENTATION_HANDOFF.md.

## Clean-runner release candidate preparation — 2026-10-22

Clean45252ce1 recovery receipt passes all7 steps with its exact source SHA
(run.VxVosD). Local optimized build compiles/types/generates73 pages, then fails
ENOSPC assembling standalone; retry also hits ENOSPC. Neither is a build pass.
Generated checkout compiler/Jest and npm download caches were cleared without
removing source or installed dependencies. Hosted build/browser checks are next.

Fetched main755685f8 (3 new upstream commits) and merged its login/elevation
lockout fix without conflicts; affected2 suites/59 tests pass. The same dependency
security versions are retained. Gitleaks8.30.1 scans the tracked source and170
branch commits clean after one exact path/rule/test-title false-positive match is
scoped in config. Ignored local generated framework keys, fixture auth files and
QA logs are not published and are not counted as tracked-source findings.
Prior all-unit/DB results remain atbbb3c3b0; merged-source CI/browser acceptance,
protected merge/deploy and native/device/store acceptance remain open.
Evidence:`docs/testing/WEB_QA_20261022.md`.

## Full unit/database pass; recovery rehearsal pass — 2026-10-22

Atbbb3c3b0 all702 unit suites/6971 tests and all85 PostgreSQL suites/561 tests
pass. Format check passes. Backup/restore rehearsal passes81 table comparisons,
143 restored rows, identical schema, two unchanged migration passes and Prisma
smoke after replacing GNU-only stat with a POSIX byte count. Its guard suite
passes16 cases; first failed rehearsal is retained. Final build/rendered/browser,
current-source recovery receipt and protected merge/deploy are next. No hosted
or production state changed. Evidence:`docs/testing/WEB_QA_20261022.md`.

## Database contract repairs and timezone-safe history — 2026-10-22

Complete unit rerun at1429e942 passes702 suites/6971 tests (83 opt-in suites/547
tests skipped). Full PostgreSQL rerun improves to74 passed /11 failed suites,
542 passed /19 failed tests with no connection exhaustion. All11 failing suites
now pass99 focused cases after repairs: timestamp-without-timezone provenance
comparison, unchanged fixture updates, complete household deletion fixtures and
current auth/recovery/source-version expectations. Types/lint pass (44 warnings); complete DB/unit
reruns remain next. Browser/recovery/current-build and
protected merge/deploy remain open. No production/provider state changed.
Evidence:`docs/testing/WEB_QA_20261022.md`.

## PostgreSQL integration baseline and pool/profile fixes — 2026-10-22

First broad DB run at944bde34:55 passed /29 failed suites;425 passed /135 failed
tests. Seed twice passes. Pool ownership now releases actual PostgreSQL backends
on disconnect and permits reconnect. Explicit generated-client admission and
legacy-schema teardown repairs preserve email-free profile/Today proof. A controlled
legacy32-test run followed by22 profile/Today/pool cases passes; types/lint pass
(44 warnings). Broad DB/final-source unit reruns remain required. Previous complete
unit pass:702 suites/6971 tests at06d651db. No release/production acceptance claim;
DB domain failures, browser/recovery/build and protected merge/deploy remain open.
Evidence:`docs/testing/WEB_QA_20261022.md`.


## Complete unit pass; fresh PostgreSQL16 schema repaired — 2026-10-22

Full unit run at06d651db passes702 suites/6971 tests;82 DB suites/546 tests remain
opt-in skipped in that run. Local PostgreSQL16.14 fresh migration exposed inventory
foundation ordering; the unchanged SQL now runs before dependent food extensions.
Interrupted-install resume and two fresh passes exit0. Prisma schema now matches
actual UUID-default spelling and existing NoAction FK behavior; final drift check,
validate/client generation and types/lint pass (44 warnings). No production/provider
or hosted state changed. Guarded integration suites are next; browser/recovery,
current-source build and protected merge/deploy remain open. Evidence:
`docs/testing/WEB_QA_20261022.md`.


## Source copy inventory reconciled — 2026-10-22

Reviewed copy delta now tracks637 records/652 occurrences without changing scanner
coverage or waiving new findings. A removed-device badge uses its existing EN/ES
catalog; mounted locale regression proves no repeated request. Four focused suites
pass21 tests; types/lint pass (44 warnings). Full baseline is still14 failed
suites/36 tests at5edccfa6; subsequent targeted recovery/UI tests pass181 checks.
Full unit rerun and local disposable PostgreSQL16 validation are next; rendered,
recovery, final build and hosted release gates remain open. Broader #142 debt
remains explicit. Evidence:`docs/testing/UI_COPY_RECONCILIATION_20261022.md` and
`docs/testing/WEB_QA_20261022.md`.


## Recovery scripts and compact UI QA repairs — 2026-10-22

Latest full run at5edccfa6:14 failed /687 passed /82 skipped suites;
36 failed /6932 passed /546 skipped tests. Subsequent recovery/UI repairs pass181
checks across14 suites. Types/lint pass (44 warnings). Backup date parsing supports
local BSD tooling and ignores invalid timestamps; Bash tests use an existing modern
runtime. Crash/retry, locale queue continuity, device purge, compact Help/Today and
server-rendered shell checks retain their intended safeguards. No tests removed
or newly skipped. Copy-inventory audit/reconciliation remains, along with full
rerun and DB/browser/recovery/final-build/hosted gates.
Evidence:`docs/testing/WEB_QA_20261022.md`.


## Inventory capture recovery tests aligned — 2026-10-22

Five inventory suites pass48 tests with valid receipts, exact lost-response retry
bytes/keys, translated private drafts and the original Undo/focus timing. Tests
await actual navigation release; production recovery behavior is unchanged.
Types/lint pass (44 warnings). Prior settings/board and device admission repair
is committed at48ae6b68; full baseline remains26 failing suites/72 tests at9d847a2c.
Full rerun plus DB/browser/recovery/final-build/hosted checks remain open.
Evidence:`docs/testing/WEB_QA_20261022.md`.


## Settings and device admission QA repair — 2026-10-22

Latest complete run at9d847a2c:26 failed /675 passed /82 skipped suites;
72 failed /6892 passed /546 skipped tests. Subsequent settings/board repairs pass
118 affected tests; expanded device admission matrix passes15 tests. Known calendar
provider returns reveal their Family result; unknown outcomes remain untouched.
Archived chores retain history labels while current planning requires active
profiles. Person-only routes retain explicit tablet refusal and zero-write/canary
checks; device queue endpoints and all25 kill-switch files are covered.
Full rerun and DB/browser/recovery/final-build/hosted gates remain open.
Evidence:`docs/testing/WEB_QA_20261022.md`.


## Calendar and archived profile QA repairs — 2026-10-22

Latest complete run at f1f9ae13:37 failed /664 passed /82 skipped suites;
102 failed /6858 passed /546 skipped tests. Subsequent repairs pass80 affected
tests across11 suites and33 contract checks across4 suites. Calendar version tokens
accept enriched canonical rows; archived profile history keeps its label while
active-state action guards remain. Types/lint pass (44 warnings). No tests removed
or newly skipped. Full rerun and DB/browser/recovery/final-build/hosted release
gates remain open. Evidence:`docs/testing/WEB_QA_20261022.md`.


## Compact settings role checks aligned — 2026-10-22

All8 settings role cases pass across the actual compact client tabs and a separate
Node server-projection suite. Teen negative checks include hidden private content;
DB role/secret/child-redirect assertions remain. No cases or role protections were
removed. Types/lint pass (44 warnings). Recipe/meal source atc357fade also has114
affected passing tests, but latest full suite is still the older50-failure baseline.
A new complete run is next. DB/browser/recovery/build-for-final-candidate and hosted
release gates remain open. Evidence:`docs/testing/WEB_QA_20261022.md`.

## Recipe/meal QA repair batch — 2026-10-22

Ten affected recipe/meal suites pass114 tests; full types/lint pass (44 warnings).
Source repairs preserve unchanged legacy unknown recipe servings, bound collection
requests, and block inline recipe actions through the canonical meal-create
pending/unknown state. Existing same-batch action, Undo/navigation, exact request,
role/recovery and localization assertions pass with current explicit fixtures.
No null create or guessed count was added. Build/smoke evidence at22968838 is for
the prior code and is not final-candidate acceptance. Full units/DB/rendered/
recovery/hosted release gates remain open. Evidence:`docs/testing/WEB_QA_20261022.md`.

## Local optimized packaging and startup pass — 2026-10-22

At22968838, the clean Next16.4.2 optimized build exits0 with private physical
node_modules inside this checkout:TypeScript and73 static pages complete; no
standalone tracing exclusions. Five local standalone checks pass:health/live,
exact source version,login,register and signed-out dashboard redirect. Source/
build-ID/hash manifest and bounded loopback-only runtime observations are retained.
No DB/email/provider/hosted state changed. Deprecation/Tailwind warnings remain.
The latest full suite still has50 failing suites/171 tests at2332faf4; further
repairs, full units/DB/browser/recovery and authorized hosted release gates remain.
Exact evidence: `docs/testing/WEB_QA_20261022.md`. This is not production acceptance.

## Optimized build passes compilation; packaging recheck — 2026-10-22

The patched Next16.4.2 build at22968838 exits0, including TypeScript and73 static
pages. Local standalone output excluded27 files because the private dependencies
were outside its tracing root. That output is not release-ready. The private
install is now physical node_modules inside this checkout, leaving shared trees
untouched; client generation passes again. A clean packaging retry is running at
the same source. Exact evidence and open gates: `docs/testing/WEB_QA_20261022.md`.
No production tracing configuration, protected merge or deployment changed.

## Client/server build boundary and dependency patches — 2026-10-22

The initial optimized build failed because client rotation imports reached server
lifecycle/Node crypto. Pure rotation rules now have a browser-safe module, with
server exports retained. The production dependency audit found2 critical packages;
the patch lock now uses Next16.4.2 and transitive DOMPurify3.4.17 and audits clean.
An isolated dependency install replaces only this checkout's symlink; the shared
runtime tree was preserved. Client generation/types/lint pass;11 focused suites/
205 tests pass (44 lint warnings). Full-suite failures and new optimized-build/
DB/browser/recovery/hosted checks remain. No protected merge, deployment, provider
activation or production data change occurred. Exact logs and limits:
`docs/testing/WEB_QA_20261022.md`.

## Consolidated QA: third full run — 2026-10-22

Full run at2332faf4 exits1:50 failed/650 passed/82 skipped suites;
171 failed/6788 passed/546 skipped tests,169.141s. The next focused settings/privacy
and session-contract batch passes4 suites/52 tests. Privacy tests follow compact
navigation; logout tests preserve conditional generation/recovery proof and add a
stale-logout race. Details and failed logs: `docs/testing/WEB_QA_20261022.md`.
Remaining full-suite failures and build/DB/browser/recovery/hosted release gates
remain open. No production merge/deploy or activation occurred.

## Privacy and canonical receipt QA repairs — 2026-10-22

The next focused batch passes12 suites/184 tests, including account/household
deletion, safe exports/recipe collections, User/member FK inventories and
notes/recipe/chore isolation/rotation. Full types/lint pass (44 lint warnings).
Household deletion now explicitly probes/clears additive profile-link and AI
accounting/policy tables before identities, preserving missing-table rollback
compatibility and device-credential-first ordering. Inventories classify80 User
relations and9 member relations with explicit erasure decisions. Test fixtures
now model standard Response.ok, chore erasure defaults, raw SELECT arrays and
recipe collection relationships; permission checks remain real. Exact evidence:
`docs/testing/WEB_QA_20261022.md`. Real PostgreSQL/migration, full-unit, build,
browser/recovery and production release gates remain open; no live data changed.

## Consolidated QA: second full run still failing — 2026-10-22

At `16382305`, the full serial suite exits1:81 failed/618 passed/82 skipped
suites;271 failed/6679 passed/546 skipped tests. This is progress, not release
acceptance. Types/lint/schema/configured formatting pass; lint retains44 warnings.
The28 focused repair suites pass235 tests. The full run also exposed shared
crypto state in browser test setup, now isolated to each jsdom environment.
The exact evidence and unfinished gates remain in `docs/testing/WEB_QA_20261022.md`.

## Consolidated QA: first unit failures and recovery repairs — 2026-10-22

The first full unit baseline at `e4aa6cdb` failed (95 failed/601 passed/82 skipped
suites; 347 failed/6504 passed/546 skipped tests). No skips/assertions were added
to hide failures. Main `2484ac37` was integrated locally at `cc078155`; the four
integration-focused suites pass (31 tests). Full typecheck and lint pass after
recovery repairs; lint still reports44 warnings.

Repairs address capture access refusal before body decoding, strict schedule
command/query projection, journal display metadata leaking into editable draft
writes, serialized overlay query preservation, and bounded recipe curation reads/
writes. Browser unit configuration/fixtures now exercise previously unexecuted
component cases. Exact evidence and remaining gates are in
`docs/testing/WEB_QA_20261022.md`. Final full units/build/DB/browser/recovery and
hosted release checks remain. No production merge/deployment is claimed.

## Consolidated web QA: initial static repairs — 2026-10-22

Prisma client generation passed with Node22.23.3/Client7.10.0. The initial full
typecheck found107 diagnostics; repairs reduced them to14, then0, with a final
exit-0 repeat. Full lint initially found1 error/44 warnings; after repairing the
app-link fixture it exits0 with0 errors/44 warnings. No checks or assertions were
removed/suppressed. Failed and final logs are retained. Exact scope and commands:
`docs/testing/WEB_QA_20261022.md`.

Repairs include missing runtime imports, partial routine draft/send typing,
owner-journal metadata and async typing, immutable captured context, selector/page
props and fixture/API-contract mismatches. This is initial local QA evidence,
not full acceptance. Unit/build/database/browser/compatibility/hosted/recovery and
release gates remain; no production/flag/provider/push/merge/deploy change occurred.

## Implementation-first handoff to consolidated web QA — 2026-10-22

The scoped approved web flows now have connected source paths: owned capture/
recipe drafts and exact recovery; role/profile/shared projections; routine copy
provenance/editor/history; inbox and authorized timeline; grounded references/
canonical food planning/confirmation; private usage/feedback/evaluation; aligned
contextual web discovery. The requirement-to-code/QA map is
`docs/engineering/WEB_IMPLEMENTATION_HANDOFF.md`. Earlier initial-code gaps below
are historical checkpoints, not evidence those paths are still absent.

This is implementation handoff, not verified correctness or completion. The next
phase is consolidated local generation/types/lint/unit/build, then disposable-DB/
compatibility/concurrency and rendered role/state/locale/accessibility checks.
Repairs are expected if checks expose gaps. No check, flag activation, push, merge
or deployment is claimed by this handoff; the full goal remains active through
verification and authorized release. Native/store/hardware/provider/customer
acceptance and gated external decisions remain distinct in existing issues.

## Versioned AI evaluation code and source reconciliation — 2026-10-22

The canonical AI contract evaluator now has fifteen fabricated cases with fixed
independent expected facts and a strict content-free report. Missing cases remain
in the denominator, duplicates/wrong dimensions refuse, and errors stay errors.
An explicit later-QA command can write its report into ignored test-results.
A separate eighteen-case reviewed-provider profile adds timeout, rate-limit and
unknown-retry observations. It requires explicit review markers/times, records
only evidence digests/fixed grades/numeric metadata, separates passed refusal cases
from delivered usable replies, and keeps unknown cost/latency/grades unknown.
Neither report can approve AI activation or claim overall product quality.

No evaluator, test, provider, API, DB, schema/client, browser, build or CI command
ran. Only source inspection/authoring and explicit-file formatting. The new
`test:ai:contracts` package script is for consolidated QA after remaining code.
See `docs/testing/AI_EVALUATION.md` for exact scope and remaining real observations.

The source pass also traced current parent/own-account/shared preparation readers,
immutable routine-copy facts, canonical editor/history consumers and timeline
routine-copy support. Those implementations exist; older checkpoint prose saying
those paths need initial code is historical. This is a source map, not proof of
privacy, role, history or rendered acceptance. The full remaining web source/issue
reconciliation continues before QA, authorized merge and deployment; no issue was
closed or runtime readiness changed.

## Explain unresolved meal commitments — 2026-10-22

The compact food review now explains missing recipes/ingredient details, uncertain
portions/units/recorded stock, inconsistent prep history and overdue unprepared
sessions in EN/ES. Correction buttons open canonical Meals at the recorded date
or Bulk cooking through the owning sheet's draft-aware router. These are navigation
intents, not exact-record edit claims, hold overrides, completed reviews, stock
writes or assumptions that free-text needs are zero. The prepared-portions manage
control also uses that guarded callback; read-only AI summaries have no raw link
that bypasses the owned draft. Refresh must rebuild sources before save review.
Mounted source coverage is authored/unrun. No QA/browser/API/DB/schema/flag/provider/
push/merge/deploy or closure. Wider semantic evaluation and full-goal source audit
remain before consolidated QA and authorized release.

## Assistant meal handoff and optional suggestion counts — 2026-10-22

Chat now supports fixed canonical meal/prep planning and own saved-work recovery
links. The action schema accepts only named destinations; no generated dates,
record IDs, preferences, arbitrary URLs or write payloads enter a handoff. Existing
role/feature checks and draft-aware navigation remain. The local assistant panel
also offers the existing compact planning/recovery disclosure without a provider
call or journal read. Destination hosts retain current capability, recovery,
shared/fridge and preparation guards; chat does not submit, retry or replace work.

Optional Use/Keep counts are source-authored under the existing household usage-
count opt-in. An opaque signed, person/family/role/generation-bound ten-minute
ticket permits one fixed decision. Current person and opt-in are locked/rechecked;
a strict aggregate write and minimal deduplication receipt commit together. Same-
body retry replays; a contradictory decision refuses. Off creates no count or
receipt. Existing opt-out deletes aggregates, and old receipts prevent recounting
a previous decision after re-enabling. No prompt, preference, recipe details,
source IDs, provider output or raw ticket is stored in count/receipt content.
Receipts use existing seven-day lifecycle; aggregates retain existing thirteen-
month privacy rules. No new table, migration, scheduler or provider call.

Only an explicit Use after durable draft adoption or Keep sends feedback. Closing,
expiry, unknown replies, failure and navigation do not imply a decision. Feedback
failure never changes the draft/save outcome, and no offline outbox/automatic
retry is added. The parent AI panel can request separate monthly Use/Keep counts;
legacy report responses omit the extension unless the client sends its versioned
header. API reply acceptance remains distinct from choices and domain saves.

Role/schema/client/proof/opt-out/replay/API and guarded disposable-PostgreSQL race/
rollback cases are authored and **unrun**. No tests/typecheck/lint/build/browser/
API/DB/schema/provider/flag/push/merge/deploy or issue closure. Remaining food
commitment review, wider semantic evaluation and full-goal source reconciliation
precede consolidated QA and authorized release. The full goal stays active.

## Metered AI meal choices and explicit draft adoption — 2026-10-22

An optional personal Meals AI path is now source-authored. It ranks at most four
canonical recipe candidates per slot through opaque, owner/source/slot-bound
references. The minimized provider packet contains recipe/ingredient names,
recorded quantities and timing/calendar-state estimates, not canonical IDs,
URLs, owner metadata, notes, instructions or event names. A shared opaque recipe
identity supports repeat constraints. Output is strict reference selection only;
invented/cross-slot references, missing slots, extra actions and unintended repeats
refuse. Pinned recipes remain pinned. Incomplete/occupied/unresolved-commitment
sources refuse before provider dispatch; unknown quantities/durations remain held
estimates rather than invented facts.

The server requires existing quota/cost observation with no unmetered fallback,
renews person/role/generation/features/provider configuration and original source
identity after latency, then reconstructs the selected query in the same canonical
read snapshot. The original one-minute lease is never refreshed. The new example
`FAMILY_FOOD_AI_READY=0` also requires existing food/AI-usage gates; no real settings
or provider activation changed. Usage uses the existing assistant accounting
bucket; API outcome counts are not user acceptance or successful domain saves.

The EN/ES sheet offers explicit optional provider disclosure and a durable local
cooking preference. AI choices render separately, one at a time. Use these choices
copies recipe IDs into the owned draft, clears groceries for changed recipes,
persists editing, and obtains a new canonical preview. Exact save review and
confirmation remain separate. Dismiss, failure, pause and expiry preserve the raw
draft and provider-free controls. No meal/prep/grocery/stock write follows a reply.

Versioned grounding/feasibility metrics validate issued choices, intent, owner,
servings, pins, repeats and original lease. They do not rate nutrition, safety,
preference satisfaction or overall app quality. Catalog/client/editor/service/UI
cases are authored and **unrun**. No test/typecheck/lint/build/browser/API/DB/schema/
provider/flag/push/merge/deploy or issue closure. Broader chat handoff, fixed-vocabulary
accept/dismiss telemetry and cross-feature evaluation source remain before final
consolidated QA and authorized release; the full goal remains active.

## Meal and bulk work in review discovery — 2026-10-22

The parent inbox Saved requests reader now supports meal planning and canonical
bulk work through the same read-only owned-store snapshot/lease machinery as its
existing domains. It projects generic labels, editing/submitted phase, recorded
request times when available and fixed recovery URLs. It does not copy raw drafts,
names, notes, request keys, IDs, proofs or quantities into inbox state. Missing
draft/prep timestamps remain explicitly unknown. Every candidate store and current
owner/household/generation is rechecked; discovery does not initialize a competing
journal, inspect receipts, reconcile replicas, resend, forget or write queue data.

Weekly meal/prep/food/grocery steps now offer a compact personal planning/saved-
work disclosure. Parent/teen capability links open canonical recovery/planning;
children receive no new private links. Navigation respects active owned drafts and
weekly pending/storage guards, and never marks progress reviewed. No local counts
or provider calls run on weekly mount. An explicit bulk recovery URL now obtains
current person authority independently of a failed current-list read, preserving
receipt inspection when targets/list data are unavailable. Editable target restore
still requires its canonical reads; current-list failure blocks fresh saves.

Adapter/readonly/owner/replica/null-time, personal-link and target-independent
recovery cases are authored and unrun. Fridge/preparation omissions and parent
inbox limits remain. No checks/browser/API/DB/schema/provider/flag/push/merge/deploy
or issue closure. Broader chat/provider/AI evaluation and remaining full-goal source
still precede consolidated QA and authorized release.

## Bulk forms and owned recovery controls — 2026-10-22

Bulk creation and action sheets now share one panel-owned recovery controller,
strict raw-field conversion and existing CAS journal. Draft fields debounce into
local storage; close/navigation flush the latest form reader. Save compares the
current raw draft and actual canonical payload before atomic draft promotion,
then explicitly inspects/sends that immutable key/body. Unknown replies retain
frozen requests; confirmed results remain separate from later read/storage errors.
Fields cannot turn a saved request into a second save. Closing an owned sheet
keeps its work and receipts rather than implicitly discarding it.

Compact EN/ES controls provide draft restore, one-request-at-a-time inspection/
exact retry/known-result dismissal, acknowledged local forgetting/stored-copy
reload and exact storage repair. Action restore reloads the same canonical target;
missing, incomplete or unprepared reuse targets preserve the draft. Prepared-dish
handoff waits for recovery state and cannot overwrite an existing draft. Back and
owned exit guards preserve current readers; newer edits during a storage write
remain dirty and prevent navigation until durable. Owner changes suppress private
work without erasing original storage. Existing empty owned envelopes preserve
adoption through a pause, so new web work does not silently fall back to legacy.
Legacy flag-off/no-journal journeys remain separate; readiness stays off. Personal
recovery/forms are omitted from fridge mode and while event preparation owns the
sheet; no private owner context is seeded into layout.

Conversion/controller/form/shelf/Strict-Mode/owner/pause/storage-race cases are
authored and unrun. No tests/typecheck/lint/build/browser/API/DB/schema/provider/
flag/push/merge/deploy or issue closure. Wider unified inbox/weekly/chat adapters,
provider/evaluation and broader goal source remain before consolidated QA and
release. See [`meal-prep-recovery-v1.md`](./plans/meal-prep-recovery-v1.md).

## Bulk owned-recovery source foundation — 2026-10-22

Strict local-only create/action draft and frozen canonical bulk request contracts,
person/role/generation-bound context/apply/receipt-inspection endpoints and an
existing-owned-journal browser adapter are now source-authored. Apply reuses the
canonical bulk effect with exact receipt/status/target/count validation in an
atomic transaction. Canonical refusals throw for rollback; readiness and the
original24-hour retry lease are checked before commit. Completed receipt replay/
inspection precedes lease/readiness/target availability. Every explicit send is
inspected; nonmatching replies remain unknown with original key/body retained.

The independent readiness example is0, with existing owner/rollback gates required.
No actual setting or schema changed. Unit/HTTP/client/storage-fault and allowed
PostgreSQL rollback/replay cases are authored and unrun. Existing bulk forms still
use their memory-held hook: wiring one panel-owned controller, raw-draft flush/
restore/promotion, compact recovery/discovery and wider inbox integration remain
source work. This foundation is not a completed durable bulk UI or release. No
QA/API/DB/schema/provider/flag/push/merge/deploy or issue closure. Full goal remains
active; see [`meal-prep-recovery-v1.md`](./plans/meal-prep-recovery-v1.md).

## Specific prepared-dish reuse handoff — 2026-10-22

The personal food review can now hand off an exact prepared session/batch with
unplanned portions to its canonical Plan portions sheet through owned draft-aware
navigation. The destination reloads current household-scoped data, including an
older exact session beyond the first page, and refuses missing/unprepared/full/
incomplete targets without opening a different dish. Invalid or conflicting URL
intents have an explicit clear/reload state. Links do not allocate or mark food
eaten, reserve raw stock, or add groceries.

The canonical bulk read now probes51 and projects50 meal/consumption rows with
optional `portions_complete` metadata; older clients retain bounded arrays, while
this new reuse handoff holds older/incomplete projections. A backwards-compatible
optional `require_prepared: true` allocation field is rechecked under the existing
effect transaction before creating meals. Current canonical role/verification,
portion budget, household and receipt rules remain. Source unit/mounted/disposable-
DB cases are authored and unrun. Bulk action draft/unknown recovery is still
memory-held; durable owned bulk editor/action recovery must be implemented before
claiming this entire reuse workflow source-complete or release-ready.

No tests/typecheck/lint/build/browser/API/DB/schema/provider/flag/push/merge/deploy
or issue closure. Wider inbox/weekly/chat, provider/evaluation and broader goal
source remain before consolidated QA and authorized release.

## Food grocery outcomes and canonical Undo — 2026-10-22

The food sheet now has explicit original-grocery-result reads and per-add Undo.
Root receipts remain minimal and unchanged. Separate bounded no-store endpoints
renew current original person/role/generation, verify the signed original command,
require its committed root/hash and follow only exact child pointers. Child action,
owner, family, normalized request hash, selected ingredient counts and original
creation-based Undo deadline must match before projecting details or undoing.
Missing child details never become a failed meal/prep save. Historical added/open
and possible free-text-lookalike counts are distinct from current list contents.

Explicit Undo runs existing canonical provenance/window/checked-row rules inside
an authorized serializable transaction. It does not undo meals/prep, replay adds,
extend deadlines or change root receipts. Unknown replies retain the original
owned food intent and exact child target for explicit safe repeats; no background
Undo. UI actions share sheet operation/storage/owner/navigation guards, paginate
one add at a time and require acknowledgement before forgetting an in-view unknown
Undo. Original intents, not volatile result banners, retain recovery across reload.

Scoped linkage/hash/foreign-root/child-unavailable/strict-DTO/canonical-Undo and
mounted explicit-action/unknown/expiry cases are authored and unrun. No tests,
typecheck, lint, build, browser, API, DB, schema, provider, flag, push, merge or
deploy action. Prepared reuse, inbox/weekly/chat integration, provider/evaluation
and broader goal source remain before consolidated QA and authorized release.

## Food planning selectors and prep allocations — 2026-10-22

The initial owned Meals sheet now has household-scoped searchable recipe pools,
per-choice recipes, account cooks, grocery/shopping destinations and optional
ingredient selection. A read-only owner/query-bound selector API returns eight
rows per page plus exact selected metadata; authorization, household filters,
strict DTOs, bounded response sizes and delayed-owner renewal precede rendering.
Email-free profiles remain separate from account cook identities.

Prep dishes now support paged meal allocations with explicit portions, notes and
inherited versus unassigned cooks. Old draft cook intent is preserved. Optional
calendar departure selection uses an explicit unambiguous search interval and
travel/get-ready buffers. Reviews show exact estimated start/finish/deadline and
selected departure instants. Grocery-only edits retain matching read previews
while invalidating signed confirmation; no automatic grocery or portion writes.
Occupied prep meal slots now check the complete day, including legacy non-midnight
rows. Selector/foreign-selection/DTO/owner/catalog/partial-allocation cases are
authored and unrun. No tests, typecheck, lint, build, browser, API, DB, schema,
provider, flag, push, merge or deploy action. Canonical grocery outcomes/Undo,
prepared-portion reuse, inbox/weekly/chat entry points, provider/evaluation and the
broader goal remain open before consolidated QA and authorized release.

## Initial food planning sheet and editable draft promotion — 2026-10-22

Meals now has a lazy capability/role-gated personal planning sheet with one-choice
editing, suggestions, exact confirmation and durable saved-request recovery.
Layout seeds no owner/household data; shared/fridge/profile-preparation surfaces
are omitted, and a recovery URL can open during a write pause. Raw unfinished
fields remain in a local-only owned draft. Human confirmation promotes the same
key/body atomically before send; uncertain promotion cannot dispatch. Existing
CAS/retirement/history-exit machinery is reused, with owner/lifecycle holds and
known201 outcomes kept separate from subsequent read failures.

Initial controls include multi-meal/prep choice, date/portions/priority, repeat
suggestions, prep storage/label/next day and strict wall-time cooking windows/
budgets. Actual command cooks/notes/allocations/full grocery selections are shown
before confirmation. Full recipe/catalog/cook/grocery/allocation/departure pickers,
prepared-portion reuse, grocery outcome/Undo and inbox/weekly/chat wiring still
remain, alongside provider/evaluation and broader unfinished source. Raw-field/
DST/promotion/race/known-success cases authored and unrun. No QA/rendered/API/DB/
DDL/client/native/provider/flag/push/merge/deploy action or issue closure. Full goal
remains active; see [`grounded-food-planning-v1.md`](./plans/grounded-food-planning-v1.md).

## Food review presentation and browser transport — 2026-10-22

The initial person-only food summary now pages one meal/dish at a time and keeps
large ingredient/commitment/prepared-portion details short. Unknown cooking time,
calendar holds, quantity/matching limits and distinct portion counts remain explicit.
Alternative selection emits a fresh-preview callback without saving. An existing-
foundation design spec documents the complete intended sheet/role/recovery states.

Strict browser preview/review DTOs and read helpers validate current owner,
normalized echoed query (including dates), choices/portions, exact reviewed command
and selected people/list/grocery IDs before rendering. Delayed reads renew current
person scope before returning. Shared pure choice matching keeps server review
and browser validation aligned. Source/mounted cases authored
and unrun. The full sheet/entry points, editable/timing/portion/draft/exit/pending/
inbox controls and canonical grocery outcome/Undo wiring, provider/evaluation and
broader remaining source still precede consolidated QA. No rendering/API/DB/check/
provider/flag/push/merge/deploy action or issue closure. See
[`grounded-food-planning-v1.md`](./plans/grounded-food-planning-v1.md) and
[`FOOD_PLAN_REVIEW.md`](../design/FOOD_PLAN_REVIEW.md). Full goal remains active.

## Food save/recovery APIs and exact browser journal — 2026-10-22

Source now includes person/owner-bound context, atomic apply and read-only receipt
inspection endpoints. Completed replay renews original signed role/generation and
current canonical bulk verification without depending on expired sources or deleted
targets. Pending/missing/expired/conflict states never establish a failed save.
Only an exact renewed original key/body can be retried; browser inspection checks
echoed body/key/owner and independently computed canonical request hash.

The food browser adapter uses existing owned storage/retirement leases. An opt-in
requires receipt/source inspection before every food send, including same-screen
unknown retries; existing domains retain recovered-only behavior. Entries remain
durable on unknown and successful replies until explicit dismissal. All rollout
and readiness gates stay unchanged/off; no provider/background writes are added.

HTTP/recovery/client/journal and disposable-DB generation/prep-verification cases
are authored and unrun. Compact owned UI/read DTO validation, timing/portion/draft/
exit/pending/inbox integration and canonical grocery outcome/Undo presentation,
provider/evaluation and broader remaining source still precede consolidated QA.
No API/DB/migration/client/check/browser/native/CI/provider/flag action, push/merge/
deploy or issue closure. Full goal stays active; see
[`grounded-food-planning-v1.md`](./plans/grounded-food-planning-v1.md).

## Food source row versions — 2026-10-22

Additive schema/migration source now defines insertion UUIDs and nonresettable
per-update epochs across the eleven canonical food/identity/list source tables.
Enabled-ALWAYS insert/update triggers cover ordinary legacy SQL writers, reject
forged version resets and refuse exhaustion. No shared household counter/lock or
new domain store is added. The food broker and signed review bind bounded,
strictly household-scoped positive dependency versions; missing storage/trigger/
row metadata refuses. Version arrays remain server-side.

Metadata/source and disposable-DB raw-writer/recreation/away-back/foreign/overflow
cases are authored and unrun. No migration, client generation, QA, flag/provider
activation, push/merge/deploy or issue closure occurred. Trigger/default/constraint,
repeat migration, concurrency/compatibility and rollback acceptance must pass in
the consolidated QA phase. Owned compact review/timing/portion controls, strict
apply/receipt inspection/exact journal recovery, provider/evaluation and broader
inbox integration remain source work. Full goal remains active; see
[`grounded-food-planning-v1.md`](./plans/grounded-food-planning-v1.md).

## Food plan signed review/source renewal — 2026-10-22

A bounded person-only read-review endpoint now issues an exact command/source/
owner-bound seal with the original sixty-second lease. The internal food write
guard renews canonical food/calendar/commitment and selected cook/list/grocery
sources inside the actual effect transaction. It rejects changed or held choices,
portion mismatches, foreign/missing selections and occupied prep allocation slots.
Reviewed groceries use the exact canonical full-quantity arithmetic. Browser-safe
command/query contracts are separate from server code; other people's session
metadata is not projected to the browser.

Cryptographic/semantic/mocked-renewal cases are authored and unrun. This does not
expose an HTTP write endpoint or establish universal legacy-writer food version/
ABA coverage. That coverage, compact owned review/timing/portion controls, write/
receipt-inspection/exact journal recovery, provider projection/evaluation and
broader inbox integration remain source work, then consolidated QA and release.
No QA, DB/schema/provider/flag activation, push/merge/deploy or issue closure.
See [`grounded-food-planning-v1.md`](./plans/grounded-food-planning-v1.md).
The full goal remains active; older checkpoints below retain their history.

## Food plan canonical write composition — 2026-10-22

An internal transaction adapter now composes canonical ordinary meals or one
multi-dish prep session plus explicit recipe grocery selections with atomic
root/child receipts. It reuses existing meal/prep/grocery effects and preserves
full scaled quantities, duplicate handling and Undo. Late refusals throw and roll
back all earlier effects. Original actor/role/generation authority precedes replay;
paused rollout and deleted targets cannot cause replay to recreate records.

This is source only, with no route or concrete signed food-source guard yet.
Owned review/API/recovery, complete apply-time source/version renewal, provider
projection/evaluation and broader inbox follow-through remain. Contract and
opt-in disposable-DB cases are authored and unrun; all QA remains deferred.
No DB/schema/provider/flag change, push/merge/deploy or issue closure occurred.
See [`grounded-food-planning-v1.md`](./plans/grounded-food-planning-v1.md).
The full goal remains active; historical checkpoints below remain intact.

## Food planning calendar/departure source — 2026-10-22

Explicit offset-aware meal windows and one shared multi-dish prep window now
have a canonical calendar read and pure continuous-gap check. Selected owned
departures supply ready-by constraints with explicit setup/eating/cleanup/travel/
preparation buffers; unrelated event titles and private event/provider fields are
not selected. The existing schedule source predicates, generation/epoch storage
readiness and shared source freshness/ownership/cap policy are reused. Stale,
partial, recurring, invalid or unavailable evidence stays unknown/held. Ignored
owned events do not erase a selected departure deadline. No calendar is changed.

Pure/source/shared-policy/disposable-DB timing, DST, foreign-reference and material
version cases are authored and unrun. This remains read-only, default-off source;
provider projection/renewal, compact owned review/timing/portion controls, canonical
apply/recovery, semantic evaluation and inbox follow-through remain before QA.
No tests/types/lint/build/browser/application API/DB/schema/client/native/CI,
provider/flag activation, push/merge/deploy or issue closure occurred. See
[`grounded-food-planning-v1.md`](./plans/grounded-food-planning-v1.md). Full goal stays
active; earlier checkpoints below retain their history.

## Food planning commitments and prepared portions source — 2026-10-22

The read-only food broker now includes current-day-through-horizon ordinary
meals, whole pending prep dishes and recorded prepared portions. Existing known
commitments reserve comparable stock before new proposals; each pending dish is
counted once across its meal allocations. Prepared portions reuse canonical
eaten/planned/remaining/unplanned arithmetic with cancelled consumption excluded;
passed dates never imply eaten food. Source dates/next prep/storage and snapshot
markers remain explicit. Unknown existing recipes/quantities/prep state hold new
coverage claims. Additional source/dependency/graph bounds and family-link
refusals are authored, and all selected records enter the read revision.

Pure/source/disposable-DB cases are authored and unrun. No actual flags, provider,
meal/stock/portion records or live services were changed. Calendar/departure
constraints, provider references/renewal, compact owned commitment/portion review,
canonical apply/recovery and evaluations/inbox integration remain source work.
Readiness stays off and all consolidated QA remains deferred. No tests/types/lint/
build/browser/application API/DB/schema/client/native/CI, push/merge/deploy or issue
closure occurred. See [`grounded-food-planning-v1.md`](./plans/grounded-food-planning-v1.md).
Full goal remains active; earlier entries below retain their history.

## Canonical food planning read foundation — 2026-10-22

A default-off read-only food preview now has source contracts for several meal
slots or several dishes in one prep session, serving-scaled ingredient estimates,
canonical inventory matching/expiry semantics, isolated candidate ledgers and
cross-slot virtual quantity allocation. Unknown amounts/units/scaled cooking time
remain explicit. Existing meal slots are held, not overwritten. A scoped parent/
teen repeatable-read broker checks current owner/generation/features and bounded
canonical recipe/ingredient/inventory/meal sources; its API calls no provider and
performs no meal/grocery/inventory writes. Unit/source/disposable-DB cases are
written and unrun. Example env flag is0; no real flag was changed.

This is a foundation, not end-to-end AI planning. Existing-meal/bulk commitments,
calendar constraints, provider projection/ref renewal, compact owned review/apply
UI and canonical atomic write/recovery adapters plus semantic evaluations remain
source work. See [`grounded-food-planning-v1.md`](./plans/grounded-food-planning-v1.md).
All consolidated QA remains deferred. No tests/types/lint/build/browser/application
API/DB/schema/client/native/CI, provider/flag activation, push/merge/deploy or issue
closure occurred. Full goal stays active.

## AI email-free profile assignment source — 2026-10-22

Parent chat now has a gated canonical account/profile picker with distinct
namespaces, explicit profile labels and separate recurrence capability handling.
Profile choices carry the reviewed canonical revision. The fixed versioned
confirmation path delegates strict protocol-2 profile creation, binds revision
into the keyed request hash and checks that profile plus any supplied Today proof
inside the existing chore/receipt transaction. Manual profile confirmation can
omit Today; other action types cannot use that proof exception. Profiles never
become actors or inferred accounts. Compact receipt recovery preserves original
current parent authority after profile/source changes; known profile refusals
keep edits and offer read-only choice reload. Existing rollout gates stay off.

Client/mounted/router/profile-source/disposable-DB cases are authored and unrun.
Broader canonical food/recipe/schedule planning, version/semantic-evaluation/inbox
source and all consolidated QA remain. Only source reads/edits and selected-file
formatting occurred: no tests/types/lint/build/browser/application API/DB/schema/
client/native/CI, provider/flag activation, push/merge/deploy or issue closure.
See [`AI_CONFIRMATION_SOURCES.md`](./architecture/AI_CONFIRMATION_SOURCES.md).
Full goal remains active; earlier checkpoints below retain their history.

## AI exact-target deletion source — 2026-10-22

The negotiated confirmation flow now includes event/chore/list delete adapters.
A read-only selected-target preview renews the original Today proof and current
actor, locks/fingerprints the target plus bounded affected child records, and
returns current canonical details with an opaque signed target token. Chat
requires a new removal checkbox after that preview and sends both proofs to the
fixed confirmation route. Missing, changed, expired, foreign or uninspectable
evidence holds the deletion. Canonical deletion services preserve imported-event,
profile-protocol, routine/series/history and assignee restrictions and commit a
minimal keyed receipt with the effect; recovery does not require a deleted target.

Source/token/client/mounted/disposable-DB cases are authored and unrun. Profile
assignees, broader canonical planning/version/evaluation/inbox follow-through and
all consolidated QA remain. Gate stays off. No tests/types/lint/build/browser/
application API/DB/schema/client/native/CI, provider/flag activation, push/merge/
deploy or issue closure occurred. See
[`AI_CONFIRMATION_SOURCES.md`](./architecture/AI_CONFIRMATION_SOURCES.md). The
full goal stays active; earlier source checkpoints below retain their history.

## AI confirmation source renewal — 2026-10-22

Source proof negotiation and a fixed versioned confirmation endpoint are authored.
Event/account-chore/grocery/list/note creates renew the signed Today/catalog/feature
basis inside canonical effect transactions. List/note now have optional atomic
receipts; the outer idempotency helper preserves a canonical completed receipt,
including long note responses. Current actor authority precedes replay; expired
sources never authorize a new effect. Explicit refresh retains edited proposal
fields for a matching fresh kind and holds them on failed/mismatched refresh.

See [`AI_CONFIRMATION_SOURCES.md`](./architecture/AI_CONFIRMATION_SOURCES.md).
Deletion target revisions/receipts and profile-assignee adapters remain source
work; the new gate stays off. Broader planning/version/eval/inbox follow-through
and all consolidated QA remain. Unit/client/disposable-DB cases are authored and
unrun. Only source reads/edits and selected formatting occurred: no tests/types/
lint/build/browser/application API/DB/schema/client/native/CI, provider/flag
activation, push/merge/deploy or issue closure. The full goal remains active.

## AI usage and estimated-cost controls source — 2026-10-22

The shared provider transport now has an optional mandatory-observer quota path,
parent limits/reporting API and compact EN/ES Settings panel. Additive policy and
content-free reservation schema/SQL, current user/family/provider/price binding,
atomic request limits, conservative unknown-cost handling, pause-time reply holds,
export and erasure semantics are authored. Both usage/rollback gates are required
for dispatch; default-off examples and a separate provider kill switch are added.
No provider, paid service, secret or flag was activated.

See [`AI_USAGE_CONTROLS.md`](./architecture/AI_USAGE_CONTROLS.md) for exact quota,
integer USD estimates, storage/retention/privacy, compatibility and rollback rules.
Source/unit/API/UI/disposable-DB cases are authored and **unrun**. No migration,
tests/types/lint/build/browser/application API/SQL/DB/client/native/CI, push/merge/
deploy or issue closure occurred. Remaining source includes confirmed planning
checks, broader version coverage, food/recipe/schedule planning, semantic evals and
inbox/history/refusal follow-through, then consolidated QA. Full goal stays active.

## Exact AI source-reference catalog source — 2026-10-22

Explicit Include Today requests may now negotiate
`X-Assistant-References: herewoven.assistant-references.v1` when the new private
`FAMILY_ASSISTANT_REFERENCES_READY=1` gate is on. Existing Today readiness, person
parent/teen auth, paired-device refusal, configured provider and rate gates remain.
Older clients keep the exact v1 reply; new clients accept v1 on rollback. The gate
is off by default and no provider, secret, permission or rollout was activated.

The same allowlisted loader can collect a separate ephemeral server sidecar for
its exact projected Event, Chore, dinner, grocery and use-soon rows. Canonical
IDs, creation/update timestamps, selected Event/Chore generations/epochs and
selected dependencies stay server-side. The v1 provider projection remains free
of canonical IDs/URLs. A distinct untrusted reference block supplies opaque stable
HMAC IDs, kind/row index, observation time and keyed revision. Identity binds the
current person, household, role, token generation, domain and canonical ID, using
a domain-separated application key; these IDs are not credentials or signed write
authority. Rotation/session replacement invalidates their relationship. A complete
bounded slot/catalog match is required; no partial/missing-identity catalog is used.

The reference-aware provider reply must declare context/clarification/general
basis and supply at most8 distinct exact issued refs for context claims, no refs
for the other bases. Typed parsing refuses supplied labels/URLs/arbitrary fields.
After provider latency, actor/config/features/Today lease and both current typed
projection and catalog are renewed. Changed/deleted/recreated identities, selected
revision changes and expired sources withhold the old reply. Unknown/foreign refs
are rejected. Labels and fixed canonical app destinations are built only by the
server after renewal; none come from the model. Meal/inventory links open their
canonical section; event/chore/grocery links open the canonical editor/list.

The chat renders optional EN/ES source links for the latest answer's active
monotonic Today lease. Background/expiry hides the links and asks for refresh.
Navigation uses the owned-draft exit barrier. Citations never get replayed in
chat request messages or become action authority. Normal deterministic controls
and canonical confirmations remain unchanged. Today SQL also excludes erased/
template chores, requires own account namespace for teen work and excludes known
zero-stock use-soon items; unknown quantity is kept explicit by the existing DTO.

Catalog ownership/version/forgery/schema, exact loader sidecar, API source renewal/
unknown refs/legacy compatibility, untrusted provider-block and chat lease cases
are authored and unrun. This is structural reference validation, not proof that
free-form prose correctly reasons from a cited fact. Timestamp/selected-epoch
renewal is not snapshot-wide isolation or a universal legacy-writer ABA guarantee.
Source-generation coverage across remaining domains, source checks at confirmed
planning writes, canonical meal/inventory/recipe planning, versioned semantic eval
scores, household quotas and content-free usage/cost dashboard remain required
#123/#144 code, followed by consolidated QA. No issue is closed.

Only source inspection/edits and selected-file formatting occurred. No tests,
types/lint/build/browser/application API/SQL/DB/schema/client/native/CI, provider/
flag activation, push/merge/deploy or release claim. Full goal stays active.

## Own-account chore/history preparation context source — 2026-10-22

The personal chore-context endpoint now admits current parent, child and teen
accounts through the same authenticated person/family/session lock renewal.
Projection branches remain explicit: parents may receive event backlinks and
routine origins; child/teen requests never invoke those readers and return only
`ownContext: { [taskId]: { eventTitle } }` for the account's current own canonical
unerased, non-template task. The existing own-task query renews role/household,
requires assigned_to exactly that account and assigned_member_id null, and checks
both domain features. Client-supplied profile/family/owner authority is rejected.
A selected email-free subject never becomes an authenticated account.

Requests now accept at most150 unique explicit task IDs (superseding the initial
unreleased parent endpoint cap300). The personal memory-only reader uses150-ID
batches so the own-task reader's bound cannot silently omit later requested rows.
It verifies owner and generation throughout; no partial multi-batch projection is
installed. Existing blur/background/storage/identity cancellation and replacement
retirement apply. No new cache/local store, provider, schema or mutation is added.

Child/teen open chores, routine rows and loaded completed-history windows now
show the existing EN/ES read-only getting-ready note. Paging triggers fresh context
for the loaded exact IDs. Parent references stay under parent render guards;
canonical completion/check/Undo/edit permissions remain unchanged. API branch,
current membership/generation, window and own-context filter cases are authored
and unrun. Earlier child-home and shared/profile fridge readers remain distinct.

This checkpoint used source inspection/edits and selected formatting only. No
checks, browser/application API/SQL/DB/client/native/CI, activation, push/merge/
deploy or issue closure. Rendered role/history acceptance remains for consolidated
QA. Remaining implementation includes other domain history/refusal interactions,
review inbox draft follow-through and grounded AI references/planning/evaluation/
privacy-safe usage/cost controls. Full goal and #123/#128 stay in progress.

## Shared/profile preparation labels source — 2026-10-22

The existing Today board builder now optionally projects
`sharedPreparationContext: { [visibleChoreId]: { eventTitle } }` after its canonical
account/profile task resolution. This is a new shared-safe title projection,
separate from parent backlinks/origin maps. It uses only the already-shared
schedule title (bounded to512 characters), and includes no event/routine/plan IDs,
source tokens, cue times, completion/proof/parent-check state, descriptions,
addresses, names of other assignees or parent edit capability. A profile remains
a task subject, never an authenticated actor.

The reader is bounded to80 deduplicated validated current board task IDs. Every
relationship joins Event, Chore, preparation and Family ownership keys, rejects
erased/templates, renews current account membership or active valid unlinked
profile subject, and requires calendar/chores enabled. Profiles additionally need
explicit protocol2 and the existing profile gate. Paused preparation, missing
storage and protocol incompatibility omit context. Caller authentication and
family authority remain the canonical person/device board route responsibilities;
this is not a standalone endpoint or authorization grant.

Live fridge task rows show the existing EN/ES read-only getting-ready label for
both account and eligible email-free subjects, without another button/input.
Canonical completion, subject selection, parent checks and Undo remain unchanged.
The optional field participates in the existing whole-board version hash, so
source title/link changes use ordinary board refresh. The cache allowlist
intentionally excludes this field, and cachedSnapshot rendering omits labels even
if a retained in-memory live response has them. Protocol2 stays online-only.
Older clients ignore the additive field; no schema/migration/provider/scheduler,
new persistence or polling is added.

Reader/window/privacy/gate, disposable-DB household/profile/archive, cache omission
and EN/ES presentation cases are authored and unrun. Source edits/inspection and
selected formatting only; no tests/types/lint/build/browser/application-API/SQL/DB/
client/native/CI, activation, push/merge/deploy or issue closure. Shared/profile
preparation labels are source-authored, not accepted on rendered/physical devices.
Own-account chore/history context beyond the existing child home/routine surfaces,
other domain history/refusal UX and grounded AI/planning/evaluation/usage remain
implementation work before consolidated QA. Full goal remains active.

## Routine copy provenance and personal chore context source — 2026-10-22

Routine reuse now appends a minimal `preparation_routine_copied` Activity fact
inside the canonical new-Chore/effect/receipt transaction. A deterministic fact
primary key binds the exact household and new task. Only exact source stack,
source step and original occurrence day are retained; no source content,
completion credit, proof, recurrence, future definition or private token is copied.
Manual creates cannot supply provenance through the strict public command.
Receipt replay returns before another copy/fact. Detaching preparation keeps the
independent task and its fact. Existing Activity account/household export and
erasure apply; absent provenance never claims that a task was manually created.

A bounded parent-only read endpoint renews current actor/family/session generation
under membership locks, accepts at most300 explicit current task IDs, and returns
separate event backlinks and routine origins. Both copied and source task,
routine, original due day, profile availability, erased-subject state and enabled
domains are checked. Current source labels are read fresh; unavailable source
returns only a generic state and copy time, with no old source IDs/name/link.
Source links use exact identity and original occurrence, never label matching.
No schema/migration or alternate task store is introduced. Private copy actions
are excluded from the legacy member Activity/Analytics feeds.

Personal parent chore rows, parent-check rows, done/history pages, routine rows
and canonical page/sheet editor now read this separate memory-only projection.
Later history windows trigger bounded reads; the context stays out of canonical
Chore, shared-device and offline/cache DTOs. Blur/background/storage/identity
changes abort and clear it; late replies cannot install data. Owner or session
generation replacement retires the reader instead of adopting the new identity.
Optional context failure never blocks normal chore edits/completion. EN/ES source
and independent-task wording is authored; source actions stay outside completion.

Planner, fact/projection, API admission, lifecycle and personal-hook cases are
authored and unrun, including exact replay, real-DB rollback/detach/foreign-family/
erasure cases prepared for the disposable database pass. This checkpoint used
source inspection/edits and selected-file formatting only. No tests/typecheck/
lint/build/browser/application API/SQL/DB/schema/client/native/CI, activation,
push/merge/deploy or issue closure. Broader role/profile/shared-device readers,
other domain history, batch-refusal UX and grounded AI/planning/evaluation/usage
remain implementation work before consolidated QA. Full goal stays active.

## Authorized change timeline source — 2026-10-22

The parent Review inbox now includes What changed, a read-only view over the
existing Activity and AuditLog records. An explicit refresh uses a private,
no-store endpoint that renews current parent/session/family under canonical
membership locks. Stable two-stream cursors retain continuation through filtered
windows; each source reads at most21 candidates, projects at most20, and the UI
shows five at a time. Coordination/settings filters, timestamps, canonical source
labels and EN/ES actions are authored. Blur, storage, identity and competing
review changes clear the memory-only projection; late replies cannot install it.
A generation replacement latches a reload requirement rather than adopting it.

The projection never uses historical Activity titles/descriptions, audit summaries,
provider output or saved URLs for visibility. Record names/links come only from
current same-household Event/Chore/Recipe/Pickup/Handoff reads and enabled domains;
erased/missing/foreign targets share a non-disclosing unavailable state. Only
current household actors are named. Tablet completions use explicit server source
markers; older ambiguous completion rows do not claim that a selected subject was
an actor. Settings feature labels use the canonical translated feature registry.
Links open canonical screens that renew permissions and own any supported reversal;
no generic timeline Undo or new mutation authority was added.

Canonical account/profile chore creation, recipe creation, preparation review,
schedule moves and changed responsibility now append minimal facts inside the
existing effect/receipt transaction. Completed receipt replay adds no new fact;
no-op responsibility adds none. Completion metadata distinguishes actual person
and tablet context without inferring an actor from an email-free profile. These
facts stay out of the old member activity/analytics feeds, and new completion
proof/actor metadata is masked from the old activity DTO. Existing own-activity
export and erasure rules continue; no prompts, notes or content snapshots are
copied into the new facts. No schema/migration, scheduler or provider is added.

Source/helper/API/privacy/pagination/component cases are authored and unrun;
existing effect fixtures and replay assertions are updated. Source inspection,
edits and selected-file formatting only. No tests/typecheck/lint/build/browser/
application-API/SQL/DB/native/CI, activation, push/merge/deploy or issue closure.
Actual isolation, transactions, pagination, role/device, EN/ES and responsive
acceptance remains for consolidated QA. Routine provenance/editor/history,
remaining role/profile/shared-device readers, other domain history coverage,
batch-refusal interactions and grounded AI/planning/evaluation/usage remain open.
The full goal stays active; source completion still precedes integrated QA.

## Owned draft exits and foreground read cancellation — 2026-10-22

Owned capture/recipe exits now share a content-free in-memory navigation barrier.
Every active editor prepares and proves its original draft before any same-URL
history sentinel is released. Failed saves, ownership/epoch changes, replacement
editors and repeated navigation attempts stop the route transition. Approved local
close callbacks can synchronously call their host router without another save.
Hidden capture hosts do not claim navigation. Owner-retired editors clear private
fields, retain original storage and can leave without touching a new account's
store. Explicit sign-out retains its established privacy cleanup/raw-router path.

All 27 current non-session application callers of push/replace/back found in the
source use the shared draft-aware router; refresh-only callers remain unchanged.
Command palette/assistant navigation wait for approval, and preparation/schedule/
responsibility/weekly-reset controls restore their navigation refs on refusal.
Calendar date/view changes wait for an accepted route update. Ordinary navigation
without an active owned editor keeps its synchronous route call. Existing pending
form Back/unload/history machinery is reused rather than patched or replaced.

Capture source reads now have a 45-second whole-job client deadline, including
photo decoding, plus streamed response bounds. Stop reading, blur/background,
host dismissal and unmount cancel only source reads. A late decode cannot start a
provider fetch after cancellation, and ignored aborts settle the client without
replacing the original review. Typed phrases remain in memory; raw photos/prompts
are never put in the owned document. Availability reads use the existing bounded
15-second transport and suppress stale/unmounted responses. Focus/storage renewal
advances epochs in both owned hosts. Abort is not a noncommit proof for canonical
writes, and no claim is made that a client abort stops provider execution/billing;
server deadlines remain separate.

New pure transport/barrier and mounted capture cases are authored and unrun.
Only source inspection, edits and selected-file formatting occurred: no tests,
typecheck/lint/build/browser/API/SQL/DB/native/CI, activation, push/merge/deploy or
issue closure. Back/native bridge/process-loss/privacy/visual acceptance remains
for consolidated QA. Role/profile/shared-device views, routine provenance/history,
authorized timeline, domain-refusal batch recovery interactions and grounded AI
references/planning/evaluation/usage still need follow-through. Full goal is active.

## Captured chore review and atomic create receipts — 2026-10-22

Owned capture now opens the existing canonical chore form in a nested review
sheet, rather than handing a task to a blank page in another tab. Parent review
starts without an inferred assignee; editable assignment kind/ID, schedule,
weekdays, rotation, instructions, points, routine fields and uploaded-photo path
stay with the original capture document. Partial date/number strings survive.
Review-only form submission creates no chore or request key; it returns the
reviewed canonical body to the batch. Any later task edit clears that approval.
Parent-only manual chores are also available without a provider. Confirmation
freezes all event/chore/grocery rows together; task bodies cannot become events.

The existing account chore create now supports optional idempotency keys, with
chore/series and compact pointer receipt committed in the same transaction.
Overlapping takeovers re-read completion under the receipt lock; post-create
metrics/notifications run only for the effect that actually created the chore.
Unkeyed legacy callers retain deliberate distinct creates and fresh chore DTOs.
Bound review requests use the canonical route, original body/key and parent/
household/session checks; profile assignment retains protocol-2 and rollout gates.
A new read-only chore receipt endpoint returns fixed state/current-presence only,
never a cached title, assignee, points or routine. It renews current parent/session
and household under membership locks and treats erased/removed chores as removed.

All of this is authored source, not verified runtime behavior. Added cases cover
review-only UI, partial fields, task domain binding, receipt privacy/conflicts,
lost replies, overlapping effects, rollback and authority renewal; none were run.
Only source inspection, edits and selected-file formatting occurred. No QA,
typecheck/lint/build/browser/API/SQL/DB/native/CI, activation, push/merge/deploy or
issue closure. Remaining navigation/read cancellation, role/routine/timeline and
AI grounding/evaluation/usage work stays open. Full goal remains active; integrated
QA follows all remaining source completion.

## Owned capture review/batch recovery source — 2026-10-22

CaptureBox now selects the existing legacy flow before adoption and the owned
review host after adoption. The host restores full editable text/photo proposals,
notes, partial quantities and original time strings without persisting prompts,
photos or raw provider output. AI extraction reuses the original capture reader;
normalized replacements reach the existing owner journal, and failed/empty/late
reads preserve the prior review. Manual event/grocery rows work without a provider.
Five-row editors and submitted-result windows keep the whole batch intact.

Confirmation validates real ISO/local instants and decimal quantities, refuses task
conversion, then durably freezes every canonical request/key before dispatching
through the existing bound submit route. Partial/unknown batches keep all original
requests; receipt checks renew authority and storage before retry. Present, removed,
opaque, pending, absent, expired and refused states remain distinct. Explicit finish
requires committed/current proof; removed results require a separate acknowledged
finish and are never recreated. The original legacy envelopes remain in their own
explicit recovery-only pane, including when extraction is unconfigured.

Hidden/closed capture hosts release global link/Back ownership; pending reviewed
fields may finish their local save. Original context/generation/role is renewed on
return, private content is masked during checks, and native file-picker return can
renew before accepting a file. These are authored source paths, not device/browser
acceptance. Existing legacy cases explicitly target the preserved legacy flow;
new helper/store/owned UI cases are authored, all unrun. Only source inspection,
edits and selected-file formatting. No tests/typecheck/lint/build/browser/API/SQL/DB/
native/CI, flag activation, push/merge/deploy or issue closure occurred.

Still open: integrated parent-only chore handoff (the current link remains manual),
full programmatic/host navigation and foreground-read cancellation, remaining
role/routine provenance/history, inbox timeline and grounded AI/evaluation/usage
scope. Consolidated QA follows remaining source completion. Full goal stays active.

## Saved-draft inbox discovery and direct recipe recovery source — 2026-10-21

The parent inbox has read-only capture/recipe document adapters using the existing
owned snapshot lease and strict domain journal. Only fixed type/phase/time/recovery
links leave the store; no draft content, keys or receipts are read for display or
mutated. The context now reports current person role; downgraded/foreign/unadopted
contexts hold discovery. Expired and submitted work is retained without calling it
failed or retryable. A direct parent/teen `/dashboard/meals/review` host opens the
existing recipe boundary without importing again or creating a blank draft when
no saved work exists. It stays available during write pauses, refuses signed-in
fridge/shared-device use, and binds initial server identity to client renewal.

Capture task proposals previously reached `/api/events`. That silent domain error
is now blocked. The preview stays available and a current parent may open the
canonical chore form in a new tab; no assignee/points/permission is inferred. This
is a manual handoff, not the pending durable capture/chore integration. Capture's
owned draft host is still incomplete even though its read-only inbox adapter is
authored. Recipe recovery/adapter and task-domain cases are authored, all unrun.
Only source edits/inspection and selected-file formatting; no QA/checks/build/
browser/API/SQL/DB/native/CI, activation, push/merge/deploy or issue closure.
Full goal remains open. Next: owned CaptureBox lifecycle and canonical chore
handoff, then remaining navigation, role/routine/inbox timeline and grounded AI.
See the dated inbox plan checkpoint for remaining acceptance details.

## Recipe draft host and bound canonical submission source — 2026-10-21

New-recipe editors (including Meals quick-add and imported recipes) now share an
owned document boundary around the existing labelled form. Adoption is explicit:
`FAMILY_REVIEW_DOCUMENTS_ROLLBACK_READY=1` opts into historical document recovery;
keep that on through write pauses until data is retired. New writes additionally
require `FAMILY_REVIEW_DOCUMENTS_READY=1` and existing queue/rollback readiness.
Before adoption the legacy editor does not depend on Web Locks/IndexedDB. No flags
were changed. Once adopted, inaccessible storage or ownership uncertainty holds
new work rather than falling back to a new unowned create.

A saved unsubmitted recipe offers explicit restore/discard instead of merging into
an incoming import. Full ingredient lines, notes, source-copy choice, unknown
servings and partial numeric strings survive in the form contract; numeric text
inputs avoid the browser silently sanitizing those partial strings. Restored source
links are validated before becoming clickable. Autosave retains the full document;
Cancel and dashboard-link exits flush it before leaving, existing Back/unload
protection is reused, and parent close controls are notified while draft writes
are pending. Focus/visibility/storage renewal retains the original person owner,
masks private form content and suppresses late replies. Ordinary refresh checks
the exact known journal baseline instead of adopting another writer's version.
Explicit recovery preserves conflicts for restore review; uncertain storage writes
require exact transition recovery. These are source paths, not observed UX evidence.

Submission freezes the original canonical body/key before the new foreground
`/api/review-documents/submit` compatibility boundary dispatches to the existing
recipe/event/grocery handler. The dispatch and canonical handler both check current
person/domain owner metadata, readiness and the frozen retry deadline. Older servers
have no dispatch endpoint; the client never downgrades to an ordinary create. No
second recipe/event/grocery effect implementation or background replay was added.
The recipe host uses canonical receipt inspection before an exact retry and before
completion cleanup; committed/removed/opaque/expired/pending outcomes remain
separate. An interrupted success cannot be turned into a fresh create by editing.

Source duplicate/check-unavailable refusals for durable recipe requests now commit
a compact terminal 409 receipt under the existing recipe actor/household/receipt
locks. The shared helper's non-success cleanup only removes pending receipts, so
these completed refusals survive and replay. No recipe title/source/id is cached
in that refusal. State-only inspection exposes a fixed refusal reason. Returning
to editing requires that exact terminal receipt, not a transient response plus an
absent key. The rejected request is retired into a fresh editable document in one
CAS persistence transition; all fields remain durable. A delayed old request stays
terminal even if the previously duplicate recipe was removed in the meantime.

The import explorer refreshes canonical summaries and checks the created recipe's
source before marking its incoming preview saved; a restored draft may represent a
different source. Existing saved-recipe PATCH edits remain on their existing path.
EN/ES recovery, paused, conflict, expiry and saved-work controls are authored.

Added source cases for explicit full restore, unknown-result exact retries, current
household changes, pre-adoption compatibility, dispatch owner/deadline/write gates,
foreign-writer refresh refusal, atomic refused-intent succession and a disposable-
Postgres delayed-request/terminal-refusal scenario. All are unrun. Source inspection,
edits and selected-file formatting only: no tests/typecheck/lint/build/browser/API/
SQL/DB/native/CI, activation, push/merge or deployment. CaptureBox unsent drafts still
need this lifecycle, inbox draft discovery and wider routine/role/AI code remains.
Full programmatic/host exit handling and acceptance of rendered Back/failed-flush/
background/process-loss behavior remain open; do not treat authored paths as proof.
The full goal and #123/#144/#499 stay open; consolidated QA remains after the code.

## Owned review-document lifecycle foundation — 2026-10-21

Source now defines separate bounded editable and frozen capture/recipe documents.
Editable forms preserve all ingredient lines, partial numeric strings, empty fields,
source/confidence/unknowns and evaluation time without saving prompts, photo bytes
or raw provider responses. Strict bounds refuse a document rather than shortening
it. A seven-day editable lease is fixed at creation; freezing creates a separate
24-hour retry lease. Expiration holds the document for review, never automatically
prunes it or permits a fresh key.

The existing owned journal gains an atomic exact-predecessor promotion from local
editable document to immutable submitted intent. Persistence/replica verification
finishes before transport can run. Review-document adapters reuse its owner lease,
CAS, uncertain-write recovery and erasure inventory. One document per domain is
held; a new begin cannot overwrite existing submitted work. Exact keys and encoded
canonical request bodies survive interrupted sends. Recovered retries first inspect
receipts and then renew ownership/storage/gates before transport; committed deleted
or opaque results cannot become creates or be automatically retired. Current record
presence is required for the explicit completion cleanup. This is infrastructure
source; domain hosts still must supply the actual canonical transport.

A new authenticated context endpoint returns a person-only domain namespace and
current write readiness. Parent/teen only; paired sessions use existing refusal.
Historical ownership remains stable through a write pause. New edits/freezes/sends
require existing queue recovery/rollback readiness plus the new default-off
`FAMILY_REVIEW_DOCUMENTS_READY=1`; no flags were changed. Missing/inaccessible
browser storage is a hold, with no unowned fallback.

Recipe create receipts now have a state-only inspection endpoint that reuses the
canonical recipe actor/household locks, role, generation and feature authority.
It distinguishes absent, pending, expired, conflicting, present, removed and opaque
results without returning cached recipe content or changing receipts. Capture and
recipe receipt clients hash parsed canonical inputs using a shared serializer;
existing capture/server fingerprint serialization is preserved. Recipe and grocery
write schemas move into browser-safe modules and remain reexported/used by their
existing canonical routes, without introducing another domain write model.

Storage/lifecycle and recipe receipt case code is authored, unrun. Only source
inspection/edits and selected-file formatting occurred. No tests/typecheck/lint/
build/browser/API/SQL/DB/native/CI, flag activation, push/merge or deployment.
CaptureBox and RecipeEditor are not yet connected to this document lifecycle;
their unsent forms remain in memory. Next: canonical transport owner binding,
recipe/capture host restore/freeze/retry controls, explicit refusal/duplicate-source
resolution, read-only inbox discovery and full navigation/failed-flush protection.
Wider role/routine/AI and ledger scope remains open; QA stays deferred.

## Canonical capture review inbox host and normalized drafts — 2026-10-21

The parent inbox has a Quick add reviews pane that lazily mounts the existing
CaptureBox only after that category is opened. This is the actual domain editor
and receipt recovery, not a second read-only adapter that prunes legacy data just
to count it. Existing setup/role/private-session checks and exact canonical sends
remain authoritative. No provider call occurs merely to open the pane. Normal
legacy capture initialization still runs its existing local recovery housekeeping.

Once opened, its in-memory draft stays mounted while switching inbox categories
or beneath preparation/schedule/responsibility overlays. A user/household identity
key resets the host before another identity can inherit the old form. The recipe
handoff opens the existing Meals explorer/import editor with its current unknown-
servings/source/duplicate review. The handoff warns before leaving an unfinished
capture preview; it does not copy form content or pretend it is durable. Other
route exits/reloads and full owned draft navigation protection still need work.

One browser-safe strict capture review schema now owns normalized text/photo
proposal types for server and client. Null provider optional fields remain unknown;
missing confidence is conservatively low. Unsupported kinds/types/timestamps,
private extra fields, overlong text and >20-event batches are refused rather than
silently guessed, truncated, filtered or rendered as an empty batch. Syntax/Date
parse checks do not prove named-zone DST validity or semantic source accuracy;
existing canonical confirmation remains required. Recipe's existing typed preview
contract/editor stays canonical; no duplicate parser is introduced.

Failed replacement extraction keeps the previous typed/photo draft and note.
Only valid success replaces it. Generation guards suppress late extraction
responses after revocation/unmount; post-provider server renewal rechecks original
actor/token/role/household and provider configuration before returning proposals.
Changed access/configuration withholds the result. Credentials compare in memory
only. No canonical record or receipt is created by extraction. Source/photo result
accuracy and injection resistance still require the deferred evaluation pass.

Photo review displays five remaining proposals at a time, preserves actual object
identity/removal and original exact pending keys, and explicitly says Add covers
all remaining events, including other pages. Confirmation still uses the original
whole remaining batch; no duplicated or alternative canonical write path is added.
EN/ES pagination, scope, draft-warning and handoff copy are authored.

Normalized malformed/null/bounds/privacy cases, failed-replacement preservation,
post-provider household change and inbox pane/identity case code are authored,
all unrun. Only source inspection/edits and selected-file formatting. No tests/
typecheck/lint/build/browser/rendered/API/native/schema/SQL/DB/client/CI,
activation or push/merge/deploy occurred. Unsent drafts are still in memory:
durable owned capture/recipe draft persistence, exact submission/unknown-result
lifecycle, wider role/device views, grounded references/evaluation and other ledger
scope remain. QA stays deferred; #123/#144/#499 and the full goal remain open.

## Responsibility saved-request discovery and paused host source — 2026-10-21

The parent inbox saved-request adapter now includes responsibility/backup commands.
It uses the existing strict responsibility recovery context/journal, exact person
owner lease, 128 KiB bound, current parent identity checks and both snapshot store
reads. Only fixed kind/time and the canonical target recovery URL are projected;
no request key/body/source hash, subject identity/name or consent statement enters
inbox rows. Unknown/expired/possibly committed requests are not dropped or sent.
The original responsibility recovery endpoint remains the receipt authority.

ResponsibilityProvider now separates personal recovery hosting from new-control
readiness, matching preparation/schedule. A valid direct personal target URL can
mount the existing recovery-first sheet while new changes are paused. New buttons
and statement previews still require readiness; all writes keep existing server/
journal gates. Child handoff, paired/device/fridge and sibling-overlay restrictions
remain. The sheet may navigate between recovery targets while paused; this grants
no write permission. Recovery initializes before current/deleted-target reads.

Paused adapter, cross-household command/current-role refusal and paused-host/child
handoff case source is authored, all unrun. Only source reads/edits and formatting;
no QA/test/typecheck/lint/build/API/browser/native/schema/SQL/DB/client/CI,
activation or push/merge/deploy. Capture/recipe/notice draft adapters, wider role/
shared readers, grounded references/evaluation and other ledger code remain.
Consolidated QA stays deferred; #123/#144/#499 and the full goal remain open.

## Read-only saved-request inbox adapters — 2026-10-21

The parent Review inbox now has a Saved requests section. Preparation and schedule
journals are checked only after an explicit click, one type at a time, using
current server-authorized person context and the exact same owner-scope lease
as their domain writers. It does not initialize/reconcile a second journal,
inspect receipts, copy request bodies into inbox storage, retry, dismiss or send.
No automatic mount/focus discovery or write is added.

A new bounded snapshot reader validates both current context and all candidate
stores, strict v2 owner envelope and the domain journal/matching entries. Retired,
corrupt, oversized, unreadable, mismatched or divergent replicas hold discovery;
no replica is cleaned, selected over another or called empty after a read failure.
After the asynchronous projection it renews full owner/generation/household and
rereads every store under the lease. Any change withholds the earlier projection.
Successful reads register only the content-free owner for existing logout
retirement; queue data is never written. Existing store adapters may open their
normal IndexedDB infrastructure; no queue entry is created. Unsupported/blocked
IndexedDB or local storage holds this adapter rather than silently guessing.

Adapters project fixed request-kind labels, original issued time and constructed
allowlisted recovery URLs only. No task/event names, exact bodies, request keys,
hashes, source tokens or credentials enter inbox component state. Preparation
also verifies the canonical browser digest before projection. All outcomes stay
explicitly unchecked; even committed/expired/deleted-target requests are retained
for the original recovery screen to inspect. Paused writes do not hide saved
work. Existing preparation/schedule URL hosts mount recovery before fresh target
reads, so discovery does not require a current target or new write readiness.

The compact EN/ES view displays at most five items. It clears on hidden/blur,
owner prop or selected type changes, owned-store notifications and related
preparation/schedule/responsibility overlays. No automatic refetch occurs. An
operation epoch, synchronous current identity/type/overlay check and render-time
projection identity mask suppress late responses and old-person projections.
Signed-in fridge mode is redirected from the private inbox; paired sessions
remain refused by the canonical server session helper. No shared/device DTO or
reader capability is widened.

Snapshot conflict/retirement/paused/owner/store/read-only cases and component
explicit-click/late-owner cases are authored, all unrun. No tests/typecheck/lint/
build/browser/rendered/API/native/schema/SQL/DB/client/CI, activation or push/
merge/deploy occurred. Only source inspection/edits, formatting and local source
work. Capture's existing recovery loader rewrites/prunes storage while loading,
so it was deliberately NOT reused for read-only inbox discovery. Capture/recipe/
notice drafts, responsibility/other-domain saved work, full grounded references,
shared/profile readers and broader ledger code remain. QA stays deferred.

## Role context, routine links, initial review inbox and AI source renewal — 2026-10-21

Child/teen personal home source now adds read-only event-preparation context to
its already-selected own canonical tasks and picture-routine steps. The scoped
SQL renews the exact account role/household and requires Chore assigned_to to
match that account, no profile subject, no erased subject and no template. Only
shared-schedule Event title is projected (bounded); no Event ID, plan tokens,
other people's work/verification, cues, assignment or edit capability is sent.
This is optional context, not a whole-plan summary or completion claim. Empty
context does not imply no relationship. Default-off preparation/schema/domain
gates apply. Profile subjects are not authenticated actors; paired/shared-device
readers and profile-targeted context remain separate unfinished scope.

Parent routine-stack views now receive the existing bounded exact task-ID
backlinks, including concrete dated steps and history where present in the
initial page. Embedded canonical rows keep their existing action gates. No
routine-label matching, source-history copying or promotion of a copied one-off
back into a routine was added. Durable source-routine provenance for new copies,
canonical-editor context and later history-page discovery still need code.

The initial parent Review inbox is authored at /dashboard/review, linked by a
labelled 44px header control. It renews current parent household scope in every
canonical query and has two sources: actual completed Chores awaiting a check,
and Event preparation whose stored reviewed source differs from current Event
generation/epoch. Invalid/saturated Event source versions remain review items.
It reads 21 candidates per keyset window, returns 20 and displays five at a time;
filtered empty preparation windows retain their next cursor. No all-clear or
whole-household pending count is inferred. Items open canonical chore checks or
the existing reviewed preparation host; no bulk approval, second completion store,
new automatic action, provider call or migration is introduced. Optional missing
preparation substrate is a paused section. Source errors retain the normal page
error boundary. EN/ES copy describes current inbox scope. Notice/recipe/capture
and saved-request adapters are NOT yet a unified review inbox; see its new plan.

Assistant replies now renew person authentication/role/household/token, provider
configuration and normalized features after provider latency, before returning
private reply/action content. Opt-in Today responses must still be within the
original 60-second lease, with the gate on and a fresh canonical typed projection
identical to the original. The second read anchors the original day/window while
reading current source values; failures, changed/deleted projected records and
expired context withhold the old answer with a content-minimal refresh response.
Provider credentials are compared only in memory and never logged/returned.
Canonical actions still require their own target authorization and confirmation.
This is projected-value freshness, not a signed reference/citation protocol,
semantic hallucination proof, source-generation/ABA guarantee or snapshot-wide
transaction isolation. Wider grounded planning and #144 evaluation remain open.

New role/projection, inbox window/stale-plan and delayed-provider source cases
are authored, all unrun. Only source reads/edits and formatting occurred. No
tests/typecheck/lint/build/browser/rendered/API/native/schema/SQL/DB/client/CI,
provider/flag activation or push/merge/deploy occurred. QA stays after remaining
code. #123/#144/#499 and the integrated goal remain in progress.

## Personal Today and chore preparation discovery source — 2026-10-21

Personal parent Today now has preparation entry points on its bounded event rows,
in both configurable and fallback personal layouts. Linked tasks in the personal
summary, Next up and open chore board rows have an event-preparation backlink.
The existing Chore completion/check/Undo controls remain canonical; the backlink
is a separate button, outside the completion control. EN/ES labels and a hydrated,
validated viewer IANA zone feed the existing reviewed preparation host. No zone
is guessed if the browser cannot supply one. Opening renews canonical authority;
a link is not a freshness, due-day or whole-event readiness assertion.

The additive server projection renews parent/household membership in the same
scoped relationship SELECT, joins both canonical Event and Chore household keys,
filters to already-visible non-template Chore IDs and active domain features,
and returns only Chore-to-Event IDs. Readiness/schema absence omits discovery.
It deduplicates/bounds the supplied window at 300 IDs; absence from this map is
not an exhaustive assertion that a task has no preparation relationship. Older
history fetched later and non-open chore presentations still need their own
explicit bounded discovery integration.

The personal map is a separate prop: it is never added to shared/persisted board
DTOs or device responses. Fridge, device, child/teen and cached-snapshot entry
controls are omitted, and the parent host remains default-off. No linked Event
content, cue details, private task content, progress or names are copied into the
relationship projection. Confirmed preparation writes continue using the existing
content-free canonical refresh; no polling, scheduler or alternate task store was
introduced.

Projection role/readiness/schema/window/source case code is authored, unrun. Only
source inspection and explicit-file formatting occurred; no tests/types/lint/build,
rendered/browser/native/API/schema/SQL/DB/client generation/CI, activation or
push/merge/deploy occurred. Remaining code includes narrower authorized reader
projections, dated-routine/canonical-editor provenance and remaining task views,
unified review inbox/what-changed, grounded planning/evaluation and broader ledger
scope. Consolidated QA remains deferred; neither #123 nor release is complete.

## Event preparation pickers and compact personal sheet source — 2026-10-21

The requested picker/UI code slice is authored: a bounded task/account/profile/
routine discovery API, strict scoped client page contract and lazy EN/ES rounded
form sheet. Discovery uses current parent household/feature/profile authority and
canonical task/routine availability, with literal search and keyset ID windows.
The API reads at most 21 IDs; filtered empty windows keep an honest next cursor.
The UI displays five candidates/steps/confirmation rows/removals at a time and
never skips the remaining candidates inside a fetched page. No email directory,
private raw rows or alternate subject/task model enters picker projections.

The sheet supports new once-only tasks, existing-task linking/unlinking/reorder,
explicit people selection including gated email-free profiles, per-step details/
points/difficulty/duration, fixed days and named-zone start/end before/after cues.
Current locked/scheduled task days remain locked. Changed events require an
explicit keep-days (clear only mismatched cues) or selected-retime decision.
Stale task versions require an explicit current-source acknowledgement. Reusing
a selected stored routine day copies chosen concrete steps into new canonical
work with explicit person/points/day/cue overrides; source routine/content/checks
and historical credit stay separate. Save pending manual task changes before
starting a routine copy; copied drafts can be resumed/cancelled locally. Repeating
Event targets remain held pending canonical concrete-occurrence #124 support.

Exact selected scope is refreshed before the server preview; the compact review
shows new tasks, date changes, removed links (tasks kept), people/days/cues and
bounded per-step rows before confirmation. Existing task links open the canonical
chore editor. Newly confirmed proof emits content-free calendar and canonical-page
refreshes. Calendar native event details close before opening preparation; gated
parent weekly event rows expose independent preparation entry locations.

Only gate/role props enter the provider. Child/teen, paired-device routes and
signed-in fridge mode omit the personal host/controls. Normal query navigation
supports Back/direct URLs; a saved personal URL still mounts owned recovery when
new readiness is paused. Preparation/schedule/responsibility hosts are coordinated,
and weekly review keeps state while releasing its dialog/focus/scroll ownership.
Input/select colours inherit existing app theme/native-menu safeguards.

The session initializes recovery before any event read, retains drafts on source
failure, clears/hides private projections/drafts on owner change, renews the full
owned identity and never stages after closing during asynchronous intent hashing.
Closing during durable staging preserves recovery without a late send. Check/
exact retry/local forget, separate stage-versus-dismissal repair and unknown proof
holds are wired; proof is followed by a separate current read. A failed current
read cannot display cached whole-preparation checked status as fresh acceptance.

Picker isolation/paging/schema and component five-row/navigation/fridge/child/
close-during-hash/storage case source is authored, all unrun. No tests/types/lint/
build, API/schema/SQL/DB/client generation, browser/rendered/native/CI, activation/
push/merge/deploy occurred. Default-off readiness is unchanged. This is authored
UI source, not rendered UX/role/storage/native acceptance. Wider #123 role/device
reader projections, additional canonical discovery/backlinks, unified inbox/what
changed and grounded planning, plus the broader ledger, remain code work. QA stays
at the consolidated pass after remaining implementation; #123 is not closed.

## Event preparation exact recovery/client source — 2026-10-21

The next #123 slice adds strict browser-safe view/effect/recovery envelopes,
readonly GET/POST owned recovery endpoints, foreground client and personal owned
journal source. Actor/household/token/parent authority renews independently of
Event/schema/age/readiness. Matching historical proof is inspected first even
for a deleted Event or paused feature; it does not assert current preparation.
Uncommitted retry requires current exact sources and an applicable pure plan.
Ready/pending/committed/expired/conflict/paused/unavailable are distinct states.

The exact original body/key and canonical command digest are saved; retry is
explicit, owner/header and inspected entry are matched, tampered digests are held,
and unknown acknowledgements never confirm. Current preview effects are also
recomputed from the strict deliberate projection before creating an intent.
Node idempotency hashing is isolated from browser contracts; Web Crypto computes
the equivalent validated canonical digest in the browser, with no provider/key.
No mount/focus/background write or new queue action was introduced.

Request bodies allow 1 MiB for 99 full steps; inspection envelopes allow twice
that plus overhead. Owned storage allows two pending requests within 6 MiB,
using current generation/household retirement, cross-store/lease checks and
explicit quota/divergence/owner-change holds. An intent must stage durably before
send; recovery initialization does not send. Paused owned journals allow read/
inspection/local forget. UI close/storage-repair wiring remains next.

Receipt source now stores only createdCount rather than up to 99 client-to-Chore
ID pairs. Full mapping could exceed the existing 8 KiB generic receipt limit and
be replaced by a generic success marker. The bounded minimal proof still binds
full command digest/owner/event/source/key and fits that limit; fresh canonical
reads supply current task IDs. This changes unactivated/unrun local source only.

Source cases cover digest/preview/body/key/proof/schema faults, 99-step body and
receipt bounds, deleted-target/paused/expired inspection, exact pending sources,
restored-journal review, quota, owner change and paused forget. All are unrun.
No tests/types/lint/build, API/schema/SQL/DB/client generation, browser/native/CI,
activation/push/merge/deploy occurred. Required next code remains canonical
pickers, compact EN/ES sheet with exact stage/send/close/storage recovery and
canonical discovery/backlinks. #123 and the integrated goal remain active.

## Event preparation canonical API/effect source — 2026-10-20

The next #123 slice adds parent-person Event preparation GET, readonly selected-
source/command-preview POST and owned-idempotent PATCH source. New default-off
`FAMILY_EVENT_PREPARATION_READY` plus existing owner recovery gates hold writes.
No flag was changed. Request bodies are bounded at 1 MiB to support the full
99-step content contract; future owned journal must retain that exact body.

The bounded loader renews current actor token/household/role and calendar/chores
features. It collects linked/selected/dated-routine task and recurrence-root IDs,
locks related Users/profiles/source stacks before sorted Chores, then Event,
plan/links and receipt. Dependency and plan/routine membership changes cause a
fresh-review refusal; no late identity/root/stack lock is acquired. Canonical
subject, profile age/link/erasure/gates and scheduled-routine availability apply.
Template controls/unsupported recurring Event targets are held. Only pristine
open standalone once-only tasks are eligible for explicit date changes.

Canonical content/subject/root source epochs are combined with a new Chore
preparation-only completion/proof epoch (additive schema/SQL source). Completion
then undo invalidates an old preparation request without changing responsibility
consent semantics. Scope also binds exact link IDs, current selected identity
source versions and source occurrence membership. Unavailable task text/state is
omitted from the personal projection; profile gates remain explicit. Routine
copy content is validated from actual canonical fields rather than truncated UI
text, and unavailable/invalid source content cannot be copied or projected.

The internal mutation creates fresh pending one-off Chores without recurrence,
proof/completion/photos or copied credit, retimes only explicit eligible work,
and detaches/reorders/inserts metadata. Removing all links removes the plan,
not tasks. Canonical effect and content-minimal receipt are one transaction;
completed matching claims replay before target/schema/readiness reads and do
not create another copy. Historical proof does not assert current preparation.

Source/server/projection/role/dependency/receipt cases and a disposable completion-
undo epoch case are authored, all unrun. No tests/types/lint/build, Prisma/client/
SQL/schema/DB operation, browser/native/CI, activation/push/merge/deploy occurred.
Still required: strict client/recovery envelopes, paused/deleted-target owned
receipt inspection and journal, paged canonical pickers, short EN/ES sheet and
canonical discovery/backlinks. Full #123 and the integrated goal remain open;
consolidated QA follows remaining code.

## Event preparation contract, lifecycle and reviewed scope source — 2026-10-20

The next #123 slice authors canonical EventPreparation/Step metadata, additive
Prisma/SQL source, pure parent transition planning, deterministic reviewed-scope
fingerprints, old-generated-client-compatible storage probes and household cleanup.
New steps/routine copies propose fresh pending once-only Chores; canonical tasks
continue to own completion, checks, photos, points and due days. Linking/detaching
never completes, reassigns or deletes canonical work. Explicit cues derive a day
from an actual event instant and named zone. Changed events require a keep-days
or explicit eligible-retime decision; scheduled/completed work cannot be retimed.

Scoped FKs and canonical move/delete cleanup preserve tasks when events/plans go.
Plan lifecycle advances Event preparation epoch; inserts/material step updates
advance plan revision. Chore cascades remove links without updating a shared
parent row, avoiding chore->plan->another-chore lock cycles. Membership is in the
scope fingerprint; relinking advances revision. Event family move cleanup runs
after the outer update with a deferred FK. Saturation holds new reviewed edits.
These are authored concurrency contracts, not observed PostgreSQL evidence.

The scope binds actor/protocol/policy/zone, canonical source versions, plan
lifecycle/revision, ordered links/cues, availability/completion, eligible subjects
and exact dated routine sources. Task/directory query order is normalized. Parent
portability exports relationship metadata only for already-exported canonical
Event/Chore IDs and renews current household/role in SQL; child/teen receive none.
Whole-household deletion names optional metadata cleanup after Event cascades.

Contract/scope/compatibility/disposable lifecycle case source is authored, unrun.
No tests/types/lint/build, Prisma generation/validation, schema/SQL/DB operation,
browser/native/CI, activation/push/merge/deploy occurred. Required full API/source
loading/canonical mutation/receipt/recovery/EN-ES sheet/discovery remains code work
under `docs/plans/event-preparation-v1.md`; #123 and the full goal remain open.
Consolidated QA follows remaining implementation.

## Schedule review sheet and canonical discovery source — 2026-10-20

The next #123 slice adds the lazy EN/ES personal schedule-review sheet and entry
points from calendar overlap previews, native event details and weekly schedule
rows. The short flow separates current event/known constraints, editable buffers
and explicit search windows, three nearby options and exact before/after save.
Target and other-event preparation/travel buffers are explicit comparison-only
settings; they do not add reminders, send messages or infer attendance. Up to
16 windows are edited one at a time; search/selection bounds other buffers and
paged confirmation avoids long lists. Caps, unknown sources, recurrence and
read-only/provisional results keep confirmation held.

Wall-time input uses the named zone: nonexistent DST times are refused, repeated
times require an explicit offset, and known original offsets stay selected.
Displayed instants include offsets and seconds/milliseconds when present; format
fallback is explicitly exact UTC. Drafts survive read/preview errors. Changed
comparison buffers require explicit current-version review or removal. The server
preview envelope is kept separate from UI-only plan/selection metadata when the
immutable request is staged.

A gate/role-only provider uses ordinary query navigation and Back/direct-URL
closing, preserving weekly context. No household/owner identity is seeded into
layout props. Fridge mode hides the host and controls. Readiness hides new entry
buttons, while existing personal review URLs can still inspect their saved
requests during pause/rollback. Calendar details close their native top layer
before opening the sheet. Responsibility and schedule overlays are coordinated;
weekly review keeps state/journal/cursor mounted but releases its dialog/focus/
scroll ownership while timing review is active, avoiding lazy-dialog races.
Confirmed proof triggers content-free calendar refresh and weekly summary reads.

The sheet initializes owned recovery independently of a target read, stages
before send, invalidates operations synchronously on close, blocks duplicate
operations and never auto-sends recovered requests. Unknown/refused outcomes keep
exact body/key. Check/retry/forget and stage-versus-dismissal storage repair are
explicit; recovered deletion cannot resurrect old memory. Past proof clears the
old projection before a separate fresh read. Owner changes hold/clear the prior
projection. Calendar/domain use remains separate from this optional review.

Form, navigation/privacy, role, exact stage/send, close-during-stage, deleted-
target proof, uncertain dismissal and unsent-draft failure case source is authored
and unrun. Source editing/inspection/formatting only: no tests/types/lint/build,
API/schema/client/migration/SQL/DB/provider/browser/native/CI/activation/push/merge/
deploy. Current source is not UI or release acceptance. Concrete-event conflict
review now has source across its full UI/backend/recovery journey; recurrence
scope/coverage and all real role/locking/storage/viewport/native acceptance remain
open. Next required #123 code: event-linked preparation through canonical tasks/
routines, unified review inbox/what changed and grounded planning; #144 and the
broader repository goal remain active. Consolidated QA follows remaining code.

## Schedule review authenticated API and owned recovery source — 2026-10-20

The next #123 slice adds person-only schedule GET/PATCH, readonly preview POST,
and recovery GET/POST source. Actor/user token/family/role and current Family
calendar feature are renewed under ordered locks; only parents can move concrete
editable events. Read projections expose bounded canonical titles/times/origin/
source tokens, not descriptions/addresses/emails/provider URLs/tokens. All sources
are compared regardless of display filter. Invalid data/unknown protocols hold.
The target remains in capped previews; caps and stored-only recurrence are honest
unknowns. Source status is read before/after projection. Pending/failed/missing,
older-than-24-hour or excessively future-checked sources mark coverage uncertain;
no provider refresh or availability/attendance inference occurs.

Source freshness/status/generation metadata is bound into the snapshot hash and
compared again with the entire event source set in the SAME atomic time-effect
SQL statement. No source/collection/blocker row locks are acquired after the
target. The canonical effect and exact minimal receipt commit in one transaction;
completed takeover/replay returns own proof without reapplying or caching a
private schedule DTO. Wrong hash/key/actor/family/target/source/times fail safely.
Proof is historical; the UI must separately reload current schedule state.

The separate owned journal/browser adapter retains immutable body/key (four
bounded entries), has current owner/generation/store continuity checks, and
requires inspected recovery before retry. Unknown/refused/malformed results do
not confirm a move or delete pending work. Own committed proof can be checked
after age/target/write-pause changes; unconfirmed requests renew current source,
role/feature/candidate/15-minute intent age and readiness. No automatic replay,
new key on retry or failed-transaction-as-empty-success behavior. New
`FAMILY_SCHEDULE_REVIEW_READY` defaults off; existing owner-recovery/rollback
switches still gate writes and were not changed.

Runtime/server/client/recovery and disposable-DB regression source is authored
and unrun. Source inspection/formatting only; no tests/types/lint/build/API/DB/
schema/client/SQL/provider/browser/native/CI, activation/push/merge/deploy. Required
next code is the compact EN/ES conflict/alternative/buffer/search/preview sheet,
exact pending/close/storage-repair lifecycle, canonical discovery and weekly
integration. All PG/locks/receipt/concurrency/role/privacy/storage/rendered/native/
release acceptance remains deferred. #123 broader workflows, #144 and the full
repository goal remain active; one consolidated QA follows the remaining code.

## Canonical schedule source/atomic-compare foundation — 2026-10-20

Continued #123 with additive Event insertion generation/material epoch Prisma
and migration source, immutable/monotonic legacy-writer trigger behavior and
range-end/recurrence/invalid-interval indexes. No new schedule or collection-
version store. Canonical Event ownership/deletion/cascades remain authoritative.
Saturated versions hold new conflict-review use; ordinary edits remain possible.
No schema generation/migration/SQL or database operation ran.

`schedule-source.ts` adds schema/trigger probes, scoped target locks, a common
padded all-source/recurrence/invalid-interval comparison predicate and bounded
single-statement source reads. Snapshot fingerprints bind original actor/session,
range/zone/coverage and sorted insertion/material tokens. Review requests now
carry original range/zone explicitly. The internal confirmed-move primitive
compares the exact source set and changes canonical Event times in ONE statement
snapshot, with target epoch/family/source/duration checks and validated returned
times. It is not an authorized endpoint: caller must lock/renew actor/household/
Family/target, recompute the full applicable candidate and commit its minimal
idempotency receipt in the SAME transaction. No API/UI calls this helper yet.

A shared collection row was deliberately avoided: legacy multi-event writers
must not acquire collection-then-another-Event locks. Other comparison events
are MVCC reads, not late row/identity locks. Changes committed before the atomic
comparison snapshot invalidate old source sets; later independent changes can
introduce another conflict and no permanent availability claim is made.

Unit/disposable-DB source cases are authored and unrun, including trigger/source
continuity, recreated IDs, old-value restoration, new/deleted blockers, foreign
scope, UTC/duration and saturation. Only source editing/inspection/formatting:
no tests/types/lint/build/API/DB/schema/client/SQL/browser/native/provider/CI,
activation/push/merge/deploy. Required next source is authenticated snapshot/apply,
coverage/source status, minimal receipts and owned recovery, then EN/ES controls/
discovery/weekly integration. Full #123/#144/repository scope remains active;
consolidated QA follows remaining code.

## Schedule conflict planner source — 2026-10-20

Continued #123 from the existing calendar overlap disclosure, which remains an
advisory details/edit path. The full required conflict-review contract now lives
in `docs/plans/schedule-conflict-review-v1.md`; it preserves canonical Event,
source/role/device/household boundaries, explicit buffer/search controls, exact
preview/confirmation, pending recovery and current-source/whole-range concurrency
requirements. It is not a substitute for the required API/apply/UI journey.

`calendar-planning/conflict-review.ts` adds strict owner/snapshot/target-bound pure
planning source: half-open overlaps, actual versus buffer-only explanations,
separate preparation/travel-before/travel-after, explicit search windows, gap-
based closest alternatives (three), exact duration/seconds and injected clock.
It compares instants across DST, bounds events/windows/overrides/previews, rejects
duplicate/foreign/unknown/stale inputs and never infers who attends. Partial,
capped, failed-source, recurrence-unknown or out-of-coverage original buffers
hold application. Read-only/subscribed/child/teen/repeating targets also hold.
Exact preview intents must select an actual applicable candidate; no I/O/write
or provider call exists in this layer.

Source cases are authored for adjacency, actual/buffer-only conflicts, preparation
not starting in the past, duration/seconds, repeated DST hour, incomplete coverage,
role/source/recurrence holds, stale/foreign/missing/duplicate scope, window bounds,
determinism, exact candidate previews and no openings. All remain unrun. Only
formatting/source inspection occurred; no tests/typecheck/lint/build/browser/
native/API/schema/client/SQL/DB/provider/CI/activation/push/merge/deploy. Next source
must implement canonical event/whole-range versioning and fresh authorized
snapshots, atomic reschedule/receipt/owned recovery, EN/ES short controls and
weekly integration. Full #123/#144 and the broader goal remain active; QA follows
remaining code. START_HERE's earlier responsibility UI-next pointer is reconciled
with its already-authored controls/weekly integration.

## Responsibility controls and weekly review source — 2026-10-20

The next #123 slice adds a lazily loaded EN/ES responsibility sheet to canonical
open chore occurrences (including expanded routine rows), personal Today chores,
pickups and handoffs. It displays primary/coordinator and backup separately,
awaiting/accepted/declined, and self versus named parent-recorded provenance.
Parents cannot answer for another account. Parent-recorded profile answers use
the existing server eligibility gates. Progressive people search and an explicit
preview precede every change; naming does not assign/complete/activate/contact.
Handoff coordinator remains separate from external sitter details.

A gate/role-only dashboard provider owns normal query navigation and Back/direct
URL closing without seeding household identity onto shared surfaces. Fridge mode
and child handoff controls are omitted. Personal owner context is fetched only
on opening. Every intent is staged with its immutable body/key before send;
closing invalidates its operation before navigation/unmount, so persistence
finishing late cannot launch a mutation. Pending requests are never auto-sent.
Explicit inspection/retry/forget, unknown/refused outcomes, paused/closed/source-
changed states, owner-change holds and stage-versus-dismissal storage repair now
have UI source. Recovery initializes independently of target reads so deleted or
newly forbidden targets cannot hide an own saved request. Historical proof is
followed by a separate fresh target read, not cached acceptance.

Weekly-reset responsibility summaries add gated canonical target references.
Only visible bounded rows load read-only statement previews through separate
transactions, preserving identity-before-target lock order; previews label their
snapshot and unmount while editing, then read again on return. Weekly review
progress still implies neither consent nor completion. Flag-off summaries retain
the existing explicit unknown note; child handoff summaries gain no new target.

Journey/navigation/privacy/storage test source is authored and unrun. Formatting
only; no tests/typecheck/lint/build/browser/native/API/DB/schema/client/SQL/CI,
push/merge/deploy or activation occurred. New responsibility readiness stays off.
Source authored is not release acceptance. Next required #123 source is conflict
review, event preparation, the unified review inbox/what changed and grounded
planning, with #144 quality/telemetry still separate. The full goal stays active;
one consolidated QA follows the remaining code.

## Responsibility authenticated API and owned recovery source — 2026-10-20

Gated person-only responsibility GET/PATCH and recovery GET/POST now have source:
strict bounded requests/private DTOs, current actor role/token/family checks,
related identity locks before target/root/state, canonical subject/availability
rules and changed-relationship holds. Parent-only choices are bounded/searchable;
children/teens do not receive a household directory, and children never get
handoff coordination context. No private notes/addresses/ages/emails or bearer
secrets are returned. Chore/pickup ownership/completion remains canonical.

The metadata effect and exact minimal receipt commit together. Existing-key
hash/scope/user/family checks and completed proof prevent takeover reapplication;
replay renews authority. Own historical proof is distinct from current target
access and never carries cached names/target DTOs. Recovery checks live source/
revision/age/role/eligibility without applying an effect. The shared owner-bound
journal preserves immutable body/key, explicit inspected retry, physical-store
repair/retirement and no background replay. New readiness + existing recovery
gates were not changed; the new feature defaults off. No provider or invitation/message was added.

Runtime/server/client/recovery source cases are authored but unrun. No QA/tests/
types/lint/build, schema/client/SQL/DB/app-API, browser/native/provider/CI, push/
merge/deploy or activation. Required next code: compact EN/ES canonical controls,
closing/pending/dismissal recovery UI and weekly-summary integration. Full PG/
lock/trigger/FK/role/storage/device/rendered and release acceptance is deferred.
The full goal is active; consolidated QA follows remaining repository code.

## Responsibility FK/storage/lifecycle source — 2026-10-20

The next #123 slice now has additive Prisma/migration source for one FK-attached
ResponsibilityState per canonical target, typed consent/backup/coordinator columns,
family-scoped identities/targets and constrained statement shapes. Canonical
chore/pickup owners are preserved. New immutable DB generation + monotonic epoch
columns/triggers bind material edits, away/back changes, recreated records and
routine roots. Identity retirement invalidates primary work even before metadata
exists, advances affected counters and clears participation for membership/role/
profile/archive/erasure/link lifecycle changes, independent of rollout. Counter
saturation holds consent operations, not ordinary domain edits. No SQL has run.

Private raw adapters now probe source availability, lock target/root in stable
order, decode exact typed state, and perform target/protocol/revision CAS without
replacement. Callers still need current actor/household/related-identity locks and
fresh authorization; API/atomic receipt/owned recovery are next. Export includes
only current own participation with live family/role checks and excludes child
handoffs/target text/source tokens. The explicit household deletion plan now names
the model and uses a compatibility-probed SQL cleanup before its targets/identities.

Unit/fake and guarded disposable-PG test source is authored but unrun. No Prisma
client generation/schema validation/migration, SQL/DB/API, tests/types/lint/build,
browser/native/provider/CI, push/merge/deploy or activation. Old generated overlay
unchanged; full restore/migration/concurrency/FK/old-client/privacy/rendered/native
and release acceptance remains deferred. Next: authenticated API/atomic receipts/
exact owned recovery, then compact canonical UI and weekly summary integration.
The broader goal stays active and consolidated QA still follows remaining code.

## Responsibility/backup consent contract and planner source — 2026-10-20

`docs/plans/responsibility-and-backup-v1.md` now defines the full #123 canonical
owner/awaiting/accepted/declined/backup journey, short EN/ES UI, current-role and
profile boundaries, real target/identity FK persistence, legacy-writer source
invalidation, lifecycle/export and exact owned recovery requirements. Chore and
pickup primary ownership stays canonical. Handoff's sitter name is not identity;
its household coordinator must be explicitly chosen, not inferred from a name.

The strict pure contract/planner now binds original person/family/target/source
and revision/issuedAt; separates self and parent-recorded profile statements;
limits configuration to parents and account consent to the named account; allows
named account backups to respond for their own slot; invalidates statements for
changed source epochs; refuses duplicate primary/backup and unknown future data;
and keeps metadata separate from domain completion/reassignment. New pure cases
are authored but unrun. No source epoch, SQL/FK/transaction or UI claim is made.

Required next code remains additive FK persistence, legacy mutation invalidation,
lifecycle/export, locked person API/atomic receipts/exact owned recovery, full
canonical EN/ES controls and weekly-summary integration. No schema, DB, endpoint
or live feature was added/activated. No tests/types/lint/build, schema/client/
SQL/DB/API/provider/browser/native/CI, push/merge/deployment operations occurred.
The full goal stays active and QA follows the remaining code.

## Weekly review profile routines and recipe-gap source — 2026-10-20

The responsibility summary now reuses canonical chore subjects and visibility:
parent-only named email-free profile previews under existing gates, current
family/link/erasure/age/role checks, and unchanged teen/child own-account reads.
Internal IDs/age/mapping are omitted. No profile authenticates a viewer and no
routine/task state is mutated. Stored/capped previews remain explicit.

A role/feature-gated grocery gap group now compares bounded current-household
linked unprepared meals/recipes with canonical inventory presence and expiry
rules. Already prepared bulk dishes are excluded. Actual today is the minimum
comparison date, repeated recipe/ingredient pairs are collapsed, and missing/
foreign/oversized/ingredient-less recipes or truncated stock produce an explicit
incomplete state. No recipe/stock context goes to a child or disabled feature.
Recipe/meal-plan links reuse existing explicit review/add flows; no grocery write,
quantity sufficiency claim, unit conversion, provider request or new scheduler.
The EN/ES sheet distinguishes no compared recipes, no gaps in compared recipes
and incomplete coverage. Profile/gap/role source cases are authored but unrun.

No tests/types/lint/build, schema/client/SQL/DB/API, browser/native/provider/CI,
push/merge/deploy or activation. Existing rollout settings remain unchanged.
Weekly-review source acceptance is still unverified. Next broader #123 work is
accepted/backup responsibility and the other approved coordination/grounded
planning outcomes, preserving all remaining repository scope and later QA.

## Weekly reset compact UI and exact owned recovery source — 2026-10-20

The gated personal Today entry now lazily opens an EN/ES short review sheet with
router-owned Back/close, one step on phones/step rail on larger screens, bounded
previews and canonical links, week selection, explicit start/review/skip/back/
restart/finish, skipped-step summary and personal-only completion wording.
Shared/fridge discovery is excluded. Current semantic tokens and shared Dialog
focus/scroll/footer behavior are reused. No rendered behavior has been verified.

Commands/receipts now bind the original account as well as household/scope/action;
issuedAt prevents expired unconfirmed intents being reapplied. The shared owned
request journal handles exact body/key staging before any send, session/generation/
household retirement, cross-store divergence/repair and explicit recovered review.
Person-only recovery inspection checks current authority, request hash, receipt,
revision/protocol/age and availability without executing a progress/domain write.
Unknown acknowledgements/storage outcomes stay held. Partial dismissal repair
cannot restage a confirmed removed request. A fresh role projection follows ack.
Writes additionally preserve the existing queue-recovery enable/rollback gates;
all readiness/rollout settings remain unchanged. No background replay/provider.

New UI/client/recovery-server source cases are authored but unrun. No tests,
types, lint, build, schema/client/SQL/DB/API, browser/native/provider/CI, push,
merge, deployment or activation. Required next internal code: profile-routine
and recipe ingredient-gap review integration, then the remaining broader #123/
#144 coordination/grounded jobs and full repository issue scope. QA follows all
code; this is not a completed issue, integrated acceptance or release claim.

## Weekly reset bounded summary source — 2026-10-20

A gated, person-only, strict single-step summary GET now renews current actor
and household authority before reading canonical data. Source projects bounded
stored schedule, account chores, pickups/handoff, meals, several-dish prep with
exact active-consumption totals and next prep, current safe use-soon food, and
actual open groceries. Scope/actor/step/time, caps, unknowns and read failures
are explicit. No provider, calendar refresh, routine top-up or domain write.
Verified-email prep gating and child/teen restrictions remain enforced.

This is partial summary code, not a complete weekly review. Profile routines,
recipe ingredient-gap integration, accepted/backup responsibility controls and
the compact discoverable EN/ES UI with exact pending-request recovery remain
required implementation. Stored-only/capped reads do not promise a complete or
conflict-free week. Source cases for role/authority/DST/caps/source failure/food/
prep are authored but unrun. No tests, types, lint, build, schema/client/DB/API,
browser/native/provider/CI, push, merge, deployment or activation occurred.
The existing active goal and consolidated-QA-after-code order are unchanged.

## Weekly reset progress contract and API foundation — 2026-10-20

The previously unimplemented #123 five-minute weekly reset now has an explicit
complete-journey/progress/role/privacy/recovery design in
`docs/plans/weekly-reset-v1.md`, linked from START_HERE. It retains all six review
areas and the required canonical summaries and adaptive UI as outstanding code.
It does not substitute an API or links-only tour for the intended journey.

Authored foundation source includes strict versioned Monday/zone/family/commands,
role/feature section selection, explicit start/restart, individual reviewed/skip/
pending status and complete-only-after-handled Finish. Separate nullable personal
User metadata and monotonic revision have an additive migration source. A gated
person-only GET/PATCH renews actor token/role/membership under user/household/
User-row locks, detects conflicts/unknown protocols, and atomically completes
progress plus existing keyed receipt. Receipts carry only scope/action/revision;
reads recompute currently permitted steps. The readiness flag remains unchanged.

Own export and member-detachment cleanup probe schema compatibility even with
rollout off; deleting the User removes its progress. Stored metadata contains no
names, domain record IDs/content, task completion, responsibility acceptance or
provider data. No login identity/profile privilege or shared-device route added.
Authored contract, transactional-fake and compatibility cases remain unrun.
No generated client, migration, DB, tests, types, lint, build, browser/native/CI,
provider, API invocation, progress write, push, merge, deployment or activation.

Next implementation is the canonical bounded step summaries and discoverable
EN/ES phone/tablet/desktop review/resume/skip/restart/finish UI with exact owned
request recovery. Remaining #123 coordination/grounded planning and full
PostgreSQL/schema/client/domain/role/device/release acceptance stay open. The
full goal remains active; consolidated QA still follows the remaining code.

## Assistant/report source reconciliation and exact retry binding — 2026-10-20

Original #464 now maps to the current personal-only lazy host, explicit voice,
typed reviewed fixed actions, one-attempt mutation recovery and own-user reports
in `docs/product/AI_ASSISTANT.md`. Its default chat sends no automatic household
records; the separately gated default-unchecked Today opt-in is now described
accurately. Broader #123 grounded planning and six approved coordination outcomes
remain implementation/reconciliation work, not merely provider or QA dependencies.

Confirmed feedback retry gaps were fixed: the client freezes its original key/
kind/title/details/pathname until confirmed or deliberately edited, validates a
nonempty receipt before clearing, and displays the original request page during
retry. The server renews current account membership/session under actor-user then
household locks. Same-key different normalized content returns a generic 409
without exposing/overwriting the old report; cross-household replay remains 404.
Existing child report permission, strict body/rate limits, own-user reads, schema
and retention remain. No provider or general action capability was added.

New client/server source cases cover malformed receipt/draft retention, exact
retry after navigation, changed content fields and stale session/membership;
all are unrun. Only source inspection, edits and formatting occurred. No tests,
types, lint, build, browser/native/schema/CI/provider/microphone/report operations,
push, merge, deployment or activation. Full action/domain/privacy/role/provider/
ordinary-rendered/native and normal release acceptance remains deferred; goal
active. No report was externally forwarded or real household data mutated.

## Parent Devices source map and pairing attempt guards — 2026-10-20

Original #445 criteria now map to current typed management/pairing/server/helper
source in `docs/architecture/PARENT_DEVICE_LOCALIZATION.md`, with original role,
request/timer/private/native/gallery/hosted/served requirements still deferred.
No old unit/browser/build/capture history is treated as current proof.

A confirmed late-response gap was fixed: polling now checks cancellation after
streamed JSON and advances only the current matching step/pairing ID, including
when expiry was already queued. Each opening owns an attempt generation, retired
by close/unmount/replacement/new-code/denial; late create/confirm/revoke results
cannot overwrite a newer opening or clear its pending state. Closed dialogs stop
poll/countdown effects. Immediate operation guards prevent duplicate submissions.
An abandoned creation whose response arrives later cancels only that returned
code through the existing endpoint. Fresh openings clear prior retry presentation.
These are bounded lifecycle corrections, distinct from localization; no locale
was added to effect dependencies. Original intervals/backoff/request bodies,
parent/household/session/replacement policy and success callbacks remain.

Fabricated mocked-endpoint cases are authored for late expired poll bodies,
close/reopen, closed polling, abandoned code cancellation, immediate guards and
late confirmation. All remain unrun; full locale/native/focus/timer/deny/replacement/
private/role/actual-route and hardware/store/customer proof is still pending.
Only source inspection, edits and formatting occurred. No tests/types/lint/build/
browser/native/schema/CI/device/pairing/provider operations, push, merge, deploy
or activation. Galleries/old reports were not edited. Full goal remains active.

## Mounted Settings source map and subscription-read recovery — 2026-10-20

Original #443 requirements now map to current scoped Settings/child presentations
and existing acceptance source in `docs/testing/SETTINGS_LOCALIZATION.md`.
Historical build/test/gallery reports stay labelled by their own commits; none
is used as current-candidate proof. Original untranslated-copy/startup/guard,
normal harness/workflow/baseline and gallery sources were not edited here.

A confirmed recovery gap was fixed: the subscribed-calendar loader now catches
network/JSON failures and refuses HTTP/missing-list responses as unavailable,
instead of throwing unhandled or implying the household is empty. It presents a
typed EN/ES failure with an explicit 44px GET-only retry, guarded immediately
against duplicates. Draft name/URL/color controls remain mounted/editable, while
Add is held until a valid snapshot is available. This recovery behavior change
is recorded separately from the original translation work. Locale changes do
not restart loads or send writes; existing canonical mutation/provider/raw/time
policies remain. New recovery/mounted-language/draft/GET-count cases are authored
but unrun, complementing existing actual-selector and canonical action journeys.

Only source inspection, edits and formatting occurred. No tests/types/lint/build/
scanner/browser/native/schema/CI/provider/credential operations, push, merge,
deployment or activation. Current original ordinary/expanded, role/device,
private/raw/focus/timer/request, copy-manifest and release acceptance remain
pending. Full goal and normal QA/release protections remain active.

## Native/custom menu foreground source continuation — 2026-10-20

The #448 inventory now records the identified custom-menu, anchored-popup,
aria-haspopup/dialog and native-suggestion implementations alongside 69 native
select declarations in 45 files. It maps their shared consumers and distinguishes
in-flow disclosures from selection popups; lexical scan limits remain explicit.
The earlier partial custom-source inventory is superseded by this continuation,
not by a claim of runtime or all-platform acceptance.

Confirmed presentation gaps are source-fixed: the RoutineFields datalist joins
global solid themed option/disabled-option rules; DashboardNav, CommandPalette,
LongPressRow and shared Dialog elevated containers now have an explicit primary
foreground. ProjectDetailActions pairs elevated surface/primary/separator tokens
while retaining individual success/danger classes. Native selection, menu keys,
focus, pending actions, roles and canonical requests are unchanged. No duplicate
component or new data/provider path was introduced. Low-impact class/CSS edits
do not add implementation-mirroring tests; existing theme/contrast/menu/dialog/
journey source remains for the consolidated candidate.

No tests, types, lint, build, compiled CSS, browser/native/schema operations, CI,
push, merge, deployment or activation occurred. Light/dark actual popup/contrast,
keyboard/reflow, role/device, Android/Windows and normal release proof are still
unrun. Full implementation goal and QA/release gates remain active.

## Family setup guards and dropdown source inventory — 2026-10-20

Original #446 maps to canonical dashboard/standalone Add Everyone, explicit invite
roles/send and finish-later paths in
`docs/plans/family-onboarding-source-reconciliation.md`. Existing gated no-login
profile behavior remains separate; no flags or invitation policies changed.
Two confirmed client gaps were fixed: family creation now owns a synchronous
submission ref before a pending render (also ignores composing Enter), and
ambiguous membership reconciliation bounds both fetch and JSON body through the
existing 2500ms read helper. Timeout retains the draft and unknown state without
advance or automatic retry; late read results cannot mutate the finished race.
The create mutation itself was not given an automatic timeout/retry.

Source cases cover same-turn Enter/click, composing input, failure/draft retention
and stalled reconciliation fetch/body plus late responses; all are unrun.
`docs/plans/native-select-source-inventory.md` records 69 native selects across
45 non-test source files, shared light/dark color-scheme/solid option/optgroup
rules and zero inline option class/style hints from a lexical scan. Custom-menu
inventory/reconciliation is still partial, and no compiled CSS/contrast/browser
or Android/Windows popup behavior is claimed. Ledger updated with those limits.

Only source inspection, edits and formatting occurred. No tests, types, lint,
build, browser/native/schema operations, CI, family creation/invitation, push,
merge, deployment or activation. Full implementation goal and QA/release gates
remain active and unchanged.

## Custom-list/private-cover creation source reconciliation — 2026-10-20

Original #447/#454 are mapped in
`docs/plans/custom-lists-and-private-covers-reconciliation.md`: canonical Custom
picker/types/EN/ES/plain-checklist paths, private folded image upload/preview/
remove, conditional saved covers, nullable additive schema and stale-cleanup
reference protection already exist. Their acceptance remains unrun.

A confirmed code gap was fixed: all list creates now take actor-user then
household-existence locks and renew current membership/create-role/session before
writing. Previously no-cover creation bypassed the transaction; cover creation
renewed role but not the captured session generation. Revoked requests yield 401;
removed/unauthorized creators cannot write. Cover ownership now reads through the
same transaction's upload delegate, with unchanged default behavior for other
photo-helper callers. Canonical request/response and item retry behavior remain.

Authored fake cover/no-cover waiting-authority cases and disposable-Postgres
held-lock, cleanup-order and uncommitted-upload/rollback cases remain unrun. No
tests, types, lint, build, browser/native/schema operations, CI, push, merge,
deployment or activation occurred. No migration executed, real list created,
file removed or provider changed. Full UI/file/role/migration/generated-client/
rendered/device acceptance remains for the consolidated candidate; goal active.

## Calendar connection/form-sheet source reconciliation — 2026-10-20

Original #456 and #455 (including #453) now have requirement/source/remaining-proof
maps in `docs/plans/calendar-connections-and-form-sheets-reconciliation.md`.
Existing parent/configured calendar Settings shortcuts, delayed Settings anchors,
canonical route-backed list/chore forms, null overlay clearing, essential-first
mounted optional sections and pending/focus/inert/scroll protections were retained.
The form-sheet contract now describes the existing owned pending Back sentinel
instead of suggesting pending history is unguarded.

A confirmed presentation gap was fixed: New/Edit Chore sheet chrome now uses the
typed EN/ES chore dictionary for titles, close label and draft/save-upload notices,
through one shared helper retaining the canonical forms and busy callbacks.
Wrapper localization/pending-dismissal cases are authored but unrun; actual form
and upload behavior remain owned by their existing regression/journey sources.
Ledger entries identify implemented source separately from full route, reload,
Back/native, responsive, accessibility, role, offline and provider acceptance.

Only source inspection, edits and formatting occurred. No tests, types, lint,
build, browser/native/schema operations, CI, push, merge, deployment or activation.
The full implementation-first goal remains active; QA and release gates remain.

## Today/grocery/event-duration source criteria mapped — 2026-10-20

Original #461, #462 and #458 were read against their current implementations and
acceptance source. `docs/plans/today-controls-and-event-duration-reconciliation.md`
now records each requirement, exact canonical source, rollback and missing runtime
proof. The ledger moves these issues from unmapped reconciliation to existing
source candidate with deferred acceptance; none is marked verified or complete.

Existing source already supplies the household grocery zero/one/multiple resolver,
grocery-only Today counts with unchanged generic Shopping defaults, separate All
shared lists, filtered EN/ES overview/create context, role/feature-aware compact
person-only controls, 44px/wrapping/Escape behavior and fridge/device exclusion.
Event forms already supply six duration presets/custom minutes, elapsed-time end
calculation, manual-end restoration, original instant precision/fold retention,
EN/ES and imported-source read-only presentation. Existing source was retained.

This pass inspected source and authored requirement maps only. No tests, types,
lint, build, browser/native/schema operations, CI, push, merge, deployment or
activation occurred. Rendered routes, role/device/offline/recovery, localization,
DST execution and the consolidated candidate acceptance remain pending. The full
issue goal remains active, including source reconciliation outside these issues.

## Recurring stop/delete source reconciliation — 2026-10-20

Original #536 requirements now map to existing anchor guards, explicit parent
Stop/Save UI, typed EN/ES recovery and authored route/Postgres/viewport cases in
`docs/plans/chore-series-lifecycle-reconciliation.md`. The acceptance remains
unrun in this candidate. Reconciliation identified a session-generation race:
DELETE checked role/family under its locks but not a revoked token generation;
PATCH stopping/editing lacked the actor-user lock and generation recheck.

Both writes now take actor-user then household locks and compare the current
stored token generation with the authenticated claim before changing chores.
A revoked session returns 401. Existing parent/assignee rules, parent-only fields,
profile/scheduled-definition guards, anchor 409 codes, request shapes and explicit
Stop Save behavior remain. PATCH also renews subject erasure/profile state and
the selected assignee under the household lock, and passes the locked current
cadence/root/weekdays to canonical frequency editing rather than the pre-wait
snapshot. A stop requested as a plain chore now applies to a series created while
it waited, preserving completed history and removing untouched future copies.
Authored cases cover revoked DELETE/stop requests, changed assignee/subject state
and the concurrent-anchor stop. Disposable Postgres cases use real held locks.
Route fixtures supply full actor state and initialize their own lookups. All
cases and wider QA remain unrun.
No tests, types, lint, build, browser/native/schema operations, CI, push, merge,
deployment or activation occurred. Rollout/release protections unchanged.

## Exact personal import-provenance erasure source — 2026-10-20

Account deletion now discovers household locks from the personal import-target
rows it will remove, including historical households after membership detachment.
Inside those locks it re-reads the targets before personal deletion/cascades and
removes provenance by exact household + target model + target record ID. A newly
discovered unlocked scope refuses the transaction before any provenance deletion.
Each delete predicate has at most 200 target pairs. Shared imported content and
its mappings remain; colliding IDs in different models or household scopes are
not treated as the same target. This preserves the established personal-target
provenance removal policy; it adds no tombstones or new importer replay behavior.

The old current-household bare-ID cleanup was removed. Both account paths share
the exact cleanup before their personal rows disappear. Authored cases cover
sorted historical scope discovery, exact pairs, empty targets, new-scope refusal,
bounded long histories and model/household collisions in current/former-member
fake and disposable-Postgres paths. All are unrun. No tests, types, lint, build,
browser/native/schema operations, CI, push, merge or deployment occurred. Gates
unchanged. Full non-FK erasure reconciliation and other issue requirements remain
open; this is not comprehensive erasure acceptance.

## Routine draft repair and dashboard-link navigation source — 2026-10-20

Both future-routine managers now capture ordinary same-window dashboard links,
including sidebar links outside the editor subtree, while a draft/editor or
write is active. The manager first flushes its owned local draft, then awaits
release of its own Back sentinel, and pushes the destination only while the
same visible controller epoch remains current. Busy, unauthorized, failed-storage
and changed-epoch attempts stay put. Dirty drafts retain Back ownership even
when a storage error temporarily removes authority. Modified clicks, downloads,
other windows, same-page fragments and destinations outside the dashboard keep
their normal behavior. Programmatic navigation and non-link account controls
still require the later full navigation/lifecycle reconciliation.

Stacked-routine storage repair now updates the durable draft reference before
checking visibility, matching independent routines: a backgrounded successful
repair cannot let the next foreground load overwrite it with the old draft.
Both repair handlers avoid starting another load after their epoch expires.
Authored link-capture cases cover outside-sidebar links, duplicate clicks during
preparation, failed preparation/retry, browser-link semantics, current protection
state and unmount cleanup. These cases and all broader QA remain unrun. Only
source inspection, edits and formatting occurred; no tests, types, lint, build,
browser/native/schema operations, CI or release actions. Rollout gates unchanged.

## Historical message/audit erasure source — 2026-10-20

The photo retention contract was traced before editing: household Upload files
remain and the existing SET NULL uploader FK removes account attribution. These
uploads are not private sent-message files and are not erased as apparent orphans.
The no-current-household path previously skipped sent-message file collection and
explicit historical non-FK audit/read identifiers. Both account paths now collect
validated private message-attachment targets before deleting messages and remove
those files only after the account transaction commits, using the existing
best-effort file result and path validation. Other attachment/upload files remain.

Erasure household discovery now includes exact sent/read message and audit actor/
member-target references alongside profile/routine roots, under the account lock
before stable household locking. Shared cleanup scrubs copied member-target text
and IDs, clears this audit actor and removes only this account from message
read_by arrays in those locked households. Other member targets/text/reader order
are retained. Historical households receive no extra departure event. Existing
FK actor/uploader anonymization and ordinary personal-row deletion still apply.

Authored source cases cover scoped lock discovery, exact redaction, former-member
file cleanup, another household/history member retained, no false departure, real
message attachment cascade, household upload retention/uploader clearing, reader
cleanup and file callbacks observing the deleted account after commit. Protected
routine-deletion cases cover both current and historical membership. All remain
unrun. No tests/typecheck/lint/build/browser/native/schema/client operations, CI or
release actions occurred; gates unchanged. Historical import provenance and other
non-FK subject fields still need full-ledger reconciliation; no broad erasure
acceptance is claimed. Next source work: remaining link/rollout and navigation/
async boundaries, then finish the full issue ledger before consolidated QA.

## Profile-review invalidation and historical-root handover source — 2026-10-20

Unlinked profile edit/archive commands now invalidate exact referenced routine
root revisions and stack version/fingerprint inside the same locked transaction.
Subject identity, schedule, content and state are retained. Replayed profile
receipts return before invalidation, so the same command does not advance versions
twice. Account membership removal also invalidates exact future user/member
aliases even when the account has no canonical profile. Unknown definitions stay
unsupported rather than being adopted. Stale uncommitted routine controls/edits
must refresh; already committed original receipts remain read-only evidence.

Historical household discovery now includes a personal control root's raw account
owner as well as private future subject aliases. This closes the case where that
root has already been reassigned in future metadata and the account later has no
current household. Account deletion retains those historical future plans on
anonymous replacement controls under the previously acquired household locks,
selects an existing household successor and updates exact surviving lineage/stack
slots. Normal creator handover applies to retained routine occurrences that would
otherwise cascade with the deleted creator. Expansion occurs after the account's
personal cascade, renewing actual subjects/gates and avoiding occupied deleted
slots. Current-household handover remains separate and is not duplicated.

Source inspection confirms routine owner/effect authority still renews the actual
User role/token/family. A profile role is presentation only; no account role API,
login authority, parent elevation or automatic role grant was added. Verified
account link retains its existing proof and revision boundary.

Authored pure/protected cases cover exact invalidation without reassignment,
profile role/age edit, archive freshness, no second replay invalidation, cleanup
pause versus invalid archived resume, and current/historical account deletion
with retained occurrence IDs/evidence/stack order. All remain unrun. No tests/
typecheck/lint/build/browser/native/schema/client operations, CI or release action.
Next: reconcile historical ancillary erasure cleanup and link/rollout edges, then
remaining navigation/async source work and full-ledger code before consolidated
QA. These are unverified source changes; no acceptance or completion is claimed.

## Archived-profile retained-history projection source — 2026-10-20

Compatible profile readers now retain the display identity of an archived,
unlinked profile belonging to the same household. Archive alone no longer makes
that legitimate history unreadable and refuses the whole chores collection.
Linked aliases, foreign subjects, erasure/provenance holds and invalid identity/
role/age still refuse; no account identity or assignment fallback is manufactured.
List/detail and page projections include an explicit PROFILE_ARCHIVED action hold
with complete/undo/verify/reject all false. The detail projection now uses its
hydrated current profile, matching collection/page behavior. Archive takes
precedence over once-only/recurrence capability exemptions.

Read-only subject display is explicitly separate from action authority. Parent
verify/reject subject helpers now check active archive state independently; the
existing device/profile complete/reopen guards already renew active identity.
The server still refuses archived mutation. EN/ES copy on chores, routine/series
summaries and fridge state explains archive rather than a compatibility refresh.
Mixed groups prefer the archive reason when present. Today continues to exclude
archived profiles from active participant cards.

Authored source cases cover exact archived history, withheld actions, foreign/
linked/erased refusal, compatible collection+detail with an active account row,
verify authority separation and both-language verification UI. All are unrun.
No tests/typecheck/lint/build/browser/native/schema/client operations, CI or
release actions ran; existing profile protocol and rollout gates remain intact.
Next: profile role/version and link/rollout reconciliation, remaining navigation/
async source work and the rest of the full issue ledger before consolidated QA.
This is not rendered acceptance or issue completion.

## Write-paused once-only handover recovery source — 2026-10-20

Anonymous handover controls now record a private once_pending checkpoint only for
one-time future work retained during account deletion. Existing/ordinary deleted
once rows never opt into this recovery. A separate bounded foreground pass (100
explicit roots, independent of the repeating-template budget) discovers active
handover checkpoints under the household lock and delegates to canonical
expansion. It checks rollout and current family chores availability, exact current
subject presence and then renews full root/stack/subject authority in the effect.
No scheduler or offline/background client replay was introduced.

Canonical expansion now also holds when the household chores feature is off.
It settles a once checkpoint after its task is created, already occupied (including
completed/evidence rows), or missed; missed days never become catch-up. Settlement
changes only the operational checkpoint, preserving authored content/revision.
Rollout pause and unavailable subjects retain the pending intent for later review.
After settlement, later deliberate occurrence deletion is not recreated by this
pass. Unknown, paused/stopped, ordinary once, tombstoned or ineligible definitions
cannot enter fresh handover recovery.

Authored focused and protected DB source cases cover gate/family holds, bounded
exact selection, unsupported/ordinary exclusion, occupied/missed settlement,
write-paused account deletion, later recovery and non-resurrection after deliberate
deletion. All remain unrun. No tests/typecheck/lint/build/browser/native/schema/
client operations, CI or release actions ran; gates unchanged.
Next: archived-profile ordinary read/action state (current unreadable subjects can
refuse a whole chore collection), profile-role/version reconciliation, rollback
and remaining navigation/async work; then the rest of the issue-code ledger and
consolidated QA. This is source progress, not issue completion or acceptance.

## Account-deletion routine control handover source — 2026-10-20

Account deletion now retains scheduled future definitions on replacement anonymous
control roots before its normal personal-chore deletion. Surviving occurrences
keep their IDs, subjects, status, evidence and credit; only their recurrence
control lineage changes. Exact stack root slots keep their authored order and
advance version/fingerprint. The old personal root and personal assignments still
follow the existing erasure policy. This does not reassign work to the successor:
the control has no assignee, evidence/completion or points, and carries the private
previously reviewed future definition. Normal creator/actor erasure rules remain.

The control date precedes all retained occurrence slots. Retired anonymous
controls are hidden before ordinary paging and cannot occupy a real scheduled
day; canonical expansion renews the actual future subject and fills upcoming
slots inside the transaction when rollout gates permit, including one-time work. Tombstoned subjects
remain unavailable, and unknown protocols retain their unsupported payload rather
than being adopted. Prior old-root requests hold or report original removed proof;
they cannot recreate an erased personal row. Independent definitions retain their
null stack identity, while exact attached config references move to the new root.

Authored pure and guarded deletion source cases cover exact identity/order and
unknown-payload preservation, pre-migration inactivity, anonymous-control hiding,
personal root deletion, unchanged surviving evidence/occurrences, stale/late
requests and continued upcoming-day expansion. All are unrun. Account-deletion
product documentation and issue ledger now record the control/history boundary.
No tests/typecheck/lint/build/browser/native/schema/client operations, CI, release
or activation occurred. Next: profile archive/role/link rollback (including deferred once-only expansion after a
write-paused deletion) and remaining
navigation/async reconciliation, then the rest of the full issue-code ledger and
consolidated QA. End-to-end deletion and device acceptance remain unproven.

## Routine identity-link and erasure integration source — 2026-10-20

Verified same-person profile/account linking now rewrites matching supported
future definition subjects in the existing transaction, preserving occurrence
snapshots and credit. Exact profile/account IDs establish that link, never names.
Changed roots advance their revision and affected stacks advance version and
fingerprint, invalidating stale prepared edits without changing schedules/state.
Unknown future protocols are not adopted or linked.

Account erasure now discovers and locks historical households containing
account-only future aliases as well as profile provenance households. It redacts
the known private subject slot by exact user/member IDs before profile deletion,
including accounts with no canonical profile. This does not depend on rollout
flags. A storage probe is inert before the additive column exists; partial stack
storage cannot prevent root redaction. Unknown protocols retain their unsupported
state while the known identifying slot is cleared. Normal erased history and
existing deletion policy remain separate from these private future definitions.

Stored erased-subject tombstones have no identifying IDs and are never accepted
as new command assignments. Private parent state projects them as unavailable
(null) subjects so explicit replacement is required. Expansion holds tombstoned
future work. An erased historic root is not itself a new future subject: only a
separately reviewed current definition with freshly renewed valid assignee can
create new copies; the historical erased marker is not relinked. Pause/stop remain
possible without an eligible subject; resume/edit need valid fresh assignments.

Authored pure/source and guarded DB cases cover exact link/erase, unknown protocol
redaction, pre-migration/partial storage, scoped writes, revision/version holds,
read omission, write-paused erasure, preserved root history and explicit future
assignment. All remain unrun; no QA/build/schema/client/native/CI/release action.
Next: account-deletion root handover where a historical root is removed but its
future definition has already been assigned to someone else; profile/archive and
rollback/navigation reconciliation still remain. This is not issue completion.

## Independent-step manager/editor and durable draft source — 2026-10-20

Independent-step management is now source-wired through a private parent page,
bounded catalog/paging, fresh-definition editor, edit/pause/resume/stop review,
original-request details and explicit recovery controls. Routine plans links to
this view. Exact detached legacy root links hand off to the independent route;
ordinary copies and foreign roots stay outside that handoff. The EN/ES editor
uses a compact main step/schedule form with collapsed advanced options and a
review stage. It supports selected weekly days, monthly anchors, start date,
exact account/profile choices, cue, instructions, minutes, effort, picture and
conditional points. Current ineligible repeat profiles remain unavailable.

Independent local drafts now have a strict separate partial-field contract and
derived person owner location, plus context/read/store/browser wiring. The shared
owned local-document implementation was extracted from routine drafts: exact CAS,
explicit competing-version adoption, uncertain-transition repair, generation
invalidations after discard, current capability sanitation and no send transport
apply to both adapters. Empty/incomplete content can remain on-device without
becoming a valid command. The manager debounces verified saves, flushes on close/
submit, restores without rebasing revisions and uses owned Back close handling.
Visibility/owner epochs hold private rendering; adopted/repaired draft refs retain
the accepted document even when the view becomes hidden before it can render.

Confirmation now clears a draft only when it matches that original command;
confirming an older or unrelated request cannot erase newer unsent work. This
preservation rule also applies to the stack manager. Explicit discard/dismiss
still requires its existing confirmation. Authored source cases cover partial
independent reload, competing edits, discard, hidden points, exact originating
command matching, both editor languages and detached/foreign root handoffs.
All remain unrun. Source inspection and formatting only: no tests/typecheck/lint/
build/browser/native/schema/client operations, CI, release or activation.

Next: reconcile lifecycle/erasure/reassignment and rollback behavior across these
new independent definitions, finish outstanding navigation/async presentation
edges, then continue the full issue ledger before consolidated QA. The new source
is not rendered, device-accepted or released; all rollout gates remain unchanged.

## Independent routes and owned request recovery source — 2026-10-20

Independent future steps now have private catalog/state/save and recovery-context/
review routes. Shared admission derives an independent hashed person owner scope,
retaining household/generation retirement metadata while separating physical
journals from stack requests. Parent/token/feature authority still renews under
locks at read/effect; routes preserve rate limits, body bounds, required owner/key
headers and private no-store responses. No gate or environment was activated.

A strict independent recovery contract binds the original body/key to its exact
root/action/next revision proof. Read-only server review checks original actor,
key/action/hash, ownership, revision/state, expiry and viewer-day constraints.
Committed receipts remain confirmable after expiry and write pause; absent roots
return removed evidence, never recreation. Review reserves no key and performs
no canonical effect. Browser adapters use the existing envelope/candidate/lease/
retirement implementation, require review after reload, and retain unknown
outcomes. Foreground client requests validate identity, owner scope, exact echoed
bytes and matching proof; timeout/parse/network failures cannot confirm a save.
Stack requests now share the same extracted bounded HTTP utility with unchanged
request semantics.

Authored storage/client cases cover separated namespaces, exact reload/review,
changed intent/owner, paused inspection/dismissal, malformed/oversized bodies and
wrong-revision success. Guarded DB source adds late read-only confirmation and
expired no-reservation review. All remain unrun. Independent editor/catalog UI,
unsent draft retention and legacy root handoff are still next; lifecycle/rollback/
device reconciliation and consolidated QA remain open. No tests/typecheck/lint/
build/browser/native/schema/client operations, CI or release actions ran.

## Independent future-step coordinator source — 2026-10-20

Explicitly unstacked canonical roots now have a separate strict command/read/
receipt contract and unrouted parent coordinator for future edit, pause, resume
and stop. The definition carries a bounded optimistic revision (old staged JSON
defaults to one); stack writes/removals also advance it so stale independent
forms cannot overwrite a newer definition. No database/client operation is needed
for this JSON contract addition. Older strict code may hold new metadata, which
is safe rollback behavior to prove later, not a compatibility claim.

The independent boundary renews actor/token/household/features under existing
locks, scopes roots to the current family, refuses attached/erased/unknown roots,
and binds actor/key/action/hash/revision to an atomic effect and receipt. Late
same-key proof remains confirmation while fresh writes are paused; a removed
root cannot be recreated. First effects retain the original viewer day/timezone
and expiry. Edit/resume renew subject eligibility, while pause/stop need no new
assignee. Hidden points preserve canonical values. Only row-locked, untouched,
future detached copies can be pruned; roots, today, attached evidence, started
work and history retain their original snapshots. Resume skips missed days and
passed once schedules. Active changes top up using the canonical expander.

Private state and bounded catalog reads expose exact independent root identities,
current definition/revision and no disabled points. Source-only pure and guarded
DB cases cover strict scopes, optimistic conflicts, paused/stopped transitions,
expiry/midnight/once holds, detached partitions, same-key concurrency/replay,
evidence/root preservation, foreign household reads and hidden-points edits.
They are unrun. No route, browser journal, form, legacy handoff or release is wired
for this independent protocol yet. Those integrations are the next code work,
followed by lifecycle/rollback/device reconciliation and consolidated QA. Existing
gates are unchanged; no QA/build/schema/client/native/CI or release actions ran.

## Routine sheet navigation and original request review source — 2026-10-20

Routine sheets now opt into the existing owned navigation sentinel while open.
Browser Back invokes the same verified local save-and-close path as the close
button, retaining the draft and returning to the manager catalog. A clean sheet
can own Back without warning on document unload; dirty/sending work retains the
warning. Existing pending-form callers keep their default behavior. Both early
Navigation API and fallback popstate use the opt-in callback; controller-owned
restoration/consumption traversals do not invoke it. New source-only cases cover
clean unload, Back interception and restoration without duplicate close.

Saved requests now offer collapsed original-intent details in EN/ES: original
ordered step content, schedule, cue, review time/zone, effective-day scope and
removed-step dispositions. Assignment display uses only currently eligible exact
identities; unavailable targets do not acquire a substitute or expose raw IDs.
Current disabled points remain hidden. The view has no mutation controls and
never rebuilds the immutable request from the current catalog. Authored UI source
covers both languages, hidden points, unavailable targets and unchanged bodies.
Adoption/dismissal async callbacks also hold stale epoch results before rendering.

No tests, browser QA, builds, typecheck, schema/client operations, CI, native
validation or release actions ran. Detached future controls and full lifecycle,
rollback and device reconciliation remain required before consolidated QA.

## Scheduled-once profile action projection source — 2026-10-20

A private household-scoped read now reduces canonical routine metadata to the
selected one-time occurrence IDs. The chores API (list and detail), chores page
and Today board use that policy when projecting email-free profile actions.
A recurrence ID alone no longer pauses a valid scheduled-once step when profile
recurrence is disabled. Repeating and legacy series keep the existing gate;
unknown/inactive metadata cannot manufacture the one-time exemption. Raw future
metadata stays out of ordinary response DTOs. Mutation authority still renews
under the existing locked policy at the effect.

Authored, unrun source cases cover no-query empty selection, household/ID SQL
binding, duplicate IDs, selected roots and completed copies, inactive/unknown/
weekly exclusion and profile versus account projection. No QA or activation.
Next: detached-series future controls, clean-sheet Back choreography, recovery
presentation/async-epoch audit and lifecycle/rollback/device reconciliation.

## Durable routine draft and attached legacy handoff source — 2026-10-20

Unsent routine forms now have a separate strict local-draft contract, server-derived
person owner scope and browser store using the existing owned envelope, locations,
leases and retirement format. Partial fields remain editable locally; the real
command is still validated separately only for submission. Local draft entries
cannot enter a send callback. The shared journal has an explicit opt-in local-only
compare-and-replace operation; ordinary request bodies remain immutable.

The manager creates/restores that document, debounces verified saves, flushes on
sheet close and before submission, and clears it only after confirmed completion
or explicit local dismissal. It shows pending versus device-saved state and guards
navigation while local/request writes are pending. Discard invalidates queued
older autosaves. Re-read conflicts do not overwrite another tab's changed or
cleared draft: explicit load-saved confirmation is required. Known uncertain
storage transitions retain their proposal for explicit repair. Current disabled
points are stripped before a restored draft can reach the UI. No draft payload is
posted to a server mutation route; the new GET context mode contains identity,
ownership and capability metadata only.

Owned attached routine URLs now offer a localized handoff before the old one-day
editor loads, on direct and intercepted stack/root edit pages. The old stack GET
renews parent authority under locks and refuses scheduled metadata; its client
fallback offers the new route instead of repeated failed legacy saves. Handoff
uses exact household-owned IDs, leaves ordinary individual copies/legacy stacks
alone and exits the old intercepted slot with full navigation. Detached-root
management remains the next separate code gap.

Authored/unrun storage cases cover incomplete reload, cross-controller conflict,
explicit adoption, stale queued autosaves after discard, uncertain write repair,
changed owner, disabled-points purge and local-only send refusal. Protected DB
source covers attached/foreign/same-name-legacy/copy handoffs. Source inspection
and formatting only; no tests/typecheck/lint/build/browser/native, schema/client
operation, hosted CI, push/merge/deploy or activation. Existing gates are unchanged.
Next: detached-series future controls, clean-sheet Back choreography, recovery
presentation/remaining async-epoch audit; then
lifecycle/rollback/device reconciliation and the consolidated QA phase.

## Parent routine catalog/editor/recovery UI source — 2026-10-20

Parent-only bounded catalog/state DTOs and GET catalog paging now provide saved
routine summaries, explicit unsupported-protocol rows and eligible canonical
account/profile choices. Current family/token/role/features renew under locks;
member identity conflicts are skipped, not guessed from names. Profile choices
carry their current repeat capability. The new /dashboard/chores/schedules view
and a parent Routines-view entry are gated by existing rollback-ready support;
all gates remain unchanged/default-off and no deployed app is changed.

The manager and reusable rounded form Dialog source now show a catalog, frozen
control confirmations and explicit saved-request inspect/retry/dismiss actions.
The form has Routine / Steps / Review stages, one focused step, bounded step
navigation, independent owner/duration, optional details/picture/effort/points,
weekday/monthly/start choices and accessible move controls. Removing a persisted
step requires keep-independent versus stop-future scope and can be restored
locally. Review shows owners, cadence/first matching day and removed-step scope;
its clock/zone freeze before submission rather than rebase at a later click.
Paused edits stay paused; expired once routines do not offer resume.

Submission stages the exact owned request before sending; saved/unknown work
holds new edits until explicit recovery/dismissal. Visibility/owner/async epochs
hold private rendering and suppress stale replies. Pending navigation protection
covers writes. Closing retains unsent form state only while this page remains
mounted, with a beforeunload warning: durable unsent drafts, SPA/native Back,
legacy editor-link handoff and detached-series controls still need code.

A source audit found future parent reads exposed points with gamification off.
They now omit that field server-side, enforce it in the read codec and expose only
a capability boolean. Null point intent preserves existing hidden points (new
steps use zero); disabled points edits cannot overwrite stored values. This also
avoids clobbering points when the setting changes between reading and saving.
Focused form model/identity/removal/frozen-day tests and protected DB source for
catalog role scope/points omission/preservation were authored, unrun.

Formatting and source inspection only. No tests/typecheck/lint/build/rendered/
browser/native, schema/client operation, push/merge/deploy or activation. Remaining
#450 source work: durable unsent draft ownership/recovery, old-link/detached-series
management and scheduled-once action presentation; then full EN/ES, lifecycle,
rollback and device reconciliation and the later consolidated QA phase.

## Routine original-request recovery and gated HTTP source — 2026-10-20

Routine changes now have a strict owned recovery contract, fixed original
body/key client, bounded network/decode deadline and explicit inspect/send/dismiss
journal adapter. Existing inventory storage transitions were extracted into
owned-request-journal.ts and inventory retains its domain contract/error adapter.
Both domains now renew owner/storage after a delayed send before exposing its
result. Divergent or uncertain storage, changed owners and recovered requests
remain held; no background replay or silent new key/body/date is introduced.
Bounded JSON decoding was extracted with the inventory export preserved.

The routine coordinator now exposes a transaction-local throwing effect. The new
API boundary reserves/checks the key, applies canonical changes and stores proof
inside one transaction, translating refusals only after rollback. It never deletes
an old schedule proof to reuse its key. Late retained proof can confirm while
fresh writes are paused; lost/pruned proof with an expired original intent cannot
create again. Private read-only inspection binds owner scope and exact saved
request, checks current authority/version/day/state and distinguishes ready,
pending, committed, removed, expired, conflict and paused outcomes.

New source routes /api/chores/routines and /api/chores/routines/recovery are parent
person-only, rate/body bounded, private/no-store and reject supplied stale owner
proof. Mutation/review require the routine-specific session/household owner scope;
the canonical runtime renews role/family/token/features under locks. Existing
middleware CSRF remains in force. Default-off schedule/rollback and owned-recovery
gates remain unchanged; this is gated HTTP source, not activation or deployment.

Focused recovery unit and protected PostgreSQL source assert original bytes,
review holds, unknown results, late owner switch, atomic same-key saves, changed
hash, paused late confirmation and expired unconfirmed rollback. All unrun.
Formatting/source inspection only; no QA/typecheck/lint/build/browser/native,
schema/client action, push/merge/deploy or provider/real-data mutation. Next:
parent catalog/editor and recovery presentation, unsent form draft handling,
scheduled-once availability, EN/ES and lifecycle/rollback source audit. Full #450
scope and later consolidated QA remain open.

## Routine occurrence guards source — 2026-10-20

New private occurrence policy joins each canonical chore to its same-household
root. Paused/stopped untouched occurrences on/after the reviewed effective day
are hidden before ordinary chores/API/Today/summary paging and profile-compatibility
probes. Started work, photos, notes (including empty notes), completion/history and
prior-day work remain visible. Unknown metadata holds open work. Only hidden IDs
leave this private read helper; future definitions/evidence do not enter the DTO.

Account/device completion rechecks the policy under the household lock and returns
409 CHORE_ROUTINE_INACTIVE for stale taps. Profile completion recognizes a known
scheduled occurrence's saved member instead of requiring the old root owner to
match; canonical current profile identity and existing gates remain required.
Known scheduled-once profile work uses base gates consistently in expansion,
completion, undo and parent subject verification. Its existing per-row availability
presentation still needs the source audit before activation.

A private default-false anchor_retired definition field keeps a pristine root
hidden after its paused date passes and the parent later resumes/un-stacks it.
Actual generated copies and history are unaffected. Expired once routines cannot
resume into a new catch-up task. Legacy occurrence-stack edits/adoption now refuse
scheduled stack/root/copy metadata after matching receipt replay and before new
writes. Ordinary edit/delete paths also refuse inactive copies under their locks.

Focused policy/legacy unit source and guarded PostgreSQL pause/resume/stale-tap
source are authored, unrun; existing narrow fakes reflect new reads. Formatting
and source inspection only. No tests/typecheck/lint/build/browser/native,
schema/client operation, push/merge/deploy or activation. Gates remain off and
the new parent coordinator unrouted. Next: owned original-body retry recovery,
bounded routes and parent controls, then remaining per-row capability/EN/ES/
lifecycle/rollback source audit and consolidated QA.

## Routine recurrence adapter source — 2026-10-20

The canonical expander now consumes known private routine definitions before
legacy frequency handling. Attached stacks renew household-scoped stack schedule,
state, cue and authored step membership/order; detached roots continue from their
own saved definition. Existing account/member authority and a shared profile
eligibility helper renew future owners without creating login accounts. Unknown,
paused/stopped, erased and rollout-paused definitions hold. Both private gates
remain off and the coordinator remains unrouted.

Future copies snapshot reviewed content, current canonical subject, cue, duration,
label and order. Existing dates/history are left intact; off-schedule evidence
does not hide eligible dates. Pure bounded windows reuse canonical UTC date-only
arithmetic: seven daily slots, four weeks of selected weekdays or three monthly
slots, with month-end anchor retention and no missed-day catch-up. One-off work
uses its fixed reviewed effective/start day and cannot move forward on each read.
The parent coordinator now tops up active roots inside the same transaction as
its keyed receipt, so expansion failure rolls back the request.

Unit source for windows/authority/stack coherence/detached snapshots/holds is
authored; guarded integration source now accounts for canonical generated copies
when checking conservative pause pruning. Nothing was executed beyond formatting
and source inspection. Inactive-root visibility/completion and legacy stack-editor
guards, owned recovery, routes and parent controls remain next. No QA/typecheck/
lint/build/browser/native, schema/client operation, push/merge/deploy or activation.

## Private routine coordinator source — 2026-10-20

Ordinary chore JSON routes and server page strip private future definitions;
board/device/profile creation paths use explicit DTO/selects. Canonical legacy
root/series edits and root deletes refuse scheduled/unknown metadata under the
household lock. Ordinary PATCH now renews ownership for all edits, removing the
unlocked fast path. Existing fixture sources reflect the transaction/read shape.

New unrouted parent coordinator/read source supports canonical initial-root
creation, future-definition replacement, explicit removal and pause/resume/stop
state with original keyed atomic receipt, version, role/household/token/feature,
current account/profile authority, row-locked history/evidence preservation and
ordered snapshots. First effects bind validated viewer zone/day and fifteen-minute
intent age; matching receipt replay does not execute a new day or recreate deleted
records. Fresh writing and rollback-ready support gates are off; no endpoint or
public/offline capability exposes this source.

Canonical recurrence now holds non-null definitions rather than run old cadence.
Metadata-aware expansion, inactive-anchor visibility/completion guards, owned
request recovery and actual parent routes/editor still must be implemented.
This is not usable scheduled-routine/pause UI. New source tests/guarded DB suite
are authored and later workflow-wired, unrun. No typecheck/lint/build/browser/
native QA, schema/client operation, production/real-data/provider action, push,
merge/deploy or activation. `plans/routine-schedule-v1.md` records full limits.

## Weekly start and durable routine foundation — 2026-10-20

Original #449/#452/#451 criteria were re-read against forms, canonical recurrence,
template serialization and grouped rendering. Optional weekly start was a real
UI gap: EN/ES collapsed Start later now picks the first selected weekday on/after
that date for account, rotation and gated profile payloads. Weekly due dates stay
internal; default uses viewer-local today, same-day min remains hydration-safe.
Mounted future-start test source is authored/unrun.

#450's transferred #559 scope is not finished: current stack coordinator handles
one occurrence only. New strict future schedule/step/subject/control/removal
contracts and conservative history partition are authored in routine-schedule.ts.
Existing UTC recurrence dates are extracted/re-exported without a second cadence
engine. Nullable stack/root future-definition and per-occurrence cue/duration
schema/migration source is added, ungenerated/unapplied and never written by a
new runtime route. Parent export now includes durable definitions; non-parent
export omits root future-control JSON. Source tests are authored, not run.

Next code: private ordinary read projections, canonical parent coordinator and
expander/legacy-write guards, then owned request recovery/gated route/editor.
Completed/current/evidence rows and account/profile authority must survive.
This foundation is not exposed pause/resume/future editing. No QA/typecheck/lint/
build/browser/native, client generation/schema action, push/merge/deploy or
activation. `plans/routine-schedule-v1.md` records the full remaining contract.

## Open-issue directory refresh — 2026-10-20

Read-only GitHub list currently returns 82 open issues. Every current issue is
represented in `engineering/ISSUE_COMPLETION_LEDGER.md`, with no ledger-only
open-issue rows; directory parity does not establish implementation/acceptance.
This continuation added finance planning, measurement interpretation, omitted
DB-suite wiring and calendar source/acceptance mapping. Remaining leaf rows with
"acceptance reconciliation pending" still require original-criteria/source
review. Next bounded implementation pass: weekly/same-day/recurring chore and
routine leaf criteria (#449/#452/#451/#450), preserving their existing source.
All QA remains deferred; no push, merge or deployment.

## Calendar interoperability source map — 2026-10-20

#124 now maps all required contracts/acceptance cases to existing ICS and gated
Google/Microsoft sync source, fixture files and current source/status UI.
Recurrence/DST, external identity/duplicates, conflicts/tombstones, reconnect,
authority, disable/rollback and mobile/offline limits are explicit. Apple is
ICS-link interoperability; no Apple OAuth/CalDAV/native calendar-store bridge is
claimed. No provider/account/sync/QA/activation occurred. Original household
discovery, OAuth application setup and actual provider/device acceptance remain
separate dependencies. `product/CALENDAR_INTEROPERABILITY.md`.

## Required database-suite wiring source — 2026-10-20

#85 reconciliation found 21 existing opt-in integration suites absent from the
explicit hosted DB commands. Eighteen now join the normal required Build & Test
step; three schema-mutating backfill/catalog suites receive separate disposable
service databases, canonical migrations, post-suite drift checks and cleanup.
No new test cases were added and no job/test/migration/QA was executed. Current
GitHub read identifies default main with strict required Build & Test/admin
enforcement, conversation resolution, force/deletion off; no policy was changed.
Exact integrated-head local/hosted/native/image acceptance remains deferred.
`engineering/RELEASE_VALIDATION_RECONCILIATION.md`.

## Private measurement source and scorecard scope — 2026-10-20

#140 now maps every requested metric/funnel to current opt-in daily counts or an
explicit uncollected/unknown denominator. Existing D-6 counting rules stay intact;
scorecard JSON/text adds a versioned scope declaring best-effort aggregate count
thresholds, no verified ordering/independent cohort and acceptance not evaluated.
Weekly copy no longer says aggregate counts prove an ordered linked-record loop.
Source test assertions are authored, not run. No new collection/schema/provider,
experiment, consent/production setting, QA, push, merge or deployment.
`product/PRODUCT_MEASUREMENT.md` records event owners/replay limits, future
metric design, research/experiment rules and separate activation dependencies.

## Preserved-finance product plan source — 2026-10-20

#566 now has a current source inventory and FIN-0 through FIN-7 delivery design
for archive review/money bridge, accounts, bills/payments, savings contributions,
planned income, receipts, daily periods and no-spend views. The plan distinguishes
existing parent budget APIs/native import mappings from all 11 passthrough JSON
archive source keys. Exact currency/date interpretation, Float/USD/UTC bridging,
reviewed adaptive surfaces, duplicate-safe promotion, provenance, export/erasure
and non-destructive rollback are explicit. No advanced native finance schema/API
was added; original archives remain preserved. Planning scope is authored, future
product slices are planned, not implemented/accepted. No QA, provider, migration,
real-data access, push, merge or deploy. `plans/finance-archive-product.md`.

## Notification snooze source mapping — 2026-10-20

Original #463 criteria now map to existing canonical route, inbox, additive
schema/migration source and authored route/mounted/paired-denial coverage. No
duplicate feature was added. All four delays, personal atomic target, Snoozed
return-time/Show now and unread expiry return are present in source. Existing
50-row read cap is documented. No tests or migration ran; multi-device and final
acceptance remain pending. `product/NOTIFICATION_SNOOZE.md` and completion ledger.


## Recipe/prep stock-lot review source — 2026-10-20

Saved recipe cooking and bulk-prep dishes now link to a compact Inventory review.
A private current-authority reader returns bounded ingredient guidance from the
live recipe, or the immutable captured recipe for a prepared dish. Prepared
history gaps refuse substitution. Original actor/household/source are checked;
new clients require the inventory read-scope echo before reading private JSON.

EN/ES expandable ingredients show scaled recipe guidance alongside separate
matching stock lots, their own units, locations and labelled dates. Matching is
presence-only: linked IDs or unlinked normalized names, no quantity sufficiency
or conversion. Finished/zero/expired/unversioned lots are excluded. Twenty lots
per line are shown with a cap notice. Selection opens the existing canonical
amount-used editor; each lot keeps existing versioned consume, exact retry,
owned recovery and Undo. The review reopens/refetches after that editor closes.
It does not mark a recipe/prep session consumed, auto-deduct ingredients, or
create an atomic multi-lot ledger. Prep readiness and portions eaten remain
separate records. Read scope loss hides the sheet; stale/refresh/recovery blocks
new selection. No new schema, public capability or offline action.

Authored source tests cover matching boundaries, current vs captured recipe,
missing history/authority, scope-before-body and explicit lot handoff. None ran.
No QA/typecheck/lint/build/browser/native, provider/schema/account action, push,
merge or deployment. #125/#460 source handoff is implemented; consolidated
acceptance and external provider/hardware decisions remain open. Next: reconcile
remaining implementation gaps against the issue completion ledger.

## Inventory restock UI and saved-request source — 2026-10-20

Item editing and consume/discard history now open the rounded replacement sheet.
It preserves unsaved stock fields, requires a named list and independent purchase
amount, reviews possible duplicates, refuses indistinguishable list choices and
keeps exact body/key through unknown adds. Current list/source/version review is
scope-bound; draft names travel in a private POST body rather than URL queries.
Confirmed results distinguish created/already-open/original-removed and offer
list links plus the existing owned ten-minute Undo rule.

The adopted inventory journal/sender/recovered review now includes restock adds.
Recovered review binds the original list, purchase values and matching receipt;
it cannot pick a new default or recreate a removed list row. Source tests cover
same-request retry, target binding, hidden scope, explicit duplicate choice and
canonical restock recovery; none ran. Undo response uncertainty is kept in the
open sheet with same-request retry and explicit close-without-confirmation;
it is not a new durable/offline Undo queue or native acceptance claim.

No QA/typecheck/lint/build/browser/native, schema/provider/account action, push,
merge or deployment. Activation flags stay off. Remaining #125 code work:
integrated recipe/prep stock-lot/quantity review. Later consolidated acceptance
still includes two households, roles, storage/rollback, nested focus/Back and
physical lifecycle. `architecture/INVENTORY_RESTOCK.md`.

## Inventory replacement restock backend source — 2026-10-20

Added private reviewed inventory-to-grocery APIs and a canonical transaction
effect. Explicit list/content/purchase amount/unit are independent of stock and
package size. Existing open replacement provenance skips concurrent duplicate
requests; similar manual/recipe rows need explicit separate-row review. Item and
receipt commit atomically. Matching receipt/current ownership confirms historical
success without recreating a removed list row. Current parent/teen inventory and
lists authority, source versions and intent age remain enforced.

Owned ten-minute Undo reuses the existing grocery provenance/window rule; checked
rows remain. No new schema/source enum, stock store or automatic purchase. Existing
recipe Undo remains a compatibility wrapper. Test source covers concurrency,
quantity/provenance, duplicate/foreign review, version/age and checked-row Undo;
none was run. **Not UI/recovery integrated yet.** Next: extend existing owned
request/review/sender and wire inventory/history replacement UI, then cooking
stock review. No QA/typecheck/lint/build/browser/native, schema/provider operation,
push, merge or deployment. `architecture/INVENTORY_RESTOCK.md`.

## Shared reviewed meal-description source — 2026-10-20

Unlinked Add meal now offers the same collapsed typed/voice review as Add food.
Shared ReviewedDescriptionDraft owns foreground browser/native-preview controls,
20-second deadline, disclosure, stale-text protection and explicit Apply. Food
retains its existing parser/fields. A bounded meal parser proposes only explicit
free-text name, ISO day, slot and numeric servings. It refuses relative/ambiguous
dates, unsupported time/portion phrases and multiple plans rather than guessing.
Omitted fields retain current form values; saved recipe/cook IDs are never picked
by spoken names. Linked-recipe and edit paths retain their manual canonical UI.

Apply does not save, mark cooked/eaten, allocate prep portions or change stock.
Save still uses useMealCreation's original-context atomic create/recovery path.
EN/ES parser/control test source is authored, not run; existing food controls
use the shared primitive. No QA/typecheck/lint/build/browser/native, provider/
schema operation, push, merge or deployment occurred. Remaining #125 code work:
integrated recipe/prep stock-lot/amount review and direct used/discarded stock
restocking. Microphone, provider/model, store and physical lifecycle acceptance
remain separate dependencies. Matrix: `product/FOOD_CAPTURE.md`.

## Reviewed foreground food description source — 2026-10-20

Canonical Add item has an optional collapsed typed/voice description. A bounded
EN/ES parser proposes only explicit name, quantity/unit, storage and labelled ISO
date fields. Multiple items, relative/invalid/ambiguous dates and unsupported
quantities require manual review. Quantities/units are not converted and no
safety/expiry inference is made. Apply changes only shown fields; Save remains
the existing canonical intake/recovery action. No new model or provider route.

Browser recognition is tap-only with disclosure, app/device language, 20-second
food-listening bound, stop on collapse/lock/visibility/context/unmount, and typed
fallback. A late transcript does not replace text edited while listening. The
existing optional local Android phrase preview is reused without enabling it;
no background wake or native acceptance claim. Source tests are authored, not run.

Reconciliation found remaining #125 code gaps: meal voice proposals, integrated
recipe/prep stock-lot/amount review, and direct used/discarded stock restocking.
Recipe display scaling/portion tracking does not itself decrement inventory.
Next: implement those existing-issue gaps, retaining explicit quantity review.
No QA/typecheck/lint/build/browser/native, provider/schema action, push, merge or
deployment occurred. Matrix: `product/FOOD_CAPTURE.md`.

## Gated inventory recovery UI source — 2026-10-20

Personal inventory now has a shared recovery provider, EN/ES review sheets and
gated write wiring across manual creates, barcode/photo trays and all stock
changes. Exact online requests stage before send; original keys/bodies and owner
proof reach existing canonical routes. Unresolved keys block unrelated changes;
confirmed cleanup must persist before success reaches the form. Recovered names
are hidden until current canonical review; original values, stock summary,
explicit retry, historical confirmation and confirmed local dismissal are wired.
Uncertain storage has deliberate repair controls. Read access loss suspends the
panel. Native bridges ignoring cancellation settle writes as unknown at 15 s.

The adopted rollback flag selects this UI boundary; new-writing gates remain
off. Paused negotiation still permits owner-checked read/review/local dismissal,
but stage/send stay refused. No automatic retry or new offline queue action.
Source tests are authored for ordering, original-key retention, late network
completion, hidden names, local dismissal, paused review and EN/ES. None ran.
No typecheck/lint/build/browser/native QA, schema/provider action, push, merge or
deployment. Next: finish #125 source reconciliation against all issue criteria,
including voice/cooking/restocking dependencies, then remaining issue ledger.
Actual storage, multi-tab, nested focus/Back and physical lifecycle acceptance
remain in the later consolidated QA pass. `architecture/INVENTORY_RECOVERY.md`.

## Canonical inventory recovery review source — 2026-10-20

Added read-only exact-request review against matching actor/household/action/hash
receipts, current owned stock/versions and owned Undo. It distinguishes pending,
committed, original removal, expired, conflict and unavailable states without
reconstructing old requests. A private proof-bound endpoint, bounded browser
negotiation/review, existing storage adapters and checked inspection are authored.
Test source covers lost-response/expiry/household/version and fetch-binding
boundaries; none was run.

The recovery programme remains off/not UI-integrated. Next: connect durable
stage/send/confirmed-dismiss to manual, barcode/photo and stock flows and add
EN/ES explicit recovered review/storage recovery controls. Current forms still
retain only mounted-memory recovery. See `architecture/INVENTORY_RECOVERY.md`.
No tests/typecheck/lint/build/browser/native QA, schema operation, provider
activation, push, merge or deployment occurred.

## Inventory restart-recovery foundation — 2026-10-20

Added a strict bounded inventory request journal, separate session/canonical
actor/household owner scope, private gated negotiation and optional proof checks
before intake/change processing or replay. It reuses existing owned-journal
retirement and Web Locks without adding a grocery queue action. Unknown storage,
conflicting copies, owner changes and uncertain transitions retain evidence;
replacement runtimes require explicit canonical review before sending original
keys/bodies. Source includes storage-fault, generation-retirement, owner-proof,
gating and route-contract tests, not run.

This is **in progress, off by default and not UI-integrated**. Active inventory
forms still use mounted-memory recovery. Next: bounded browser negotiation and
canonical recovered-target/receipt review, then form/capture/stock wiring and
EN/ES recovery controls. Do not claim restart recovery works yet. Details:
`architecture/INVENTORY_RECOVERY.md`. No tests/typecheck/lint/build/browser/native
QA, schema operation, provider activation, push, merge or deployment occurred.

## Bounded inventory refresh source — 2026-10-19

Personal inventory refresh now uses a 15-second whole-batch deadline, bounded
response readers and validated DTOs. Pagination rejects repeated IDs/invalid
cursors, caps at 20 pages of 500, and discloses that cap. New refresh generations
cancel/ignore older replies. Failed history refresh is explicit and disables stale
Undo actions. Original actor/household binding is checked by four personal read
routes and echoed before the new reader parses private data. Authorization/scope
loss conceals the cached view and suspends capture/edit sheets; original-scope
retry or explicit reopen is required. Deploy backend support before new clients.

Source tests/fixtures and EN/ES copy are authored, not run. No test, typecheck,
lint, build, browser/native QA, schema operation, provider action, push, merge or
deployment occurred. Read snapshots and unresolved write drafts remain memory
only; remount/reload/process death loses them. This is not durable offline
recovery or a transaction-wide read snapshot. Next: reconcile that remaining
offline/native gap with #135/#473 before advertising any new capability.

## Ingredient-presence confidence source — 2026-10-19

Cooking/grocery review now distinguish saved ingredient links from name-only
matches and state that amounts/units still need checking. Zero/invalid/finished
stock is not a match; SQL excludes zero stock before cooking/use-soon caps.
Household-inconsistent recipes are skipped with incomplete disclosure. A bounded
cook-response contract refuses contradictory/future sufficiency metadata while
retaining legacy presence replies. All-matched recipes still offer grocery review.
Today personal wording follows presence semantics; shared DTOs gain no private data.

Source fixtures/tests and EN/ES copy are updated, not run. No QA/build/browser/
native, schema/provider/account, push, merge or deployment action occurred.
Quantity sufficiency/conversion is not inferred. Next: refresh/offline/native
reconciliation. Full matrix: `product/FOOD_CAPTURE.md`.

## Reviewed stock edit/remove source — 2026-10-19

Personal edits and confirmed removals now use the same atomic change/recovery
path as consumption/Undo. Opened item versions prevent stale overwrites/deletes;
unknown outcomes keep original requests and expose reviewed fields in a collapsed
summary. Shared canonical edit/remove primitives serve new and legacy routes.
Removal confirmations require matching completed actor/household/request receipts
after the item/history are gone; edit replay cannot restore stale fields.

Source fixtures/tests and EN/ES labels are updated, not run. No QA/build/browser/
native, schema operation, provider/account action, push, merge or deployment
occurred. Remaining #125 source work: matching/unit confidence and refresh/offline/
native reconciliation. Full boundaries: `product/FOOD_CAPTURE.md`.

## Atomic consume/discard and owned Undo source — 2026-10-19

Personal stock actions now use versioned keyed inventory/change with original
actor/family, current session/role/feature and expected item versions. Canonical
stock, adjustment and compact receipt commit together. Replay checks current
ownership/existence and refreshes live stock instead of returning cached amounts.
A non-dismissible recovery sheet keeps exact requests through unknown results
and later access refusal; explicit atomic no-effect results permit fresh review.
Undo preserves later edits. Legacy wrappers share canonical transaction primitives.

Source fixtures/tests and EN/ES copy are updated, not run. No QA/build/browser/
native, schema operation, provider/account action, push, merge or deployment
occurred. Edit/remove paths, matching/units and durable offline/native acceptance
remain open. Full matrix: `product/FOOD_CAPTURE.md`.

## Focused package/date and receipt review source — 2026-10-19

Document modes now use explicit protocol/original household context, separate
off-by-default processing approval, transient printed evidence and one-item review.
Dates stay blank until explicit confirmation; receipt timestamps/storage guesses
are discarded and package size never becomes stock quantity. Reviewed labels
save as existing stock snapshots through atomic intake. Upload/provider response
bytes are bounded; post-provider authority/feature checks renew access. EN/ES
copy and test source are updated, including distinct manual-save message keys.

No provider activation/call, QA/build/browser/native, schema generation/migration,
push, merge or deployment occurred. Document-data/provider acceptance and native
quality remain dependencies. Next source work: stock lifecycle and offline/native
reconciliation. Full requirement matrix: `product/FOOD_CAPTURE.md`.

## Manual food-create intake source — 2026-10-19

Add item now uses canonical keyed intake with original household context, strict
reviewed fields and no legacy POST fallback. Unknown saves retain body/key and
lock fields/navigation through later refusal; Check same save confirms the same
operation. Removed originals are explicit. Existing edit/adjustment paths retain
their contracts. EN/ES copy and focused source fixtures are updated, not run.
No QA/build, schema operation, push, merge or deployment occurred. Remaining
capture work is focused photo/receipt and stock/offline/native reconciliation.

## Barcode food review and private recognition source — 2026-10-19

Personal inventory now has typed/local-camera barcode capture and a compact
review tray. Repeated codes do not silently add stock; label size stays separate
from quantity and dates remain explicit. Household recognition, opt-in revision
corrections, stock snapshots and keyed receipt share canonical intake. Product
export/deletion and EN/ES controls are wired. Shared Use soon remains minimal.

The bounded fixed-host Open Food Facts v3 adapter needs explicit lookup/apply
and stays off behind enable/reuse/contact gates. No public provider was called
or activated. Additive schema/migration and focused test source are authored,
not generated, applied or executed. No QA, native run, push, merge or deployment
occurred. Manual-create migration, focused photo/receipt, lifecycle/offline and
provider/native acceptance remain open. Full matrix: `product/FOOD_CAPTURE.md`.

## Atomic reviewed inventory intake source — 2026-10-19

The #125 foundation adds dedicated versioned/keyed inventory intake, committing
canonical stock and a compact receipt in one current-authority transaction.
Replay renews authority/existence and never recreates deleted stock. Expected
actor/family and issued-at keep the original household and expiry boundary.
No separate stock store or schema change is introduced.

Photo review now uses intake, freezes the reviewed body/key after uncertainty,
keeps recovery across later refusal and blocks navigation/new-photo replacement
until confirmation. Confirmed rows leave the tray with truthful partial counts.
Context and photo waits/late responses are bounded; suggestion HTTP data is
validated. Server-page context binds personal capture; standalone capture can
read current intake context. EN/ES copy and source fixtures are updated.

Tests are written, not run. No QA, build, provider call, schema operation, push,
merge or deployment occurred. Barcode capture/product lookup/private corrections,
manual-form migration, broader stock lifecycle and native/offline acceptance
remain unfinished. See `docs/product/FOOD_CAPTURE.md` for the full #125 matrix.

## Bounded multi-source recipe discovery source — 2026-10-19

Explore can search all three existing supported publishers in one deliberate
request, retaining single-source selection and original search fallbacks.
At most three independent bounded public reads run; round-robin title/link
results are capped at 24 and attributed by source. One site's outage preserves
other results with EN/ES incomplete-coverage copy. No comprehensive index,
licensed recipe catalog or new provider activation is implied.

Discovery input is strict/stream-bounded, every response is private/no-store,
and client result JSON/waiting/stale requests are bounded. Mocked source tests
for fixed-host fan-out, attribution and partial outage are written, not run.
No QA/build/browser pass, provider call, push, merge or deployment occurred.
Full recipe acceptance and the wider issue-completion goal remain unfinished.

## Explicit recipe import review source — 2026-10-19

Bounded public JSON-LD extraction now reports shortened title/description,
ingredient/step omissions and missing servings/times/ingredients/directions.
Nested direction traversal has node/depth/step/text bounds. EN/ES reader/editor
notices retain the original-source fallback; older previews with no limit report
are labeled accordingly. Runtime response validation refuses malformed or future
metadata instead of rendering unchecked HTTP JSON.

The editable draft now retains all bounded extracted ingredient lines plus
directions, without the former silent 20,000-character combined cut. Over-limit
content is retained and refused locally before any save until explicitly edited.
Imported unknown servings start blank and require review; manual creation retains
its visible defaults. Preview input is strict and stream-bounded to 8 KiB, all
responses are private/no-store, and client waiting is bounded with stale/unmount
guards. No provider/model or media capability was added.

Focused parser/contract/editor/API source tests and fixtures are authored, not
run. No QA/type/lint/build/browser pass, schema operation, provider call, push,
merge or deployment occurred. Broader discovery and issue reconciliation remain
open before the consolidated QA pass.

## Recipe cooking portion preview source — 2026-10-19

Saved recipe detail now has a local EN/ES Cooking portions preview (1–100),
Original reset and grocery intent using the same selected portion count. Only
reviewed numeric ingredient amounts scale; units, authored directions and times
stay as written. Unknown base servings stay unscaled. Invalid input shows original
amounts with an explicit correction message. Canonical recipes and prepared
history are not rewritten. Tiny amounts use significant-digit formatting so a
small nonzero quantity is not displayed as zero.

The explicit recipe-grocery request ceiling now matches existing recipe and
ordinary meal servings (100), replacing its inconsistent 50 limit. Bulk prep's
50-portion cap is unchanged. Grocery add/Undo own pending navigation and retain
original recovery through later refusal. The reader freezes preview/edit/curation/
reuse controls during that ownership. Source tests and architecture notes are updated;
none run. No QA, schema, provider, push, merge or deployment action occurred.
Remaining discovery/parser and broader issue reconciliation are still open.

## Saved recipe reuse and keyed ordinary meal create source — 2026-10-19

Saved recipe detail now links directly to Plan a meal and Add to prep. A recipe
URL carries intent only: the destination re-reads canonical owned metadata and
a deliberate tap opens the existing editor. The same saved ID is reused, with
reviewable day/slot/portions; no automatic meal, recipe copy or stock write.
Prep can add more dishes through the existing multi-step session editor.

The ordinary meal editor now uses a dedicated versioned/keyed create endpoint.
Fresh User/household/session/meals authority, expected account/family, same-family
recipe/cook checks, canonical meal and compact receipt share the write boundary.
Ambiguous responses retain the exact key/body and lock editing/navigation until
confirmation. A replay checks current ownership and existence; it never recreates
a deleted meal. Issued-at bounds refuse recreating an expired saved intent after
receipt pruning. Ordinary meal Undo also retains its original context/key/body
and offers Check same restore after an unknown result. Existing legacy
`POST /api/meals` remains for old callers; no broad mixed-client safety claim.

EN/ES reuse/recovery controls, focused source tests and issue documentation are
updated. No QA/type/lint/build/browser run, generation, migration, provider call,
push, merge or deployment occurred. Remaining #460 parsing/discovery/scaling and
broader issue reconciliation still need implementation review, then one
consolidated QA pass. This goal remains unfinished.

## Prepared recipe history source — 2026-10-19

The #460 reuse candidate captures a bounded canonical recipe snapshot when a
prep session is first marked prepared. All linked recipes must be readable and
valid before any snapshot is written; snapshots, prepared state and the existing
receipt share one transaction. Later recipe edits/deletion and repeated prepared
requests cannot rewrite this evidence. Already-prepared legacy sessions remain
explicitly unrecorded. Planned dishes keep using the current canonical recipe;
prepared dishes keep their existing grocery refusal and portion accounting.

A read-only EN/ES Recipe used sheet loads history on demand through current
verified parent/teen household authority. Full snapshots stay out of prep-list
responses and shared-device surfaces; household export includes them. Recipe
detail labels and capture failures have EN/ES text. An additive migration and
focused contract/disposable-DB test source are authored, not run. No Prisma
client generation, migration, QA, build, push, merge or deployment occurred.
Broader #460 discovery/reuse reconciliation and the implementation-first goal
remain unfinished. See `docs/product/RECIPE_DISCOVERY.md`.

## Recipe duplicates, favorites and collections source — 2026-10-18

The #460 follow-up adds durable source identity and household-locked duplicate
checks, Open saved/Edit and deliberate separate-copy choices, household favorites
and named collection create/rename/confirmed-delete. Recipe/collection membership
is protected by composite household FKs. Curation is revision-bound, exact-state
retry converges, and uncertain UI writes preserve choices until explicit refresh.
EN/ES library filters and rounded management/organization sheets are wired.
Content edits use revision plus updated-at comparison, preserving concurrent and
older-server changes instead of blindly replacing newer content. Export/erasure
inventories include collections and memberships.

An additive SQL migration and Prisma schema are authored, not applied/generated.
Focused test source is authored, not run. No QA, build, provider activation,
push, merge or deployment occurred. Requested curation code is a local candidate;
full #460 reuse/history and broader discovery reconciliation remain. See
`docs/product/RECIPE_DISCOVERY.md`. The implementation-first goal stays active.

## Full saved-recipe search and exact-create recovery source — 2026-10-18

The #460 candidate now searches the whole household recipe box on the server,
with EN/ES title/description, reviewed ingredient, known prep-time and serving
filters, separate from online publisher search. Recipe create and its compact
ID receipt commit together under User/household/receipt locks; current role,
family, meals and session generation are rechecked. Detail is projected fresh,
not replayed from an old content snapshot. Deleted recipes cannot be recreated
by replay. Tagged create payloads make old strict routes refuse before mutation.

An uncertain editor create retains its exact key/body, locks fields and offers
a bounded explicit confirmation retry. Test source is added but not executed.
No schema change, QA, migration, provider activation, push, merge or deployment
occurred. Curation, source deduplication and remaining reuse/history work stay
in #460; see `docs/product/RECIPE_DISCOVERY.md`. The full goal remains active.

## Gated Android local voice draft source — 2026-10-18

The #563 source now includes a first-party `LocalVoice` Capacitor plugin using
Android’s on-device recognizer only (API 31+ and actual service/model readiness).
The EN/ES input is wired to the personal assistant draft and shared-tablet grocery
draft. An explicit tap requests microphone permission; one utterance is bounded
to 20 seconds and cancellation/hidden app/context replacement drop late results.
Typing changed while listening is retained. The foreground wake-phrase experiment
extracts a draft only, never authenticates, sends chat or executes an action.

`NEXT_PUBLIC_LOCAL_VOICE_PREVIEW=0` by default. The manifest/plugin change needs a
rebuilt binary, permission/privacy review and real-device acceptance; no native
sync, build, test, activation or release was performed. Existing scoped #465 and
#466 foundations and #473 source contract were reconciled in the issue ledger.
Source/remaining platform plan: `docs/architecture/LOCAL_VOICE.md`.

## Explicit legacy saved-change bridge source — 2026-10-18

The #564 candidate now includes short EN/ES keep/discard review sheets for
recognized v1 work. Current canonical target/actor checks precede old text
display; verified owned copies precede old-copy retirement. Lost acknowledgements
require the same decision, changed owners retain the source, unknown fields and
unread/divergent copies pause, and capacity never evicts work. Unknown-origin
tablet adds remain locked rather than changing their idempotency namespace.
Recovered failure records retain durable review holds beyond normal retention.

Focused fault-test source is added but unexecuted. Previous-client rollback,
real cross-context locks and native acceptance remain deferred with all other
QA. Flags stay off; no migration, push, merge or deploy occurred. Details:
`docs/architecture/QUEUE_OWNER_RECOVERY.md`. The goal and issue stay open.

## Scoped queue cleanup, locking and named review source — 2026-10-18

The next #564 local pass moves owned journals into separate person/device
databases and scope-qualified keys. Legacy database wipes cannot target those
new journals. Cleanup matches captured old scopes, authoritative revoked User
generation cutoffs, old pairing IDs or confirmed account/household erasure;
it never broadly deletes an owned database. Sign-out now compares the current
session generation atomically before revoking it and returning a private
cleanup receipt. Future login generations/other accounts are excluded.

Owned operations use actual non-waiting exclusive Web Locks. A failed lease
retains exact write/retirement intent. Both personal and paired routes now
support bounded canonical target review, and shared EN/ES sheets display
current item/list/member names and desired/current tick state before retry.
Foreign, missing or unavailable targets stay kept without exposing old content.

This is still source in progress: deliberate legacy-v1/rollback recovery and
fault/concurrency test source remain before candidate freeze. Unknown-origin
legacy device creates must retain their original idempotency scope; they cannot
be blindly rebound to a new pairing. No tests/type/lint/build/browser/hosted QA,
push, merge, deployment, database migration or real account/device mutation was
performed. No rollout gate was enabled. Full source/remaining criteria remain
in `docs/architecture/QUEUE_OWNER_RECOVERY.md`; the goal and #564 remain open.

## Queue owner/retirement core source in progress — 2026-10-18

Local #564 adds private owner negotiation, per-issuance person-session nonce,
stable device-pairing continuity, v2 retirement-envelope source, exact-operation
storage recovery, fresh pre-send proof and owner checks on all four queued
grocery-write routes before replay/mutation. Recovered active work from another
runtime requires per-item review and retains original keys/bodies. EN/ES source
distinguishes review, changed-owner and uncertain-storage states.

This is **not source-complete or ready to activate**: principal-qualified
physical cleanup, cross-runtime exclusion, deliberate v1/rollback recovery and
named tablet tick controls remain coding work. The exact next steps and later
acceptance matrix are in `docs/architecture/QUEUE_OWNER_RECOVERY.md`. Both
`QUEUE_OWNER_RECOVERY_ENABLED` and `QUEUE_OWNER_RECOVERY_ROLLBACK_READY` remain
off. No tests, type/lint/build/browser or hosted QA were run. No push, merge,
deploy or real session/device mutation was performed. The goal stays active.

## Verified profile-to-account linking source candidate — 2026-10-18

Local #557 now includes additive challenge schema/migration, expiring one-use
parent issuance, signed-in verified-email owner/password confirmation, explicit
parent approval and revision-bound revocation. Sorted account locks precede
household locking and all identities/roles/session generations are rechecked.
The final transaction preserves the existing profile ID and fills canonical
chore/assignment aliases alongside the verified link and compatibility mapping.
It does not change history, completion actors, points, XP or account authority.

Parent management uses short EN/ES sheets. The exact child/teen claim route
keeps proof in memory, strips the URL fragment and requires reopening the
original private link after refresh. Provider mail and casual unlink/reactivation
are absent; existing account invitation and reviewed removal/erasure remain
the authorities. Relation inventories and the issue ledger include the domain.

`HOUSEHOLD_PROFILE_LINK_ENABLED` is new and off; it also requires all existing
profile setup/chore/rollback opt-ins. No flag was enabled, database migrated,
Prisma client generated, test/build/type/lint/browser run, push, merge or deploy
performed for this slice. Deferred acceptance and compatibility limits are in
`docs/architecture/PROFILE_ACCOUNT_LINKING.md`. #557 and the goal remain open.

## Parent Devices localization candidate — 2026-10-18

Local #445 source now uses typed EN/ES management, pairing, audit, status,
wait/count and missing-household copy. Feedback stores semantic keys and literal
parameters. Fresh pairing labels use the opening language; existing labels,
codes, digits, native reason values and private/raw values stay unchanged.
Locale is absent from canonical fetch/poll/countdown/reset effect dependencies.
The known inherited audit-reason lookup now checks own properties and retains
neutral unknown audit wording. The scoped wait helper preserves default-English
output for existing paired-device callers. Owned copy-debt records were migrated.

No tests, type/lint/build/browser QA, hosted runs or real pairing were performed.
Source/compatibility and deferred acceptance are recorded in
`docs/architecture/PARENT_DEVICE_LOCALIZATION.md`. This does not close #445 or
imply shared/native/hardware acceptance. Account linking and the wider ledger
remain active coding work.

## Account-backed personalization candidate — 2026-10-18

The next local slice replaces the device-only preference authority with
canonical User display preferences and parent Family defaults. It includes
strict versioned GET/PATCH APIs, current-session/role/household rechecks under
membership and User-row locks, personal/default revisions, CAS conflicts and
role-filtered favorites. Read caches stay owner-scoped and never authorize a
write. The shared fridge and feature flags keep their existing contracts.

The editor now awaits confirmed account saves, retains drafts on refusal or
uncertain outcomes, requires an explicit choice after another device changes
the baseline, and applies revision-bound Undo. Reset removes a personal
Today override so current parent defaults apply. Parents can edit those defaults
from Household settings without replacing existing personal overrides. Quiet
view and favorites also save to the account. Preferred views include Month.
The caller's data export includes only their own display record.

Schema, additive idempotent migration SQL, startup migration source and API /
compatibility notes are written in `docs/architecture/DISPLAY_PREFERENCES.md`.
No database was migrated and no Prisma client regenerated during this phase.
No tests, type/lint/build checks, browser QA, push, merge or deployment were run.
This is code prepared for consolidated QA, not issue acceptance. Next remaining
coding work includes full Devices/pairing localization and verified account
linking; the82-issue ledger preserves the wider goal.

## Goal and next implementation batch — 2026-10-18

Cameron explicitly set the goal to finish all approved plans/issues/code before
one consolidated QA pass. The82 open issue records are indexed in
`docs/engineering/ISSUE_COMPLETION_LEDGER.md` with truthful dispositions and next
actions. This is reconciliation groundwork, not82 finished features.

The local follow-up after62f4 adds personal Today section visibility/order,
spacing, preview/save/reset/Undo and preferred calendar shortcut; a shared
role/feature-filtered Explore browser with up to8 favorites; local app guidance
reusing canonical EN/ES Help answers without model/private-record requests;
and a42-cell Month calendar with bounded existing API reads, month navigation,
Day details and retained partial/error behavior. Personalization is device-local;
account sync/parent defaults, full device localization and verified account
linking remain coding work, not hidden behind a QA-only status. Native/provider,
physical-device/store and customer dependencies remain distinct. No new tests,
build, browser QA, push, merge, deployment or production activation is claimed.

## Implementation-first direction — 2026-10-18

Cameron explicitly requested finishing the remaining UI code before further QA.
The local follow-up now includes:

- Separate account invitation and email-free profile choices on Family/Add family;
  short profile/invitation sheets with fixed primary actions, retained entries,
  immediate submit guards and canonical response handling. Invites do not link
  existing profiles; no account-link API or production profile flag is enabled.
- A per-viewer quiet display preference stored on this device, reachable from
  Settings and child Home. Home/Chores hide optional points/streak decoration;
  completion and claim feedback remain truthful, and canonical earned values,
  household features, notification quiet hours and reward costs are unchanged.
- Account / Family / Privacy settings views that retain mounted drafts and
  reveal deep-linked calendar/provider sections; shorter household settings
  with explicit load/refusal states and existing BoardSettings/deletion controls.
- Collapsible mobile calendar sources/connections and a Week scrolling hint;
  existing range, timezone, overlap and provider contracts are retained.
- English/Spanish notification, search, Help and list-detail presentation;
  wrapping notification/list text, truthful malformed-response recovery,
  existing snooze/Undo/offline queue behavior and immediate action guards.
- Expandable Help topics, shared header reflow and pending-safe device rename
  and removal dialogs. Auth, role navigation and sanitized fridge board reuse
  their existing canonical implementations.

This is an implementation checkpoint, **not QA or release acceptance**. No new
unit/integration tests, lint/type gates, optimized builds, browser journeys,
visual reviews or hosted CI were started for this batch. Formatting was applied
to edited code. QA remains for afterward, including old tests whose selectors
or expectations describe the previous layouts. No checks/protections are
removed. No new merge, push, deployment, provider activation, production flag or
household-data mutation is included. Native/store and account-link backend work
remain separate from this presentation batch.

## Care and coordination UI candidate — 2026-10-18

Production is verified PR587 at `afb15426d9fdb63a7f4f6c437d2c23e20d55dab9`,
Coolify deployment563. All original candidate and exact-main Build, Android and
E2E follow-ups pass. The previous dated checkpoints below preserve history.

PR588 now targets `7dca47b40ffcc290432be0d50fa9f587f1c88938`. Its Inventory
scroll and completion-focus repairs have independent source/rendered review,
exact local build and12 Inventory journey passes (3 auth setup cases separate).
Original Build39171834320, checked image and Android39171834332 pass; baseline
5988 cases pass with433 established opt-in skips. Original E2E39171834350 remains
pending. No merge/deployment of588 is claimed.

This local follow-up combines reviewed Sick days short sheets, truthful
schema-checked dependency/auth recovery and per-medication guards; Handoff
short sheets, optional details and public transient/null/expired-link recovery;
and Travel household-text wrapping. Combined55 affected mounted cases, types
and copy checks pass. The first rendered run verifies Travel long-text states,
but caught browser harness matcher issues and a real public Handoff locale
reset caused by a nested provider. The provider is removed and harness targets
are corrected; final exact build/browser/hosted/release acceptance is pending.
No API/schema/role, clinical-value, provider or activation change is included.

The full22-feature/supporting-route goal remains open, including wider
role/device/offline states, Add Everyone/account linking and quiet mode.

## Combined web review repairs — 2026-10-18

Production remains PR580 at `5cf9720bd3ca38862bc54c7094ac90f87a3892d8`.
PR581's `d9c3b85d` passed all original hosted checks, but normal merge was
refused because three required review conversations remained unresolved. No
policy override was used. The new local integration includes Projects
`e4d93c54` unchanged, canonical Budget optional-text normalization `6eae6e03`,
and bounded recent-transaction reconciliation `7c4548a8`. Independent source
review of both Budget fixes is clear; all42 affected mounted cases pass together.
The owner-scoped durable Rewards intent repair `d256efa1` includes explicit
capacity refusal before dispatch and is independently reviewed clear. All65
focused Rewards-create, durable-intent and Budget mounted cases pass together.
Existing browser journeys now cover real API text normalization, a backdated
save outside the ten-row recent window, and lost-response/reload/same-key reward
recovery; their new rendered run remains pending.

These are local implementation checkpoints, not a new release. The combined
candidate still needs completed review repairs, exact-source build/rendered
journeys, fresh original hosted checks, resolved verified conversations and
protected recovery evidence before normal merge and deployment verification.
Earlier dated checkpoint paragraphs below are retained history. The full
22-feature and supporting-route scope remains open under #499/#128.

## Combined child, Rewards and Budget verification — 2026-10-18

The child localization and resolved reward-notice product source is reviewed at
c89ee28d. All92 affected cases pass. Full baseline has5895 passing cases,
410 established opt-in skips, and three unchanged Mac backup-prune failures;
full types/lint/format and optimized builds pass. The original Linux gate is
retained, and all hosted checks on remote4381659b have now passed.

The later child browser repairs preserve UTC date-only fixtures with ISO SQL
parameters and scope date assertions to their event/mission content. A phone
diagnostic using compiled b9473aa0 and test77438bbf passes all seven cases,
including setup and both EN/ES child and parent routine views. This diagnostic
has different application/test commits and is not final exact-head acceptance.
The prior exactfe878 phone run separately verifies both malformed-claim retries
remove the resolved notice. Fresh exact-head build, expanded six-size matrix,
independent capture review and original hosted gates are still required.

Cameron requested test consolidation. A separate cleanup removes only confirmed
duplicate navigation checks and implementation-class mirrors while preserving
behavioral, role, privacy and recovery checks. Current release gates remain
unchanged. Projects remains separate and its reviewed retry/replay repairs are
being integrated; no production household data has been changed.

## Child home localization and resolved-notice follow-up — 2026-10-18

PR581 now incorporates reviewed child UI19ed11cb and browser QA18ba9828 over
4381659b. Product dates, missions, routine states, errors, Undo and screen-reader
labels use typed EN/ES copy; household text and permissions remain unchanged.
The prior438 exact build and six-size Rewards/Budget matrix pass140 cases,
25 declared desktop scopes and all36 unchanged startup budgets, with180 unique
PNG captures. Independent visual review found a stale claim error toast after
successful retry. That source is retained as a conditional checkpoint.

The follow-up gives an action notice a stable caller-owned identity, replaces
only repeated notices for that action, and dismisses the reward notice after a
validated successful claim. Existing toast callers and Undo behavior retain
unchanged defaults. EN/ES mounted tests verify the notice clears and the same
idempotency key is retained; a separate test verifies other alerts survive.
All92 affected child/routine/toast/copy-guard cases pass. Fresh combined baseline,
exact build, expanded rendered matrix and original hosted gates remain required;
the24 new child cases are prepared but not yet run. Projects is separate work.

## Combined Rewards/Budget rebuild checkpoint — 2026-10-18

Source `59c1a92b` incorporates the inactive-reward and Spanish-copy repairs plus
reviewed phone Budget summary reflow. App `22f482a6` passed its exact optimized
build, generation/types/lint, secret-history scan and 5887 unit cases; 410
established opt-in cases skipped and the three retained Mac backup-prune cases
failed. Fourteen actual PostgreSQL Rewards/Budget cases pass. No gate is waived.

The first combined browser attempt retained three harness failures: an alert
selector also matched the Next route announcer, and an old synthetic 201 lacked
the now-required canonical transaction fields. The phone diagnostic then exposed
a duplicate currency selector and correctly rejected mismatched build/test
identity. Those fixture/selectors are repaired without weakening assertions.
Independent capture review also confirmed cramped phone summary copy; the
reviewed product fix moves the action below metrics on phones and keeps desktop
layout. Its 25 affected cases/types/lint pass, and browser checks now measure
actual localized sentence wrapping. A fresh exact-source build/matrix and
original hosted gates remain required before merge/deploy. All failed reports
and the earlier runtime identity are retained separately.


## Rewards inactive-claim repair — 2026-10-18

Combined `4271f994` normally incorporates API `295855fc`, UI `f61044da`, and
browser regressions `bbabca41`. Independent source review is clear: fresh claims
require canonical activity in both the validation read and atomic transition;
child discovery filters activity before its limit. A committed claim can replay
after retirement, and previously claimed retired rewards remain approvable.
Parent mapping preserves activity and avoids duplicate pending/history rows.
Spanish recovery and singular point templates are corrected in both consumers.

Fourteen actual PostgreSQL Rewards/Budget cases pass on application `5a10e09c`,
including inactive refusal, same-key reactivation, committed replay, existing
claims and concurrent Budget retries. Types and full lint pass. The later
`4271f994` delta contains browser assertions only. The original conditional
132-capture report remains retained; it is not final acceptance of the repair.
Fresh combined baseline, exact build and both rendered matrices remain required.
Broader child supporting copy remains a separate pending slice: typed EN/ES
KidHome/KidRoutines dates, missions, empty/progress/error and accessibility text,
with household content verbatim and all role/receipt gates retained.

## Rewards and Budget combined local candidate — 2026-10-18

Integration `1ffe0a9f` normally merges reviewed Rewards `e0756c9a` and Budget
`d9d040a3` over accepted main `5cf9720b`. Only the translation migration inventory
conflicted: keep the exact 37 Rewards and 38 Budget removed entries, retain all
other entries and the valid numeric `0.00` placeholder; no guard is weakened.
Both actual PostgreSQL suites are added to the existing database-backed CI job.
No application/API/schema/workflow conflict required manual source resolution.

Rewards constituent application `c2c95b60` passes its optimized build and the
six-size EN/light, ES/dark matrix: 116 passed, 25 declared desktop-only scope
skips, no failures/retries, including all 36 unchanged startup budgets. The
verified runtime matches that application; its final test-only source is
`e0756c9a`. All 132 required state/locale/viewport captures are retained with
pixel hashes and dimensions. Source review and 303 affected tests pass.
Independent rendered review is conditional: canonical inactive rewards can still
be newly claimed, Spanish approval recovery has an English headline, and singular
points copy needs correction. API/UI repairs are in isolated author branches;
this candidate is not accepted for release. Wider child supporting-copy
localization remains open under the full role-alignment scope. Earlier interrupted/failed test-harness
reports are retained and are not substituted for the accepted matrix.

Budget constituent has clear scoped source review, 144 affected test passes,
types/lint passes and seven real PostgreSQL cases, including concurrent retries.
Full local units: 5833 passed, 403 established opt-in skips, three retained Mac
backup-prune failures. Actual canonical add/edit/delete and stats-recovery
browser QA is prepared but has not run. The combined candidate still requires
its own baseline, exact build, both rendered matrices, independent review and
fresh original hosted/release gates before any new merge or deployment.

The already serving #580 remains `5cf9720b`, with production runtime verified.
Original exact-main Build/Test and checked-image (39115308640), Android
(39115308615), and E2E (39115308741) are terminal success. All nine E2E jobs,
including every viewport and opt-in feature QA job, passed. The existing
production runtime verification remains separate from authenticated household
acceptance; no production household records were changed.
The full22feature/supporting-route and separate native/provider gates remain open.

## Verified live web revision and subsequent UI work — 2026-10-18

PR #580 normally merged as `5cf9720bd3ca38862bc54c7094ac90f87a3892d8`.
Its tree `348eeda354693ac10662f7db00643956aee03469` exactly matches reviewed
candidate `b342ee24`; incorporated #556/#577/#578/#579 are verified merged.
Every original candidate workflow passed, including all viewport, Settings,
Inventory, recovery, profile-routine, Android and fresh checked-image jobs.
Exact combined local build and browser QA passed: 164 cases, 25 declared
viewport scope skips, no failures/retries; seven supplemental actual phone
footer scroll/hit checks also passed. Independent source and visual review is
clear, with 236 unique captures and 24 queue source/runtime/hash proofs.

Protected backup restored all 71 public tables in an isolated temporary
PostgreSQL database, preserving row counts; the temporary database was removed.
Existing automatic Coolify source deployment 560 finished at 09:30:11 UTC.
Serving container `13ce714efd59`, image `63b22fe2b228`, release/OCI revision,
public version/readiness/liveness and both startup migration phases were
verified. This is a Coolify source build, not CI-image promotion. Profile setup,
profile chores and assistant Today remain off; no household records or
configuration were changed. No authenticated production journey is claimed.

Exact-main runs remain separate acceptance: Build 39115308640 and E2E
39115308741 are running at this checkpoint; Android 39115308615 passed.
Follow the current [release record](https://github.com/camster91/family-planner/pull/580#issuecomment-6248271303)
for their later outcome. Older pending statements below describe preparation.

Rewards is subsequent local work: canonical optional receipts and authority,
localized role-aware choices, owner-safe create draft recovery, strict success
identity and approval recovery are source-reviewed. Integrated application
`672f1cde` passes generation/types/lint; 5860 unit cases pass, 402 established
opt-in cases skip and three existing Mac backup-prune cases fail. Six actual
PostgreSQL Rewards cases pass on the integrated API source. Exact build,
rendered journeys and original hosted release gates remain required. Budget
transaction receipts pass seven actual PostgreSQL cases; its UI is repairing
independent review findings and is not accepted or released.

Full 22-feature/supporting-route acceptance remains open under #499/#128.
Native/store/hardware/customer and actual AI/voice/provider activation retain
their separate gates.

## Combined Dates, Progress and saved-work candidate — 2026-10-18

The isolated `codex/web-ui-recovery-release-499` candidate normally incorporates
Dates #578 (`f1423720`, including #577 `9a8da960`), saved-work #556 (`51621a26`)
and Progress #579 (`55f417bd`). All constituent heads/history remain intact.
Integration source `f9efd20c` passes independent review, Prisma generation,
typecheck and full lint. Full local units: 5820 passed, 396 established opt-in
skips and three retained Mac backup-prune failures. Nine actual PostgreSQL
Dates receipt/authority cases pass again on this combined source. Original
Linux acceptance remains required; no tests or release gates are waived.

Constituent rendered evidence is retained separately: Dates has 89 passes and
10 declared scopes at exact application `0ed841aa`; subsequent test-only
Notes/Capture repairs pass 42 cases/15 declared scopes, with genuine isolated
logins, causally awaited availability responses and a live fixture device.
Progress `55f417bd` passes 51 browser/startup-budget cases and independent final
phone review; full names retain readable width with metrics below on phones.
Storage `51621a26` passes 63 cases, with 48 captures and 24 exact source/runtime
proofs. These constituent results do not substitute for exact combined build,
rendered/hosted acceptance or production verification, which remain pending.

The merge resolves documentation by retaining dated checkpoints and combines
only the separately removed stale localization-inventory entries (18 Analytics,
one Dates placeholder). Today retains Next up and person queue recovery.
No schema, migration, permissions, device capability, default feature flag,
provider/scheduler or native/store activation is introduced by integration.
Production remains separately verified Family/Notes `768e4170` (#576); rollback,
protected restore, normal merge, exact-main QA and live-runtime verification are
required for this candidate. The complete #499/#128 22-feature programme remains
open; Rewards is an isolated subsequent implementation, not included here.

## Dates recovery candidate — 2026-10-18

The isolated `codex/dates-recovery-499` candidate incorporates #577 through
`9a8da960` without rewriting its history. Optional canonical idempotency keys
make POST/PATCH/DELETE replayable while preserving legacy clients. Row writes
and receipts commit together; current household, role, feature and ownership
checks also protect replays. Mutation responses project current edit/delete
grants without changing stored receipts. No schema or provider change is added.

The short Dates sheets now retain uncertain intent across A/B/A draft edits and
cancel, disable edits during pending saves, validate successful responses, keep
confirmed rows/removals after a failed refresh, and offer a GET-only Retry.
Independent API/shared-helper and UI source reviews pass after their specific
findings were repaired. At application/test head `30dd3937`, optimized build,
types, 103 affected unit checks and nine real PostgreSQL route checks pass.
The complete six-size EN/light and ES/dark browser matrix passes 89 checks with
10 declared desktop-only scopes skipped elsewhere, zero failures/retries, and
64 captures. Supplemental notice captures pass 15 cases at `de7b5f63`; their visual review
identified redundant recovery cards. A subsequent compact single-card polish
passes 27 mounted cases/types and requires fresh rendered and hosted acceptance. The initial new-test selector/refresh-phase failures are retained.

The latest full local unit run at `80994cbc` observes 5779 passes, 396 established
opt-in skips and only three existing Mac backup-prune failures. The stale D9
navigation expectation lists are corrected. Its polished browser run passes
77 cases; 12 older delete-dialog cases expected the removed generic error card.
Those expectations now require the specific confirmed-delete recovery message,
single alert, generic-error absence and the retained focused Retry. A fresh
complete browser run and original full Linux CI are required before merge. The new real-database route
suite is included in the unchanged database-backed CI gate. Production is a
separate verification state; wider #499/#128 acceptance remains open.

## Family and Notes production verified — 2026-10-18

PR #576 is normally merged and production verified at main
`768e417042f0c1f924ebd3a05e8650b24f778e10`, with a whole tree identical to accepted
candidate `fb364200`. Every original candidate and exact-main build/image,
Android and browser workflow passed, including all viewport, Settings,
inventory, password-recovery and email-free profile jobs. A fresh protected
backup restored all 71 public tables, with temporary restore database removed.
Incorporated Family #575 is merged with original head/history retained.

Guarded native Coolify dispatch through unchanged application 11 produced
source-build deployment 559 (`zcuqofb8acudxij5m4z2e7ws`), finished at
2026-10-18T07:44:00Z. Healthy serving container `c83057090fdc`, image revision and
runtime commit match 768e4170; schema/post-feature migrations and startup passed.
Public version/readiness header, readiness/liveness and anonymous private-route
login refusals passed. Default-off profile/assistant flags remain off, including
both accepted truthy forms. Retained rollback is `f1d103a8`. Authenticated
production household, native/store/provider/voice and customer acceptance remain
separate. See #499 comment6247282820 for the persisted release record.

## Dates overview candidate — 2026-10-18

The isolated `codex/dates-overview-499` slice now includes merged main `768e4170`.
Application `7f2e6417` and test head `7704da0f` add canonical permission-aware
annual dates, mixed chronology, short forms, localized calendar labels and
teen/child discovery. Explicit paired-device refusal precedes person auth on
all four handlers. The shared route allowlist now agrees with documented D9
rules, preserving Settings/device/finance denials; a tiny scoped dictionary
keeps menu labels localized without loading the full catalog.

128 affected tests, optimized build/types/lint/required formatting and independent
source review pass. The final actual compiled browser matrix passes 77 cases,
with 10 explicitly desktop-only boundary scopes skipped on other sizes, zero
failures/retries. Six repository sizes include EN/light and ES/dark, canonical
parent/teen/child and two-household cases, confirmed live-device redirect/all-four
API refusals, Axe/reflow/44px controls, loading/malformed/empty/retry, raw names,
optional fields and modal/focus recovery. Supplemental exact rebuilt source
`e5d2247e` passes all 15 state cases, including actual phone scroll/focus/hit
geometry above fixed navigation. All 52 retained captures pass independent
visual review; the apparent initial narrow-screen overlap was normal scrolling.
A real routing omission and test-only Spanish/credential-clock mistakes are
fixed; unsuccessful runs remain retained. This is not full Dates acceptance:
hosted/release gates and the existing ambiguous-write/stale-refresh
recovery audit remain open. A separate unaccepted recovery continuation uses
canonical receipts and requires fresh integration/browser verification. No new
schema, scheduler, provider/profile activation or native/store change is included.
Full #499/#128 acceptance remains open.

## Saved-change recovery candidate — PR #556 current-main integration — 2026-10-18

PR #556 storage-recovery head `3470fca841c60dadb01f197e796b179e5c06276b`
was originally based on released main `4082e7db80ce2a1b690ffd013094d29febfe85bf`.
This checkout now contains a normal local merge with current main
`768e417042f0c1f924ebd3a05e8650b24f778e10` for conflict resolution and
revalidation only; it is not a public merge or release claim. The bounded
fallback-write repair is `391844c903c9fcbfcbc9b6ec3dee2690c7f939ce`; its
independent source review is clear.

The candidate preserves unread queue bytes after a failed storage read, pauses
replay and mutation until deliberate recovery, retains grocery drafts, fences
sign-out/replacement cleanup, and resets the cached device queue after fresh
pairing. It adds no schema, API, queue protocol, feature flag, provider,
scheduler, native plugin or production activation. The original hosted checks
for `3470fca8` passed; exact current-main checks, formal captures, and fresh
backup/restore remain pending. #473, #480, native hardware and production
activation remain open.

Focused queue, purge, recovery UI and Today checks pass: 9 suites and 186
tests, with typecheck and full ESLint also passing. The full Jest gate remains
red on this macOS checkout: 501 suites passed, 2 failed and 55 were skipped
(5,771 tests passed, 17 failed and 387 were skipped). The failures are the
unrelated `backup-prune` and `recovery-rehearsal-guard` shell-harness suites:
the former depends on GNU `date -d`, while the latter uses Bash `${name,,}`;
the host provides BSD `date` and Bash 3.2. No queue or Today suite failed.
Current-main build, browser/hosted checks, formal captures, fresh backup/restore,
public merge/deploy and native hardware/customer acceptance remain unrun for
this local candidate.

## Local Progress continuation — 2026-10-18

Application `20eef6ac` adapts the approved Progress study to the existing parent
Analytics route, with canonical data, strict malformed-response recovery and
scoped EN/ES presentation. Full optimized build, typecheck/lint, 7 mounted UI
cases, 8 i18n guards and 29 API/isolation/gamification checks pass. The six-size
EN/light and ES/dark browser matrix passes 15 cases with a test-only main-alert
selector repair; 36 captures are retained. Full local units: 5756 passed, 387
established opt-in skips, 3 known Mac backup-prune failures. Hosted and release
acceptance are pending; child/teen home and persisted quiet mode remain open.
No schema/API, permission, provider/profile/scheduler or native activation occurs.

Current production Family/Notes #576 is separately verified at main `768e4170`;
exact-main checks, protected 71-table restore and deployment559/runtime/public
version/health proof are recorded in #499/#128/#576. Historical release text
below retains its dated scope. Dates #578 is a separate draft continuation.


## Integrated UI web release — 2026-10-18

PR #574 is normally merged at `f1d103a8b68bff4e40b431070c824b239db3bb36`.
Its tree is identical to accepted candidate `641f0714`; original build/image,
Android, every browser viewport, Settings, inventory, profile routine and recovery
workflow passed. A fresh protected backup restored all 71 public tables into an
isolated database before merge, with the temporary database removed. The unchanged
Coolify webhook source deployment 558 (`xdnitf95hzyaeyzzxhtektkd`) finished at
2026-10-18T06:15:35Z. Public version/readiness header, healthy serving image and
container revision, startup migrations, liveness/readiness and anonymous private-
route refusals were verified at that exact SHA. Default-off profile/assistant
flags remain off. All three original exact-main build/image, Android and browser workflows now
passed at f1d103a8, including every required viewport/opt-in aggregate. Public
version was reread at that revision. This serving-runtime and exact-main evidence
is separate from authenticated household/native/customer acceptance. Incorporated PRs #569–#573 are merged with their
original heads/history retained. Retained rollback release is main `9d9e6de6`.


## Earlier approved UI candidate checkpoint — 2026-10-18

GitHub main is verified at `9d9e6de6bce7f7bf7fe3b26e51f2118ce629d1de`
([PR #568](https://github.com/camster91/family-planner/pull/568)). The earlier
production evidence remains attached to that release; no new merge or deployment
is claimed by this entry. #499 and parent #128 track the remaining all-feature
acceptance, with bounded source/rendered evidence in `design/APPROVED_UI_ROLLOUT.md`.

PR #571 has a fresh test-only repair after retained phone traces confirmed
shared-client login 429s: `492206b0` isolates two real sign-in journeys without
changing auth, rate limits or assertions. PR #572's `b986c40d` repairs two localized
verification fallback-focus selectors. PR #573 contains readable localized Chores
actions and long-name reassignment, with local six-size evidence. Their original
hosted runs/protections remain authoritative; constituent heads/history are held
until combined acceptance rather than redundantly merged.

The next Inventory overview candidate on `codex/inventory-overview-499` adds
full-width responsive composition and existing-location shortcuts. Source
`32c72e0b` has 121 affected units, types/lint/build and 95 browser checks passing
across six sizes, with ten inherited phone-only menu skips. It preserves safety,
offline, canonical adjustment/Undo, scan forms and role/household controls. The
combined branch incorporates the test-only login repair. Hosted, exact-main,
recovery and production verification remain pending. No API/schema, profile
capability, provider, scheduler, infrastructure or native/store activation is
introduced. Historical checkpoints below retain their original dated scope.


## Family overview candidate — 2026-10-18

The local Family continuation builds on integrated Inventory candidate `641f0714`
(PR #574). Application `695b6747` preserves the parent-only canonical account
roster, adds responsive localized cards and recovery, rejects duplicate IDs, and
shows create/join guidance when household membership is absent. 44 affected tests,
78 rendered checks including existing startup budgets, types/full lint/build and
independent source/visual review pass locally. Positive removal is synthetic;
real child/cross-household refusals and unchanged roster readback are verified.
No profile flags or API/schema change is included. Whole Family/profile-link,
hosted acceptance and release remain pending under #499/#128.

## Recurring email-free profile candidate — 2026-10-14

Merged source parent is `dadcb015a9fd757727d09820e5ef6cfbcdf62f3d`
(PR #554), with candidate build/image, Android, full browser and six-viewport
profile routine evidence accepted. Its exact-main/runtime release evidence is
tracked in [#480](https://github.com/camster91/family-planner/issues/480#issuecomment-6176025002).

This candidate adds daily, selected-weekday and monthly profile chore series,
bounded event-driven expansion, stable retry bodies, and a retained paused state
when the private recurrence capability is rolled back. Local PostgreSQL and
focused UI/API checks plus independent source review passed. Hosted bundle,
browser, exported-capture and release gates remain pending. The separate
`HOUSEHOLD_PROFILE_CHORE_RECURRENCE_ENABLED` opt-in and all existing production
profile gates remain unchanged. No migration, scheduler, provider, fake login,
profile XP/rotation or durable multi-date routine editor is introduced. Wider
#480 and native/customer acceptance remain open. Older dated entries below are
retained checkpoints.

## Email-free routine candidate — 2026-10-14

The current #480 candidate starts from verified `origin/main`
`b5cb6dd839d3921cc0f20f926962547f00773389` (PR #553). It extends the gated
protocol-2 profile chore path with picture/routine metadata and the existing
parent current-occurrence stack editor. Null account subjects retain stable
member IDs, compatible read refusals and gate checks before receipt replay.
Profile Add step links and legacy grouping preserve the selected person.

[Scope and acceptance](plans/email-free-profile-routines.md) covers all-age
name-only members, draft/retry recovery, isolated PostgreSQL proof and an
additional six-viewport profile-enabled browser gate. Candidate CI, rendered
review and guarded release proof remain pending until recorded in its PR.
Production profile flags and public member protocols are unchanged. Recurring
profile series, conversion, native hardware/store acceptance and the wider #480
outcome remain open. Older dated paragraphs below are historical checkpoints.

## Current release and #499 continuation — 2026-10-14

Verified web main is `9e36c440aa53ad11709e8c7b9517e891646400bf` (PR #548), and deployment 401 served that revision. The same-day routine-order repair is merged and released. [Canonical #499 progress](https://github.com/camster91/family-planner/issues/499#issuecomment-6159917388) records the current alignment state.

The isolated `fridge-fit-499` candidate is prepared in commits `685a2f57` and `18c53bfc`: compact fridge Use Soon row fit plus guarded first-item metadata bounds for weather-present and weather-absent EN/ES journeys. It has source and focused-check evidence only; browser, hosted-QA and integration acceptance remain root-owned.

Combined #549 now integrates the prepared fridge #550 slice and compatible dependency updates (source commits `e0801d5c` and `70358dea`), retaining validated Next 16.3.8. The Next 16.4.0 trial `5f8ecd72` failed the unchanged Today startup limit at 251,433 gzip bytes versus 250,000; measured framework growth was 1,934 gzip bytes, and its unsuccessful locale change was reverted normally. #545 stays open for the held Next upgrade. Fresh combined-source hosted QA and exported synthetic fridge captures are required before acceptance. No new merge, deployment or customer/native/store acceptance is inferred.

## Current bounded UI continuation — 2026-10-13

Accepted web main is `1822a944c575e7d3aff1838690c33aaf6d1299f6` (PR #547). Candidate and exact-main checks passed; deployment 400 served the same healthy revision at `2026-10-13T19:28:19Z`. Protected backup/isolated restore preceded dispatch. Capture issue #472 is closed against verified release evidence; #128/#499 and native/customer acceptance remain open. [Canonical release evidence](https://github.com/camster91/family-planner/issues/472#issuecomment-6153637439).

The next #499 slice stabilizes same-day routine occurrence/member buckets by their existing identity before grouping. Legacy suggested day order and all step, permission and completion behavior remain unchanged. It introduces no timing metadata, schema, provider, scheduler or capability changes. Candidate review, browser and release gates remain pending in its PR. Compact fridge Use soon layout remains a separate recorded follow-up.

## Current quality continuation — 2026-10-13

Accepted web baseline is `ed20d186cb635717aaffdcbe39be54d44d49ce06` (PR #544). Production deployment 399 served that exact image/revision with healthy startup and unchanged capability flags. Normal PR and exact-main build/image, Android and browser checks passed. Coolify Auto Deploy remains enabled: the merge webhook deployed before exact-main CI finished; the verified backup/restore was post-deployment recovery evidence. Owner decision #363 remains open.

The next bounded candidate under #472/#499 retires a mounted capture proposal when receipt reconciliation becomes terminal, preserves unrelated newer previews/photo rows, and registers the existing atomic event/grocery Postgres suites in the protected database gate. It also localizes fridge Use soon presentation with existing inventory copy while preserving food names, expiry rules and layout. Candidate checks and deployment are pending until recorded in its PR; no schema, provider, scheduler, capability or native release changes are included. Broader all-feature/native/customer acceptance remains open.

## Current release and quality review — 2026-10-13

Released main is `ae23f5d8d618732aa6f665b7515ef45071b6e8ce` (PR #539), adding multi-dish bulk-prep sessions, portions eaten with Undo, and next-prep planning. Candidate and exact-main build/image, Android and browser gates passed. Coolify application 11 deployment 398 finished at `2026-10-13T01:13:43Z`; public version/health, serving image/revision, startup migrations, new prep tables/meal-link columns and private-route refusals were verified. A fresh protected backup restored successfully to an isolated database, migrations ran twice without changing existing row counts, and the temporary database was removed. [Canonical release evidence](https://github.com/camster91/family-planner/issues/538).

`HOUSEHOLD_PROFILE_SETUP_ENABLED`, `HOUSEHOLD_PROFILE_CHORE_ENABLED` and `ASSISTANT_TODAY_ENABLED` remain off. No live-household content, paid provider, scheduler, physical-device, store or customer-validation result is implied by the web release. The broader programme remains open under #128/#499/#480/#473/#144.

Cameron requested a fresh agent product-quality review against this released baseline. #499 remains the canonical alignment scope. Review observations and bounded repairs will distinguish source findings, fabricated rendered journeys and customer/native evidence. Older dated execution sections below are retained history; they do not describe the latest release or pending PR state.

## Current execution — 2026-10-09, mounted Settings localization candidate

Latest acceptance checkpoint: [hosted Settings proof and original account-dialog compatibility repair](#2026-10-09-hosted-settings-proof-and-original-account-dialog-compatibility-repair). The earlier candidate paragraphs below are retained execution history; they do not establish current acceptance. Original journey checks are red until the scoped follow-up passes fresh CI.

Accepted main `f7ee5fc3c6d636460be08b29fb3508d25f7f3012` normal-merged #442 exact `e72ac74701eabf4a87827d72d3cc27fc7253c577` after original Build/Test37955318062 and E2E37955318059, including fresh checked image, both unchanged normal viewport/visual shards, distinct ordinary/expanded inventory and existing public QA, actual aggregate and security checks. Exact-head implementing-agent source/rendered COMMENT, current strict/admin/conversation protections and zero unresolved threads were verified; accepted source/tree/parents/ancestry read back. Original441fivecriteria CLOSED with original wording preserved; only accepted owned branch removed.47cleanup PRs merged; remote main only at cleanup. Gallery3907 preserves all2851old objects/pixels/ZIPbytes and adds1056verified source-labelled original hosted captures. Full parent/provider/native/production/human acceptance remains OPEN; current GitHub142/377 acceptance/pickup comments are canonical.

New original #443 owns actual SettingsClient, subscribed/connected calendars, parent Tablet PIN and beta-metrics controls. Typed scoped EN/ES labels and semantic stored feedback preserve private/raw/canonical values, exact existing request/permission/provider policy, draft/disclosure/modal/focus/state and original timers. Exactly162tracked occurrences removed1361→1199, with all other migration records and startup dictionary/guard unchanged. The calendar description helper accepts optional presentation messages using its existing clock/rounding/error policy; its English default and legacy callers remain compatible.

Actual-route regression exposed one-shot OAuth feedback loss: Settings initially mounted household sections, then its profile-loading return unmounted them. Starting the first profile load in the loading state mounts those sections once after completion and retains provider-return notices. Tests verify delayed load, query cleanup, mounted locale/no replay, exact synthetic requests and original2s/2.5s feedback lifetimes. Initial test-only summary-role and rename/refresh transition mistakes were repaired; failed logs remain retained. Replaying the corrected12mounted tests against accepted original five components fails11owned-language/actual-route assertions with1raw-refusal case passing; candidate files are restored byte-identically.

Current app/unit suite passes391suites4740tests in67.827s, with188existing opt-in skips unchanged. Three additional regression-first tests repair English-only Close labels in the password/PIN/remove-PIN Spanish dialogs, preserving all modal lifecycle/focus/consent callbacks. The latest affected run passes16suites135tests; types/lint also pass. Prisma generate/validate, types, lint, repository format, copy guard and diff checks pass. Twenty-nine new mounted/key/ordinary-expanded/clock compatibility tests cover the owned semantic behavior, including unknown inherited object-key regressions; no compiled/rendered/hosted acceptance is inferred. [Evidence and remaining full original gates](testing/SETTINGS_LOCALIZATION.md).

Allfiveoriginal443requirements remain OPEN/unchecked. Distinct current-source ordinary/expanded compilations, guarded fabricated actual-route browser proof across parent/teen/child/second-household phone/portrait/fridge, exact source secrets, original hosted/source/artifact/rendered review, current protections/conversations and normal merge/ancestry remain required. A separate server-child-only Settings QA installer is now implemented: explicit mode/allow/prebuilt flags, unchanged fixture guard plus loopback disposable target, refusal of inherited provider configuration, and a same-server-port transport that refuses external requests/redirects. Forty-three new installer/transport cases and all15existing inventory-stub cases pass, with types/lint; The corrected full suite passes391suites4737tests in69.033s with188unchanged existing opt-in skips. Final source scans, actual-route browser matrix and hosted Settings workflow are still pending. A separate Settings hosted job and drafted actual-route browser matrix now cover both enabled/unavailable modes across EN/ES phone/portrait/fridge. The original normal/public/inventory jobs/triggers/permissions/concurrency/40-minute budgets and Playwright config remain unchanged; all625actual aggregate result combinations pass only for all4success. The harness records real runtime/version/build identity and capture hashes/dimensions/scoped Axe, uses the actual language/native controls, intercepts sensitive actions and verifies actual role/household negatives with guarded fabricated canaries and guaranteed cleanup. These drafts pass types/lint/listing; new exact-source compilation and actual browsers are pending, so no rendered/hosted acceptance is claimed. Historical `.next`/runtime/source backups and failed runs remain separately identified, and the3907gallery is unchanged by this candidate. No real PIN/password/key/token/provider/OAuth/profile/email/production/native/store/human/household mutation or acceptance is claimed.

Actual ordinary phone checks now identify compiled `61884706683a9ebfe8872ae3128d5b9595f32d4d`, tree `f849ad0805750b98ac21277e83897806f113921d`, build `xRMw2FPVgYeQRkWI_3rU9` / actual compiled version timestamp `2026-10-09T18:05:59.582Z`. First full enabled phone run finished22pass/13fail; corrected full run finished31pass/4fail, including all parentA/B/teen/child ENES direct role/household negatives. Harness repairs preserve actual native language/disclosure identity and keyboard input, use real localized login controls, and check full calendar Problem text. All failed reports/traces/images remain retained. These runs use an uncommitted corrected harness against that earlier compiled app, so do not establish final whole-source acceptance.

Targeted native-password/calendar checks then exposed two genuine defects: disabling a focused pending modal submit let Tab leave its focus boundary, and an empty writable-calendar response left Save enabled for an old calendar ID. Three regression-first mounted tests fail against the prior source; bounded fixes recover native Tab to an enabled modal control and disable empty-picker Save without changing canonical provider/API/consent/auth policy. All5affected suites/39tests, types and lint pass. Full unit rerun and a distinct new-source ordinary/expanded compilation/browser matrix remain pending. No reuse of the618compiled app proves these app edits. Allfiveoriginal443criteria remain OPEN/unchecked and the3907gallery remains unchanged.

New-source follow-up full unit run passes391suites4743tests in68.205s, with188existing opt-in skips/38suites unchanged; Prisma generate/validate, types, lint, format and1199copy guard pass. Canonical progress/readback: #443comment6086866584; original five requirements remain unchecked. Regression repair compilation/rendered verification, expanded/full matrix and hosted acceptance remain pending.

At clean5e0d877/tree3fbb989 ordinary source/build0jGtJOJ_oqNRNwiyv9KRr/builtAt2026-10-09T18:29:38.128Z, all35enabled ENESphone checks pass (32owned+3setup), zero retry/skip,1.7min. Portrait/fridge run finishes63pass/4fail in4.0min: the same native picker key gesture fails in both locales/desktop-mode sizes; every other owned/role/household case passes. A focused standalone synthetic HTML select reproduces the failure on Darwin headless desktop with no app code or network: Home/Enter/Escape and ArrowUp/Enter/Escape retain the old value despite focus; mobile mode changes value. Native selectOption changes it on both, but the candidate keeps the keyboard assertion, with key-by-key focus/value evidence, rather than replacing that gate. Failed reports/traces/images and isolated probe `443-native-select-host-probe.json` are retained. Original Ubuntu hosted Settings job must establish the desktop keyboard path; current local evidence does not prove it. New exact whole-source ordinary/expanded compilation and unavailable-mode/full hosted/rendered/protection/merge acceptance remain pending; no partial443capture appended to the3907gallery. Canonical fixed-phone progress is #443comment6086966009, read back with allfiveoriginalrequirements still unchecked.

Draft444head4841975/tree3db090d5 is published/attached. Distinct exact484ordinary0/0 and expanded1/1 local builds pass; ordinary unavailable ENESall3viewport matrix passes69/69/0retry-skip in2.7min. Expanded phone33pass/2fail exposed only a harness expectation omitting the unchanged canonical calendar helper's final period outside expanded text; corrected ENESreconnect/synthetic same-origin sink passes2owned+3setup,9.9s. App/helper/punctuation/timing/provider policy stays unchanged; current corrected harness needs a new exact-head build/CI before final whole-source acceptance. Hosted484Build/Test and checked image37975675138 pass (publication/release expectedskipped); E2E37975675055 remainsin_progress with ordinary Settings/unavailable, inventory and public recovery gate success, desktop native keyboard assertion retained. Final hosted counts/retries/artifact/rendered/source/protection/normalmerge/ancestry/originalclosure remain pending. Allfive443originalrequirements remainunchecked;gallery3907unchanged.

Prior current-state document is preserved verbatim at [the named archive](archive/execution-refreshes/2026-10-09-before-443-current-state.md). Earlier dated candidate sections below retain history.

## Current execution — 2026-10-09, inventory and scan localization candidate

Accepted maina5ecfd9f includes normal-merged #440 exact760814cc after original Build/Test37931431129 and E2E37931431137, actual source-identical ordinary/expanded artifact11616632565/runtimec168d41b, exact source/rendered review and current protections/conversations. Original439allfivecriteria CLOSED; owned branch cleaned.46cleanup PRs merged; remote main only before this candidate. Gallery/ZIP2851 preserves every older object/pixel/archive and adds240actual login/registration views. Earlier dated candidate sections below retain history; live GitHub canonical377/142 acceptance comments carry accepted status.

Scoped #441 implements full owned typed EN/ES inventory/scan presentation and semantic late/visible feedback, preserving canonical helper English exports, raw/private values, role/provider/API policy, request bodies/caps and idempotency. Exactly129owned occurrences removed1490→1361; all other migration records and shared guards/dictionary unchanged. Regression-first mounted tests cover current/late/visible locale changes and semantic Undo. The full suite now passes388suites4668tests with188existing opt-in skips; types/lint/format and exact unchanged-config source-tree/history secret scans pass. [Candidate evidence and remaining original gates](testing/INVENTORY_LOCALIZATION.md).

The first actual phone run exposed root toast context ordering and unchecked scan-row contrast. The candidate places ToastProvider inside the existing I18nProvider, with two regression-first tests against the actual root layout proving visible ordinary/expanded Spanish title/Undo/Dismiss and the original eight-second timer without reset. A dashed unchecked-row border preserves checkbox/confidence state and readable labels/refusals. At b38dcf3a48ac5ad18efa0fe2e73a70da38c90852/tree1c67adb4f87d3fd92a0083f968aef4b7eacea74a, both local ordinary/expanded compilations passed, and all60ordinary inventory journeys across phone/portrait/fridge passed.282ordinary captures have exact state/size/hash/scoped-Axe/runtime verification. Those results identify that earlier source; they do not prove a later whole-tree revision or hosted acceptance.

The first expanded run was stopped after two canonical-write cases exposed an unescaped question-mark regex in a test label. Its failed/interrupted report is retained. The harness now escapes literal translated label prefixes, keeps controlled paging metadata fully canonical apart from synthetic IDs, and uses the native keyboard for location-radio selection. Types/lint/format pass for this correction; rebuilt final-source ordinary/expanded browser and original hosted checks remain required. Existing normal viewport/public recovery job definitions, triggers and permissions compare identically with accepted main; all125aggregate combinations require all three jobs to succeed. Synthetic scan is server-child-only, fixture-guarded, loopback and prebuilt, with15transport/installer tests; no real provider is enabled.

Allfiveoriginal441criteria remain unchecked. No hosted PR/normal merge acceptance or new gallery addition is claimed. Full parent/provider/legal/native/store/production/human/household gates stay OPEN. Next: validate the corrected whole-source browser harness, review rendered evidence, then original hosted/protection/conversation/normal-merge gates. Gallery/ZIP2851, all older source/runtime/failed-run evidence and unrelated work remain preserved. Disk cleanup removes only verified unopened rebuildable caches; historical07d9 and ordinary9dca/b38 runtime backups are retained. Space fluctuates with concurrent work.

Prior valuable current-state source is preserved verbatim at [the named archive](archive/execution-refreshes/2026-10-09-before-441-current-state.md).

## Current execution — 2026-10-09, login and registration localization candidate

Accepted main977ec485 includes normal-merged #438 exact30ef3b5a after original Build/Test37918806584 and E2E37918806534, fresh checked image/security, actual ordinary/expanded source-identical rendered artifact11610639746, exact source/rendered review and current normal protections/conversations. Original437criteria CLOSED, owned branch cleaned.45cleanup PRs merged;48original issues remain open before new439. Gallery/ZIP2611 retains every older object/pixel/archive and adds120actual confirmation views. Nineteen stale remote heads were archived/read back before deletion; differing rebrand9cdf source has all24added/deleted line sets identical to accepted1e7d315, while stable patch IDs differ. Original source retained. Remote now main only until this candidate is pushed; unrelated local branches/worktrees preserved.

Scoped #439 implements typed route-owned EN/ES login/registration copy and semantic fallback/arrival/invitation feedback, neutral resend/check-email guidance, native autofocus/autofill preservation and44px reveal/consent hit areas. Regression-first33cases found25failures; an additional autofill/language regression found the controlled registration email reset. Uncontrolled DOM email now preserves password-manager input; invited email remains authoritative in canonical state and request payload. All34mounted cases plus10key/pseudo cases pass; affected22suites170tests and full381suites4612tests pass105s (188existing opt-in skips). Prisma generate/validate, types, lint and format pass. Only14owned copy occurrences removed1504→1490; shared dictionaries/helpers/APIs/guards/policy unchanged.

New anonymous browser cases use intercepted synthetic auth/resend/invitation values, EN/ES phone/portrait/fridge, actual runtime identity, scoped accessibility, keyboard/focus/44px/hit/reflow, and separate original ordinary/expanded compilations. Only two existing public QA commands append this spec; normal viewport/visual/recovery/confirmation/budget/fixture/guard/aggregate controls retained; structural check and25aggregate combinations pass. Hosted source/build/rendered acceptance and normal merge are pending. Historical local07d9compile cannot prove this source; low local disk prevents a safe replacement build. Original #439 criteria remain unchecked, all full parent/provider/legal/native/store/production/human/household requirements remain open. [Candidate evidence and limits](testing/AUTH_ENTRY_LOCALIZATION.md).

Prior valuable current-state source is preserved verbatim at [the named archive](archive/execution-refreshes/2026-10-09-before-439-current-state.md). Dated sections below retain execution history; live GitHub canonical377/142 latest acceptance comments carry current status.

## Current execution — 2026-10-09, email-confirmation selector correction

#438originalc25public QA ordinary build passes but6confirmation cases fail on ambiguous global alert selector; artifact11610488284 retained. All6existing recovery cases pass, expanded steps skipped. Genuine selector correction scopes alerts/status to confirmation panel with all expectations/states/requests/guards unchanged. Newly corrected source requires original hosted/rendered acceptance; no red merge.

44 cleanup PRs normal-merged; accepted main12e35cfef8a85be355d49f97f21ee1d31dbecea4 includes #436 exact4dbe after original Build/Test37913613858 and E2E37913613866 all viewport/visual/dualQA/aggregate/fresh image/security/manual/current protections/conversation gates. Original434fivecriteria CLOSED; both owned recovery branches cleaned and superseded435source retained in pushed archive tag. Gallery/ZIP2491 preserves all older objects/pixels and adds132actual current-source ordinary/expanded recovery views. Full parent/provider/native/production acceptance remains open.

Scoped issue437 is implementing typed EN/ES explicit email-confirmation presentation. Ten regression-first cases failed against the old page; all67 affected mounted/key/expanded/helper/API/inventory tests now pass. Only8tracked owned occurrences removed,1512→1504. Canonical helpers/API/token/raw POST count/body/explicit-click scanner safety/outcomes/retry/redirect remain unchanged. Existing dual public QA commands add six anonymous confirmation cases per mode; all other workflow/ordinary matrix/recovery/budget/guard/aggregate controls preserved. Fresh Prisma generate/validate/types/lint/format and379suites4568tests pass62.455s/188existing skips; typed loading helper correction preserves shared key guard. Correct-root unchanged-config tree secrets pass. Original exact-source build/browser artifacts, rendered review, hosted/security/protection acceptance and normal merge remain pending. Historical local07d9 compiled output cannot prove this new source.

Prior current-state document preserved verbatim at [the named archive](archive/execution-refreshes/2026-10-09-before-437-current-state.md); older dated sections below are history.

## Current execution — 2026-10-09, password recovery candidate

Current correction:43cleanup PRs normal-merged; main5a1ba65db11c60387f1f76f145acca4c70d83c82 accepted #433 exact758bd874 at09:39:37Z after original integrated Build/Test37909865680/E2E37909865682/fresh image/security/manual/current normal protections/conversations. Original432fivecriteria CLOSED; owned docs branches/worktree cleaned. #43583f97167 is held after GitGuardian classified translated example-email/password-label display copy; no credential/exception/red merge claim. A fresh genuine reserved-domain repair candidate from accepted main is prepared; earlier source/build/browser evidence below is historical. Its exact source dual ordinary/expanded hosted artifact is mandatory before #434closure. Delivered2359gallery/ZIP now preserves all2293older objects/pixels and originalZIP bytes plus66ordinary recovery views; final corrected-source132views remain pending.

42 cleanup PRs normal-merged. Main `1587b45502f196f8f8208159727265648615aef4` accepted #431 exact414179ed at09:11:32Z after original Build/Test37906697106, E2E37906697193 both viewport/visual/aggregate, fresh checked image/GitGuardian, exact-head manual source COMMENT/current strict-admin-conversation protections/0unresolved threads. Original430fivecriteria checked/CLOSED; exact owned account branches cleaned. Source COMMENT is implementing-agent review, not independent human approval.

Plan #433 integrated main and corrected accepted account status at exact758bd8744ea6d3d3123de4941acae97e0601dc6c. New original Build/Test37909865680 and E2E37909865682 are running. Earlier8ff7ae4checks passed separately; they do not substitute for integrated-head acceptance. The initial immediately-after-push COMMENT landed on priorhead due propagation lag; explicit newcommit review and readback corrected it. Original432criteria remain unchecked.

Local #434 recovery candidate actual ordinary07d9b3c4/built09:01:24.613Z passes377suites4551tests, affected/mounted/autofill/key/source-copy/API guards, common/build/secrets,6ordinary ENESanonymous journeys/66captures and36unchangedJSbudgets. Inventory1524→1512 removes12owned occurrences only. Expanded public pages require a distinct QA compilation; runtime restart did not expand staticHTML and local QA build hit ENOSPC. Ordinary compiled output and all evidence/unrelated work are retained. A separate isolated expanded CIjob and mandatory two-result aggregate are prepared with original ordinary controls/tests unchanged; exact structural and25-state aggregate checks pass. No expanded/rendered/gallery/remote acceptance is claimed yet. [Full proof and limitations](testing/PASSWORD_RECOVERY_LOCALIZATION.md).

Delivered gallery/ZIP2293 unchanged verified images remains available; new66ordinary recovery captures are separately retained until hosted expanded artifact verification and final append. Owned app/PG stopped,3161/55437 empty. Primary dirty/aux worktrees preserved; fresh primary dirty enumeration remains unverified after its stalled owned read was interrupted. Previous dated summary is [archived verbatim](archive/execution-refreshes/2026-10-09-before-434-current-state.md).

Full #142/app/date/units/RTL/human/legal/native/store and #134query/contracts/load, provider/production/sender/cron/hardware/research/real-household gates remain OPEN. Live GitHub records carry current execution status. No live recovery email/password or production/native/full-app acceptance inferred from fabricated QA.

## Release route reconciliation — 2026-10-07

The older sections below are historical source/CI snapshots, not instructions to deploy through SSH. Protected `main` is the current release branch. Deployment records #362/#363/#377 identify the existing production route as Coolify source builds triggered by main merges. Current public `/api/version` was read as `a243bd5b297bc1c02072451866722dc0c7061402`, built `2026-10-07T16:29:41.068Z`, and `/api/health` as healthy before PR #379. PR #379 subsequently merged normally as `a80c4753bba6f9aa5f978d4a9cff4ee039f97d44`; its exact production revision is now reported by `/api/version` (built `2026-10-07T18:17:37.600Z`), health is healthy and all 26 approved public asset hashes match. Authenticated child acceptance remains an approved-test-identity gate.

GitHub Build & Test, E2E and checked-image validation are source-candidate gates; the checked CI image is **not asserted** to be the image Coolify rebuilt. Do not dispatch the separate `Release to VPS` workflow or enable immutable publication during this work. No Auto Deploy, secrets, proxy, backup or routing setting was changed. #363 remains the separate deployment-policy decision; #343 additive network preparation is now included under Cameron’s subsequent “merge all” instruction; the live #342 database cutover and destructive #254 remain separately gated, and all seven Hermes cron jobs stay paused.

Canonical execution/evidence: `engineering/COMPLETION_CONTRACT.md`, `engineering/CI_AND_RELEASE.md`, `runbooks/COOLIFY_DEPLOY.md`, `DEPLOYMENT.md`. Authenticated production journeys, actual retained image/rollback control access, real backup restore, email and hardware evidence remain open.

## Planning and baseline

- PR #129 (`plan/fridge-tablet-program`) **merged on 2026-09-23** as merge commit `2538499`. The canonical planning files (`AGENTS.md`, `docs/START_HERE.md`, `docs/engineering/**`, `docs/FRIDGE_TABLET_PROGRAM.md`) are on protected `main` (the former `master`).
- PR #101 (`codex/launch-readiness-gaps`, head `c19121d`) and the reconciliation candidate PR #172 were both **closed without merging on 2026-09-23**. The per-change disposition of #101 is recorded in [`decisions/PR101_DISPOSITION.md`](decisions/PR101_DISPOSITION.md) (#167 closed on 2026-09-29 after the owner-approved provisional disposition in #290).
- PR #116 (CI noise reduction) merged as `aae427a`.

## Merged on master since the baseline

First-parent history from #221 (`cd1d78c`, 2026-09-24) to `32f10d0`:

| Commit    | Date  | PR   | What                                                                                                                  |
| --------- | ----- | ---- | --------------------------------------------------------------------------------------------------------------------- |
| `784b40b` | 09-24 | #228 | Repository review fixes: security, household isolation, chores/XP, dates, infra                                       |
| `68843ff` | 09-24 | #229 | Household isolation audit of every API route + two-household fixtures                                                 |
| `a67570d` | 09-25 | #230 | Playwright E2E gates, docs reconciliation                                                                             |
| `b564b87` | 09-25 | #231 | E2E-found bug fixes                                                                                                   |
| `4ea4867` | 09-25 | #233 | Remove remaining placeholder data                                                                                     |
| `ada5ca3` | 09-25 | #234 | WCAG AA tokens, grocery fixtures + E2E, **Android security tests (replacing the generated `Example*` tests) and AAB** |
| `de87123` | 09-25 | #235 | Role and isolation decisions (#102) + read-only ICS import (#232)                                                     |
| `862f447` | 09-25 | #236 | Chore photo upload ownership (D3)                                                                                     |
| `8e4f4b2` | 09-25 | #237 | Today board for the fridge tablet (#119, #159)                                                                        |
| `403535c` | 09-25 | #239 | Shared-device session contract (#157, ADR-0006)                                                                       |
| `b8d50e4` | 09-26 | #243 | Shared device: schema, device auth and API (#240)                                                                     |
| `0347f28` | 09-26 | #244 | Login timing check fix                                                                                                |
| `ca9db39` | 09-26 | #245 | Shared device web UI (#241)                                                                                           |
| `2fd6cc5` | 09-26 | #246 | Android cookie flush on pause; Back backgrounds `/device` (#242, code only)                                           |
| `e292cd1` | 09-27 | #247 | Sync foundation: idempotency records and bounded offline queue (#162)                                                 |
| `77b7c03` | 09-27 | #249 | ADR-0007 canonical meal/recipe/grocery/list models (#149)                                                             |
| `c42174f` | 09-27 | #255 | Points/streaks/leaderboard become an opt-in family setting (#248)                                                     |
| `d913799` | 09-27 | #256 | Canonical schema expand + dry-run backfill tooling (#250)                                                             |
| `716006f` | 09-27 | #257 | Meal/recipe/grocery APIs on canonical models (#251)                                                                   |
| `10b8f3c` | 09-28 | #258 | Recipe ingredients to groceries, idempotent with undo (#253)                                                          |
| `8561736` | 09-28 | #259 | Meals and grocery UI on canonical models (#252, code only)                                                            |
| `9acc064` | 09-28 | #266 | Two-way Google/Outlook calendar sync, off until configured (#264)                                                     |
| `87df41f` | 09-28 | #267 | Food inventory with expiry, "use soon", "what can I cook" (#263)                                                      |
| `57909e0` | 09-28 | #275 | Parent-only fridge photo scan, off until configured (#265)                                                            |
| `ce6203c` | 09-28 | #276 | FridgeCal-style 16:10 fridge hub, member colours, opt-in weather, Use soon tile (#262)                                |
| `baf165e` | 09-28 | #277 | Review-first event import from text, photo or PDF (#270)                                                              |
| `211523e` | 09-28 | #278 | Grocery lists sorted by store section (#273)                                                                          |
| `63ec7c4` | 09-28 | #279 | One calm home, five tabs, Undo instead of confirm (#268, #269)                                                        |
| `cbef026` | 09-28 | #280 | Picture routines for young kids; parent Verify/Reject that change the chore (#272)                                    |
| `32f10d0` | 09-29 | #281 | Visible sync ("Updated N min ago", change polling) and the calm fridge display with night hours (#271)                |

Earlier merges on the same line include #221 (hosted build), #226 (server-side feature gates), #224, #223, #222, #220, #173 (#168 lookup rate limit), #116 and #129.

## Verified source baseline

- Exact dependencies/scripts: `package.json`; schema: `prisma/schema.prisma`. Do not copy version numbers into prose.
- Auth: self-hosted JWT/session. `src/lib/supabase/server.ts` is legacy-named and is not proof of Supabase auth.
- Android: Capacitor project under `android/`, `applicationId` `com.ashbi.familyplanner`, `versionCode 1`, `versionName "1.0"` (`android/app/build.gradle`). The generated `ExampleUnitTest`/`ExampleInstrumentedTest` were removed in #234. Current tests: `ManifestSecurityTest`, `CapacitorConfigSecurityTest`, `SharedDeviceNavigationTest` (JVM) and `AppIdentityInstrumentedTest` (instrumented). Versioning policy and build commands: [`architecture/ANDROID.md`](architecture/ANDROID.md).
- Deployment path: `release.yml` `Release to VPS` runs only on manual `workflow_dispatch` on the default branch and uses `.github/scripts/deploy-over-ssh.sh` / `deploy-vps.sh`. See [`engineering/CI_AND_RELEASE.md`](engineering/CI_AND_RELEASE.md).
- Legacy deploy path: `scripts/webhook-receiver.sh` is not supported and must not be installed without Cameron's approval.
- Scheduled jobs: no workflow has a `schedule:` trigger.

## CI

Workflow files on `master`: `release.yml`, `e2e.yml`, `apk.yml`, `auto-merge.yml`, `stale-issues.yml`.

| Workflow                         | GitHub state (API, 2026-09-29) | Role                                                                                                                                                                                                                                       |
| -------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `release.yml` — `Build & Test`   | active                         | **Required check** (branch protection observed 2026-09-24, see CI_AND_RELEASE.md). Passed on master pushes for #278 (`211523e`) and #279 (`63ec7c4`); #280 (`cbef026`) and #281 (`32f10d0`) passed Build & Test and E2E on their PR heads. |
| `release.yml` — `Release to VPS` | active                         | Manual dispatch only; production deploy, owner-gated.                                                                                                                                                                                      |
| `e2e.yml`                        | active                         | **Informational**, not required (the workflow's own header comment). Passed on `211523e` and `63ec7c4`.                                                                                                                                    |
| `apk.yml`                        | **`disabled_manually`**        | Last run 2026-09-08 (run 177, PR #101 head `ef75581`). No Android CI runs on master changes until it is re-enabled.                                                                                                                        |
| `auto-merge.yml`                 | `disabled_manually`            | Not in use.                                                                                                                                                                                                                                |
| `stale-issues.yml`               | `disabled_manually`            | Manual-dispatch only anyway.                                                                                                                                                                                                               |

GitHub also still lists a `VPS Docker probe` workflow (`vps-docker-probe.yml`, `disabled_manually`) whose file is no longer on `master`.

## What is on and what is off by default

Server kill switches and provider keys, from `.env.example` (local) and `.env.production.example` (production template):

| Feature                                                  | Env                                                                                                                                                                                                                            | Local template          | Production template | Also needs                                                                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Shared household tablet (#157/#240/#241)                 | `SHARED_DEVICE_ENABLED`                                                                                                                                                                                                        | `false`                 | `false`             | Cameron's approval to turn on; when off every `/api/device/*` route returns 404 and device cookies are ignored          |
| Today board weather via Open-Meteo (#262)                | `WEATHER_ENABLED` (on only for `1`/`true`)                                                                                                                                                                                     | `true`                  | `false`             | Each household opts in in Family settings (default off); Open-Meteo terms review in `product/THIRD_PARTY_PROCESSORS.md` |
| Two-way calendar sync (#264)                             | `CALENDAR_TOKEN_KEY` (+ `CALENDAR_TOKEN_KEY_PREVIOUS`), `APP_URL` or `NEXT_PUBLIC_APP_URL`, and per provider `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` or `MICROSOFT_CLIENT_ID`/`MICROSOFT_CLIENT_SECRET` (`MICROSOFT_TENANT`) | commented out (dormant) | empty (dormant)     | OAuth app registration; runbook `runbooks/CALENDAR_SYNC.md`                                                             |
| Fridge photo scan (#265)                                 | `INVENTORY_SCAN_ANTHROPIC_API_KEY` (`INVENTORY_SCAN_MODEL`, `INVENTORY_SCAN_DAILY_LIMIT`)                                                                                                                                      | commented out (off)     | empty (off)         | Paid provider: Cameron's approval; route 404 and button hidden while unset; runbook `runbooks/INVENTORY_SCAN.md`        |
| Event import from text/photo/PDF (#270)                  | `EVENT_IMPORT_ANTHROPIC_API_KEY` (`EVENT_IMPORT_MODEL`, `EVENT_IMPORT_DAILY_LIMIT`)                                                                                                                                            | commented out (off)     | empty (off)         | Paid provider: Cameron's approval; route 404 and Import hidden while unset; runbook `runbooks/EVENT_IMPORT.md`          |
| Cron endpoints (recurring chores; morning summary, O-40) | `CRON_SECRET`                                                                                                                                                                                                                  | empty (fails closed)    | empty               | Scheduling needs Cameron's approval (AGENTS.md); morning summary steps: `runbooks/COOLIFY_DEPLOY.md` "Scheduled tasks"  |
| Rate-limit client address                                | `TRUSTED_PROXY_HOPS`                                                                                                                                                                                                           | `1`                     | `1`                 | Must match the real proxy chain at deploy; the server warns at startup while unset (`src/lib/env-check.ts`)             |

Per-household feature flags (`src/lib/features.ts`): a new household starts with only `chores`, `calendar`, `lists`, `family`, `meals` and `emergency` on (O-38, owner decision 2026-10-03, `decisions/PROVISIONAL_OWNER_DECISIONS.md`). Every other flag defaults off for new households. Households that existed before keep what they had through `legacyDefault`: `gamification` (points/streaks, #248) and `notes`, `anniversaries`, `rewards`, `budget`, `projects`, `messages`, `analytics` (O-38) read as on when the stored blob lacks the key. `inventory`, `wishlist`, `locations`, `pickups`, `allowance`, `travel`, `handoff` and `sick-days` are off for new and existing households alike. `rewards` and `analytics` require `gamification`. A parent turns sections on in Features or from the "Turn on more" card on the Today board.

## Canonical data (ADR-0007)

[ADR-0007](architecture/adr/0007-canonical-meal-recipe-grocery-models.md) (accepted 2026-09-27): `FamilyMeal`, `Recipe`/`Ingredient`/`RecipeIngredient` and `List`/`ListItem` are canonical; `MealPlan`, `MealPlanEntry`, `ShoppingList`, `ShoppingItem` are frozen legacy tables. Children A–D (#250–#253) are merged. The production backfill run and the destructive contract (#254) are both still owner-gated. Route-by-route mapping: [`refactor/ROUTE_AND_DOMAIN_INVENTORY.md`](refactor/ROUTE_AND_DOMAIN_INVENTORY.md).

## Historical owner-gate inventory — 2026-09-29

Use #377 and the current issue records for today’s owners and resume conditions. This inventory is preserved for history; closed disposition records and the old SSH route are superseded by the refresh above.

1. **#254 destructive contract** of the legacy meal/shopping tables: gated on the backfill, a zero-legacy-traffic release cycle, a verified backup and Cameron's explicit approval.
2. **#242 Android device evidence**: pairing, cold/warm launch, rotation, process kill and revoke on a real Samsung-class and stock tablet. Code merged in #246.
3. **Production backfill run** (`runbooks/MEALS_GROCERIES_BACKFILL.md`): even a production dry-run needs approval for that run.
4. **Deploy**: the old `b408170`/SSH snapshot is superseded by the Coolify source-build reconciliation above. Current-main live verification, actual rollback control and proxy evidence remain open (#363/#364/#367); do not dispatch the separate SSH release job.
5. **AI keys and spend caps**: `INVENTORY_SCAN_ANTHROPIC_API_KEY` and `EVENT_IMPORT_ANTHROPIC_API_KEY` stay empty until Cameron approves the provider and sets provider-side spend caps and the `*_DAILY_LIMIT` values.
6. **Open-Meteo terms review** before `WEATHER_ENABLED` goes on in production (`product/THIRD_PARTY_PROCESSORS.md`).
7. **Calendar OAuth app registration** with Google and Microsoft, then the calendar-sync envs.
8. **#252 design review** of the shipped meal/recipe/grocery views against the FridgeCal reference (`design/REFERENCES.md`), or recorded acceptance of the current composition.
9. **Email forwarding** for event import: choose an inbound-mail provider and set MX/DNS (`architecture/CALENDAR_IMPORT.md`, "Email forwarding (dormant design)").
10. **Re-enabling `apk.yml`** (and configuring Android signing secrets if release builds are wanted).
11. **Beta recruiting (#287)**: recruiting design-partner households, and running `npm run beta:scorecard` against production (`BETA_SCORECARD_ALLOW_REMOTE=1`), need Cameron's approval. Each beta household's parent turns on "Share beta usage counts" (off by default).
12. **Amend any provisional decision** in `decisions/PROVISIONAL_OWNER_DECISIONS.md` (O-15 to O-31, the #101 disposition, #252) that turns out wrong.

## Historical implementation ledger — through 2026-10-01

Everything listed here before 2026-09-30 has merged: notification preferences (#286), audit history (#285), beta usage counts (#287), observability and privacy-safe logs (#299, #301, #302), the design gallery (#303), restore rehearsal (#288), household search and deletion, and the route inventory follow-ups. Merged on 2026-09-30:

- #313: Coolify deploy runbook (`runbooks/COOLIFY_DEPLOY.md`), `SOURCE_COMMIT` fallback and a writable uploads folder in the image. At that snapshot Coolify was planned; the current route is described in the dated reconciliation above.
- #314: beta operations packet (`product/BETA_OPERATIONS.md`), Mailgun email runbook (`runbooks/TRANSACTIONAL_EMAIL.md`), a daily backup timer ready to install and backup retention that matches the privacy page (`runbooks/BACKUPS.md`).
- #315: real-user readiness fixes (joining with an existing account, case-insensitive sign-in, "Forgot your password?", login notices, same-origin redirects only, blank names rejected, calendar end time kept, kid-view and invite errors shown, production env check at start), page views no longer stored, secret scanning in `Build & Test`, "N ingredients missing" on the Tonight card, and narrow-screen/zoom checks (`e2e/reflow.spec.ts`).
- #316, readiness follow-ups: honest beta pricing copy (O-23), a confirm step before an email verification link is used (O-24), unused code removed (O-25), error handling on the off-by-default feature pages (O-26), decisions O-27 to O-31, `.input-field`/`.card` styles that older pages used but were never defined, and the new-household sign-up E2E journey (`e2e/signup.spec.ts`).

Merged on 2026-10-01:

- #317: the checked image is tested again on a fresh runner (database, release identity, upload ownership, sign-in and two-household checks). A publish step exists but stays off until the owner turns it on.
- #320: the activity feed shows "event added" and "events imported" rows again; unused code removed.
- #321: older chore history loads with "Load more"; a parent Help page and the support runbook (`runbooks/SUPPORT.md`); per-member quiet hours (O-32); beta SLOs (`engineering/SLO_AND_PERFORMANCE.md`) and a test that keeps every API error in the `{ error }` shape.
- #322 and #323, fixes from two full review passes:
  - Repeating chores keep repeating (O-33), and the project page no longer crashes.
  - Dates and times show on the right day: handoffs, birthdays, budget, travel and the calendar month.
  - The calendar has month links and event delete. Kid home shows only today's missions.
  - Failed actions show an error instead of failing silently.
  - Logging a medicine dose no longer guesses the next dose.
  - Bad input gets a 400 instead of a 500 on about twenty routes.
  - Parents can remove a household member and get a new family code (O-34).
- #324, third review pass:
  - The server can no longer be steered to internal addresses (SSRF), and another website can't sign someone into the wrong account (login CSRF).
  - Uploads have a rate limit, a 500 MB household quota and cleanup after 30 days (O-35).
  - AI capture calls time out after 30 seconds, and `X-Real-IP` is trusted only behind a declared proxy.
  - The kid page gate uses the real path, the English/Español switch works, and wishlist labels are fixed.
  - About 2,000 lines of unused code are gone, and more routes answer bad input with 400.
- Fourth review pass (historical ledger):
  - Outbound calls are now protected against DNS rebinding (the address that was checked is the address connected to).
  - Rewards can be claimed and marked as given, and analytics shows real data.
  - Budget transactions can be edited or deleted, and sick days update right away.
  - Sharing a handoff no longer breaks the sitter's link.
  - Screens no longer differ between server and browser, and dialogs, labels and touch targets are accessible.
  - "Download my data" now includes every personal record, and a removed member gets no more points or notices.
  - Repeating chores no longer depend on the server's time zone.
  - Backups can't look valid when the dump failed, and a restore stops at the first error.
  - The schema matches the database, with a check in CI.
  - The Coolify image job now runs on `master`, and Android version numbers come from CI.

What is left before real families use the app, and who does it: [`LAUNCH_CHECKLIST.md`](LAUNCH_CHECKLIST.md).

## Approval state

Documentation and non-production implementation may proceed in reviewed PRs. This snapshot does not authorize a merge, production deployment, Play publication, secrets/DNS/access/billing changes, spending, participant outreach or destructive production data changes.

## 2026-10-09 hosted Settings proof and original account-dialog compatibility repair

Candidate7df1c6b/treefd7f9a67 original Build/Test37977844420 and checked image PASS:391suites4743tests,188existing opt-in skips,147database-backed tests plus original fixture/import gates. Original E2E37977844415 compiled merge revisionbc064e0b/treefd7f9a67, exactly the same source tree with parents acceptedmainf7ee5fc3 and7df. Settings artifact11640404734 strictly verifies336checks (324owned+12setup),1044captures,zero retries/skips and12native picker keyboard cases. Distinct ordinary buildqX6buDh-JpsXdGLKJbvrU/builtAt2026-10-09T19:07:23.128Z and expanded buildxwl10cWsFLuQiueqDSpXJ/builtAt2026-10-09T19:23:17.993Z each match enabled/unavailable mode proofs. Full exact case/role/scenario-locale/project/state/hash/dimensions/scoped serious-critical Axe/source-tree/build/runtime/availability identities pass. Ten representative actual Settings PNGs were viewed, including masked password/PIN and expanded AI/picker/subscription forms; not every image or independent human acceptance. Scenario locale labels identify initial runtime language; captures after mounted language changes may visibly show the other language. Child dashboard body localization remains under142.

Original inventory/recovery artifacts11639866923/11639704461 also verify120inventory cases/564PNGs and48public cases/492PNGs with distinct ordinary/expanded builds,zero retries/skips and exact state/source/hash/size/Axe identities. Original normal visual steps pass without baseline regeneration. Both normal journey shards fail six Spanish parent/teen account-dialog entry cases because the older localization spec searches exact English Delete Account; actual error-context exposes Eliminar cuenta. Those original attempts/retries, reports/screens/traces are retained. Original aggregate remainsFAIL; no red merge or closure.

The bounded repair changes only that original spec: typed Settings deletion-entry copy with exact matching, plus typed expanded accessible labels for its existing real-native teen sign-in fixture. The first local expanded rerun passes15/21 but fails all6teen cases at the old shared helper English Email selector; that regression evidence is retained. The scoped sign-in adaptation keeps actual native fields/button and canonical fixture credentials, dashboard/auth checks, all104original assertion ASTs and26guard/interception/capture/offline/cleanup ASTs; shared helper, app/API/schema/dependencies/fixtures/workflow/Playwright/pins/timeouts/retries/skip lists and visual baselines are unchanged. Corrected full original ENESparent/teen/child three-viewport expanded run passes21/21 (18owned+3setup),zero retries/skips,1.8min against explicitly historical484expanded compiled app with unchanged app inputs. Types/lint/format pass. No old compiled app or old-head hosted proof substitutes for final follow-up-head whole-source CI/review/normal merge.

All3907gallery objects/pixels/current ZIPmetadata and CRC are verified; named444-gallery-before-3907 APFSclone preserves exact old archive bytes before any append. Gallery remains unchanged until final new-head source/artifact/rendered review and acceptance. Original443fivecriteria remainOPEN/unchecked; full broad provider/production/native/store/legal/human/household requirements remainOPEN.
