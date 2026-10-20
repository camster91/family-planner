# Current State

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
