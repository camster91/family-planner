# Route and domain inventory (#148)

### Remaining tracked copy disposition and list cover — 2026-10-24 (#142)

List-detail image alt now uses the actual list name instead of appending English
“list image”; its read gate/URL/dimensions/layout remain unchanged. One owned
record is removed. `REMAINING_COPY_DISPOSITION.md` classifies100 retained records/
103 recorded occurrences:75 legal records,4 source/mapping records,7 licence/
barcode records,12 numeric/unit/input examples and2 print-CSS records. These are
retained, with guard configuration unchanged. No new scan, exhaustive translation
claim or legal content change. Other inline/API/metadata/provider copy and all
original locale-data/layout/store/runtime criteria remain open, as does #372's
operator/legal decision. No new copy-only tests; existing cases unrun. No QA/test/
check/build/browser/API/database/native/provider/permission/release ran.

### Recipe-grocery add result matching — 2026-10-24 (#134)

Add success now requires bounded nonempty receipt/list IDs, safe nonnegative
counts with a safe sum, valid unique ingredient/matched-item preview IDs and no
more preview entries than created items. An explicit destination must match the
server-normalized original list captured before waiting; unspecified destination
retains canonical default-list selection. Later caller mutation cannot change
that expected target or the frozen request body. Existing optional expiry and
idempotent replay/retry/owned recovery remain; malformed/foreign summaries use
the prior unconfirmed retry classification. This is not owner/source proof or a
full recipe snapshot/version receipt. Malformed/destination/caller-mutation and
same-key recovery regression source authored/unrun. No QA/test/check/build/
browser/API/database/native/provider/permission/release ran. Original replay/
role/compatibility/concurrency/locale/runtime acceptance remains open.

### Recipe-grocery reply validation/deadline — 2026-10-24 (#134)

Undo's browser helper now validates the exact original request ID and nonnegative
safe integer removed/kept counts. A malformed/missing/foreign2xx stays retryable
and unconfirmed; the existing UI keeps its receipt/owned Undo path instead of
claiming success. Add and Undo share a15s per-attempt fetch/body deadline. Abort
is best effort; a timed-out server may still commit and a late body cannot
replace the settled outcome. No timeout-driven fresh request or automatic Undo
retry is added; Add's existing explicit in-progress retries/body/key remain.
Server routes/auth/idempotency/expiry and transport string interfaces remain.
Malformed/foreign replies, ignored-abort header/body stalls and UI same-Undo
recovery regression source authored/unrun. No QA/test/check/build/browser/API/
database/native/provider/permission/release ran. Actual replay/authorization/
concurrency/rollback/transport/locale/native/runtime acceptance remains open.

### Dashboard fallback and landmark copy — 2026-10-24 (#142)

Today/Budget/Activity missing-household presentation, signed-out shell, skip link,
main accessible name and shared FormSheet fallback instructions use15 scoped
core EN/ES keys. Small presentation-only client components receive only a static
page kind; original server session/role/feature/read gates and household fields
remain on the server. Main stays a server element and references one localized
screen-reader span by ID. Classes, heading levels, original Today create/join
links and custom sheet labels/descriptions stay canonical. FormSheet's busy/back/
inert/scroll/owned-navigation behavior is unchanged. Fourteen owned inventory
records removed without scanning. Existing shell assertions now follow the
labelled-by reference; Spanish name/skip-target case authored/unrun. No QA/test/
check/build/browser/API/database/native/provider/permission/release ran. Static
route metadata and original hydration/navigation/role/accessibility/layout/runtime
acceptance remain open.

### Calm-screen, weather and preference status copy — 2026-10-24 (#142)

AmbientCover uses typed Today keys for accessible time, next-event prefix,
tonight and wake instruction. Its weather summary uses the existing main-board
locale mapping. Visual weather high/low abbreviations also use Today keys;
canonical temperatures/units/labels and existing accessible weather descriptions
remain. DisplayPreferencesStatus and QuietDisplayControl use ten scoped core
translation keys while keeping the original status precedence, switch gating
and provider save/refresh callbacks. No focus/wake/dimming/photo lifecycle,
clock/date formatting, weather request or preference protocol change. Ten owned
copy inventory records removed without scanning. No new copy-only tests;
existing cases unrun. No QA/test/check/build/browser/API/database/native/provider/
permission/release ran. Original shared-device/preferences/recovery/locale/layout/
runtime acceptance remains open.

### Barcode capture and cooking-preview copy — 2026-10-24 (#142)

BarcodeFoodDialog now uses64 typed scoped EN/ES keys. Controlled local feedback
stores key/params rather than a sentence captured by an old render; actual
product names remain literal and display counts use locale formatting. Existing
camera/visibility/permission lifecycle, metadata requests, ownership, exact intake
request/key and uncertain-save/recovery behavior remain unchanged. Locale/text
are not added to existing effect dependencies. Barcode formats, canonical samples
and Open Food Facts/ODbL/CC BY-SA attributions stay literal and tracked. Recipe
cooking-preview labels/help use four typed recipe keys, with original numeric
draft validation, scale helper and reset dependencies retained. Seven owned recipe
inventory records removed without scanning; barcode technical/licence records
are retained. A typed-draft/semantic validation/locale/no-extra-action case is
authored/unrun. No QA/test/check/build/browser/API/database/native/provider/
permission/release ran. Full camera/stock/privacy/recovery/locale/layout/runtime
acceptance remains open.

### Getting-started and routine-origin copy — 2026-10-24 (#142)

GetStarted uses13 typed onboarding keys for three step labels/hints, progress,
Hide/Undo and accessibility copy. The onboarding hook now delegates to shared
scoped translation with optional params and a stable callback; outside-provider
English fallback remains. RoutineOriginEntry uses four scoped routine keys,
preserving actual source labels/day IDs, origin URLs, copiedAt values and date
formatting. Parent eligibility, household storage key/visibility hydration,
completion facts, Hide/Undo callbacks and all fetch/effect dependencies remain.
No request, identity or household adoption is introduced by translation. An
already emitted Undo toast keeps the existing string contract. Fifteen owned
copy inventory records removed without scanning. No new copy-only tests;
existing cases unrun. No QA/test/check/build/browser/API/database/native/provider/
permission/release ran. Original onboarding/role/recovery/locale/layout/runtime
acceptance remains open.

### Bulk-reuse and app-guide scoped copy — 2026-10-24 (#142)

BulkCookingPanel's invalid/unprepared/full/unavailable reuse feedback, dismissal
and food-review link now use six typed bulk keys. AppGuide's header, description,
search/clear/placeholder and empty copy use six Help keys. Existing ordinary
EN/ES wording remains; Help's translator now delegates to shared scoped copy
with a stable callback, including pseudolocalization. Other HelpContent/guide
consumers only render this copy; no locale-driven read effect is added. Role/
feature filters, search draft, draft-aware links, prepared-reuse identity/state,
recovery gates, actual names and date formatting stay canonical. Twenty owned
inventory records removed without scanning; no new copy-only tests, existing
cases unrun. No QA/test/check/build/browser/API/database/native/provider/
permission/release ran. Broader layout/search/role/recovery/locale/runtime
acceptance remains open.

### Recipe-to-grocery review/result copy — 2026-10-24 (#142)

AddToGroceriesButton now uses typed scoped EN/ES controls, local review errors,
confirmed add/already-on-list/duplicate summaries and structured Undo results.
Numbers use the display locale; recipe/list/ingredient names and units stay
literal. Local review errors retain semantic keys until render. Undo retains its
server result instead of a preformatted sentence. Summary helpers accept optional
presentation copy and retain their legacy English default; their copy-type import
is erased, so no runtime React/translation dependency enters the transport helper.
Existing review sequence, selected/destination values, exact mutation request/key,
owned navigation, retry, callbacks and Undo deadlines remain. Transport/server
error strings are unchanged and may remain English. Thirteen owned copy inventory
records removed without scanning. Mounted locale/review/confirmed Undo/no-extra-
request regression source authored/unrun. No QA/test/check/build/browser/API/
database/native/provider/permission/release ran. Original locale/layout/recovery/
food and runtime acceptance remains open.

### Calendar source-identity ambiguity refusal — 2026-10-24 (#124)

The parser refuses UIDs above the existing500-character bound rather than
truncating identity. Duplicate master UIDs and duplicate UID/resolved override
instants also refuse; supported IDs remain literal at full length. The existing
fixed invalid-feed path runs before event reconciliation, preserving prior events
and validators. There is no first/last winner or automatic historical collision
repair. Timezone resolution/cancellation/no-UID rules remain; broader semantic/
provider/timezone/concurrency compatibility remains unverified. Boundary,
duplicate-source and sync-preservation source cases are authored/unrun. No QA/
tests/check/build/browser/API/database/native/provider/permission/release ran.

### Calendar-import reconciliation batches — 2026-10-24 (#134/#124)

The canonical subscription reconcile now traverses all existing history in
200-row immutable-ID batches, preserving household/subscription scope. It holds
only the bounded incoming identity map plus a history batch, updates exact
matching identities even when their old start was outside the window, preserves
valid old history and keeps prior invalid-key/in-window stale cleanup. Deletes
and missing creates are also batched200; no total traversal cap/partial commit.
The transaction requests RepeatableRead with its original30s timeout. Conflicts
may abort and remain errors; no automatic retries. This is not an external-feed
version lock or exact replay/metadata-ordering guarantee. An additive scoped
history index is authored/unapplied. Multi-batch/query-shape/history/moved-key/
create/repeat regression source is authored/unrun; fake state does not prove
PostgreSQL isolation/rollback. Total work, lock/index/query cost, concurrent
refresh/removal/metadata and original acceptance remain open. No QA/test/check/
build/browser/API/database/migration/native/provider/permission/release ran.

### Malformed identified calendar-source refusal — 2026-10-24 (#124)

Calendar parsing no longer skips a known series when master/exception creation
or recurrence expansion throws. Non-cancelled missing starts, incomplete orphan
overrides and invalid resolved start/occurrence identities also refuse. Multiple
calendar roots refuse rather than silently accepting the first. Window/cap
arguments must be finite, ordered and within the existing maximum. The exported
parser normalizes all library errors to the existing fixed IcsParseError, so the
sync's existing invalid-feed path preserves event rows and conditional validators.
Valid cancellations (including orphan cancellations) and no-UID skipping remain.
Regression source for identified malformed events/series, multiple roots,
coverage bounds and event/validator preservation is authored/unrun. Broader
semantic validation, unsupported multi-calendar delivery, historical partial
recovery and provider/concurrency/native/compatibility acceptance remain open.
No QA/tests/check/build/browser/API/database/provider/permission/native/release ran.

### Capped calendar-source integrity — 2026-10-24 (#124)

The export route reads2,001 rows and refuses overflow above its existing2,000
capacity with503, private/no-store and fixed content-minimal JSON. It emits no
partial ICS. Supported-size results retain token/family/time/window/UID/cache
behavior. Subscription sync now checks `parsed.truncated` before reconciliation:
occurrence or iteration caps produce only scoped error/attempt metadata, leaving
events and the prior complete ETag/Last-Modified unchanged. Complete parses use
the existing write/reconcile path. Boundary, overflow, content omission and both
capped-import cases are authored/unrun. Oversized complete export remains
unavailable; parser-skipped malformed series and previously accepted truncated
imports require separate work. Actual provider HTTP-error behavior, concurrent
refresh/deletion, parser/compatibility/rollback/runtime acceptance remain open.
No QA/tests/check/build/browser/API/database/native/provider/permission/release
ran; no existing household event or validator was changed by this source edit.

### Fabricated capacity-model definition — 2026-10-24 (#134/#137)

`docs/testing/CAPACITY_MODEL.md` defines ordinary and three skewed datasets,
weighted household/event/grocery/inventory/task/AI/notification traffic, explicit
role/shared-device boundaries, bounded local stages, correctness/abort rules and
content-free evidence. It distinguishes session/household/request units, offered
and actual rates, closed-loop saturation, cold/warm builds and synthetic provider
time. No production/provider traffic, scheduler or scale claim. The sequential
baseline does not implement the mixed model. SLO prose now matches existing
default-off core-route telemetry wrappers. #134 model definition is complete;
guarded generator/runner/reconciler, reproducibility, measured bottleneck/capacity,
recovery and all runtime acceptance remain unfinished. No QA/tests/check/build/
browser/API/database/provider/telemetry/infrastructure/native/release ran.

### Calendar feed Unicode/source-plan follow-through — 2026-10-24 (#124/#134)

ICS text and RRULE folding now counts UTF-8 bytes and iterates complete code
points; prior ASCII widths remain conservative. Escaped content normalizes bare
CR/CRLF/LF. Existing token/family scope, UIDs, timestamps, recurrence rule grammar,
query window and response/cache contract remain unchanged. Multibyte/emoji,
newline and ASCII-boundary regression source is authored/unrun. The existing
2,000-row cap can truncate a dense feed; no complete-feed, deletion/sync or
provider compatibility claim follows from format correctness. CORE_QUERY_PLAN
now reflects current bounded chore candidate/policy reads, project task/send and
Notes pages, retaining legacy unbounded paths and total-work/lock/index limits.
No QA/test/check/build/browser/API/database/native/provider/permission/release
ran. Complete large-feed delivery and original #124/#134 acceptance remain open.

### Dormant routine-unlink inventory reader — 2026-10-24 (#557/#480)

`routine-subject-unlink-read.ts` adds transaction-scoped preparation, with no
caller in production identity commands or routes. It validates bounded scope
before reads and holds a missing routine column rather than treating it as no
future work. The raw query selects every non-null household future root,
ordered by ID, limited to 1,001 and row-locked. No subject/protocol/state filter
can hide an unsupported definition. Over 1,000 roots holds without rewrites;
otherwise the pure complete-inventory planner validates every returned row and
holds any unsupported, foreign, duplicate or ambiguous definition. Storage errors
propagate to abort the future transaction. No occurrence or earned-credit data
is read/changed. Caller-owned participant/household locks and renewed association/
owner proof remain mandatory; row locks do not prevent phantoms independently.
A ready plan is not a receipt or authority. JSON payload/lock-time/query costs,
writer/provenance/domain/credit/Undo/erasure and real concurrency acceptance
remain open. Reader regression source authored/unrun. No QA/tests/check/build/
browser/API/database/migration/native/provider/permission/release ran.

### Tablet status, subject-picker and action-copy source — 2026-10-24 (#142)

Removed/unavailable screens, account picker title/instructions/accessibility
label, chore-selection/confirmation and grocery/write feedback now use 14 new
typed EN/ES device keys plus existing generic errors. Actual names and raw
server/validation text remain literal. Status wipe effects and route links are
unchanged. The board action memo no longer depends on translation callbacks or
the translated paused string; its methods read current translation refs at
invocation. With other inputs stable, language changes retain the action object,
its queued-operation ownership set and current picker resolver. Existing account/
profile protocol/authorization/TTL/idle/payload/key/recovery rules remain.
ActionResult stays a string interface; an already emitted toast/error does not
retranslate automatically. No stronger current-subject/provenance or concurrent
snapshot-identity guarantee is implied. Ten owned inventory records removed
without a scanner. Regression source for in-progress picker, stable actions and
queued-operation failure tracking across language changes is authored/unrun.
No QA/tests/check/build/browser/API/database/permission/provider/native/release
ran. Original queue/lifecycle/privacy/locale-data/layout/runtime gates remain.

### Pinned Notes paging source — 2026-10-24 (#134)

`note-paging.ts` defines an additive limit1–100 and household-bound versioned
creation-time-descending/ID-ascending cursor. Duplicate/malformed/foreign cursor
inputs refuse; the cursor never grants access. GET Notes retains personal-only,
feature-gated, household-scoped reads and original server permissions. Opted-in
reads use one lookahead; unpaged older clients keep the full list/response shape.
An additive composite index is authored in schema/SQL, unapplied.
The web asks for 24 notes and replaces each page instead of accumulating bodies.
Previous/older/newest controls, page-only EN/ES counts and separate older-empty
copy keep partial reads truthful. Failed-page retry preserves the exact cursor
and navigation trail; changed responses, missing old-server page envelopes,
oversized pages and cursor loops refuse. Generation/abort guards ignore older
or unmounted requests; a 15-second deadline includes fetch and body reading.
Page navigation returns focus to the heading. Save/delete still use canonical
endpoints and refresh newest notes without replaying a confirmed write.
Legacy API total memory remains unbounded. Concurrent reads are not a snapshot;
index plans/build/locking, old/new-client forward/rollback, actual household/
permission isolation, body-timeout/navigation/draft/rendered acceptance remain
open. Unit, API and UI regression source authored; existing fixtures adapted,
all unrun. No QA/test/check/build/browser/API/database/migration/permission/
provider/native/release ran.

### Command-palette localization and keyboard source — 2026-10-24 (#142)

CommandPalette now uses 11 typed scoped EN/ES keys for dialog/input labels,
query/search/empty states and keyboard hints. User queries remain literal.
Arrow keys focus the current role/feature-filtered destination buttons with
wraparound; Tab/Shift+Tab wrap within the panel, and composing Enter does not
submit household search. Native button activation, draft-aware routing, existing
focus-return and Escape handling remain. This does not replace the modal host
or establish nested-dialog accessibility. Destination targets have a 44px minimum
height. Device text now delegates to shared scoped translation for pseudo-copy
while retaining numeric formatting and pure English transport defaults.
Fourteen owned inventory records removed without scanning. Keyboard cases
are authored/unrun; existing Spanish input selector adapted. No QA/tests/checks/
build/browser/API/database/native/permission/provider/release ran. Original
focus/modal-stack/reflow/locale-data/runtime acceptance remains open.

### Device Today and snapshot feedback copy — 2026-10-24 (#142)

DeviceTodayScreen and its rename/remove dialogs now use typed EN/ES device copy,
with 16 added keys and reused labels. Semantic parent-ended/renamed/dialog errors
follow locale; actor/tablet names remain literal. The snapshot hook stores
DeviceFeedback and still returns `error: string | null`, formatting protocol,
reconnect, removed and generic messages at render. No text/locale dependency is
added to existing read/poll/cache/elevation effects or transport memoization.
Cache snapshots/keys/schema, protocol1/2 gates, freshness/expiry/epoch/purge,
parent credentials, native lifecycle and API/effect callbacks remain canonical.
Raw server/validation text remains literal, as before; the elevated settings
transport retains its English string error contract so language changes cannot
restart its load. No raw secret/error objects enter feedback state. Seventeen
owned copy inventory records removed without a scanner; no new copy-only tests.
Existing cases unrun; no QA/check/build/browser/native/provider/permission/API/
database/household/release ran. Remaining tablet/transport copy and original
cache/shared-device/privacy/native/layout/locale-data/runtime acceptance stay open.

### Paired-tablet entry/parent-mode copy source — 2026-10-24 (#142)

PairScreen, ElevationSheet and ElevatedBanner now use the existing typed device
EN/ES dictionary (56 added keys plus reused labels). Terminal pairing states,
parent/PIN/password instructions, progress/accessible labels, countdown/status
and controls follow the app locale. Pair/elevation feedback stores semantic keys,
params and retry seconds until render; raw errors/secrets are not added to state.
`genericDeviceFeedback`/`renderDeviceFeedback` adapt existing generic device
errors while `genericErrorText` preserves its old English default for other
callers. Actual parent/tablet names, pairing/confirmation/PIN digits, countdowns,
TTL/idle deadlines, credential clearing, terminal errors, polling/native version
metadata, focus and API/elevation callbacks remain unchanged. Locale/text are
not added to any existing effect dependency, so changing language does not
restart pairing or extend an elevation. Thirty-six owned inventory records
removed without a scanner. No new copy-only tests; existing cases unrun. No
QA/check/build/browser/hardware/native permission/provider/API/database/household/
release ran. Other tablet copy and original shared-device/native/privacy/layout/
locale-data/runtime acceptance remain open.

### Opt-in project-calendar summary response — 2026-10-24 (#134)

`project-calendar-response.ts` defines summary-v1 with a versioned created/
no-tasks/all-sent discriminator and coherent safe integer count. Explicit
`responseMode: summary-v1` makes the full-send transaction retain only that
count, leaving the legacy event array empty; the response omits event objects.
Missing mode preserves installed clients' full event-array success shape; an
unsupported explicit mode refuses before effects. Internal 200-task/matching
batches and original single transaction/full intent remain unchanged.
The web button now requests/validates the summary, distinguishes no eligible
tasks, and treats malformed/old-server 200 bodies, transport failures and 5xx as
unconfirmed without auto-retry or success. Synchronous pending and project-
generation guards prevent duplicate taps and late toast/refresh on another
project/unmount. This is not an exact replay/source snapshot/ownership receipt:
retries may confirm existing links with zero new events instead of reproducing
an earlier count. No transport deadline or transaction-duration improvement is
claimed. Legacy result memory, total work/locks, index application and real
forward/rollback/concurrency/rendered evidence remain open. Contract, multi-
batch count-only server and UI recovery cases authored/unrun; existing assertions
adapted and retained. No QA/test/check/build/browser/API/database/household/
provider/permission/release action ran.

### Project calendar full-intent internal batches — 2026-10-24 (#134)

`readProjectCalendarTaskBatch` reads at most 200 dated/incomplete tasks in private
immutable-ID order, with project-household relation scope. Candidate UID and
legacy-title grouped existence reads return at most one group per supplied key,
not all historical event rows. Legacy null/empty UID matches retain old title
semantics; modern UID matches do not block another task sharing its title.
The endpoint advances after the last candidate, including an all-already-sent
batch, and continues to true exhaustion inside the original single effect
transaction. No partial commits, silent prefix cap or source-row snapshot claim.
Current locked authority/all-day/timezone rules and full event success response
remain. The response array, full-send total work and existing 30-second lock
window are still not bounded by this internal batch change. Additive task-ID/
modern-UID/legacy-title index schema/SQL source is authored/unapplied; query plans,
index write costs and actual contention/rollback remain unverified. Regression
source covers full multi-batch/repeat behavior, already-sent prefix continuation,
exact candidate scope and empty exhaustion. No QA/test/check/build/browser,
Prisma generation/migration/API/database/household/release action ran.

### Recent changes presentation localization — 2026-10-24 (#142)

`ActivityClient.tsx` now uses 20 route-scoped typed EN/ES keys for history UI,
recovery/status/empty states, page controls, relative day headings and actor
fallback/tablet descriptions. Shared `useDisplayLocale` formats dates, times
and loaded counts; `dayKey` retains local-calendar grouping independently of
language, and stored timestamps remain canonical. Actual audit summaries and
actor names are never translated or parsed to infer actions/identity. No locale
or text callback is added to the existing read-effect dependencies; pending,
retry cursor, generation, cancellation and deadline state remain unchanged.
Eleven owned copy inventory records removed without a scanner. No new copy-only
tests or QA/check/build/browser/API/database/household/release actions ran.
Existing cases remain unrun. Full localization/layout/locale-data acceptance
and the read-recovery behavior's original runtime evidence remain open.

### Project calendar send authority renewal — 2026-10-24 (#134)

Send to Calendar now acquires user/household advisory locks, then current User/
Family row locks, before checking session generation, original household, known
role and current Projects state. It then locks/re-reads the exact project in
that household before reading task sources or creating events. The outer lookup
now selects only IDs needed for the existing household check; locked fresh name
supplies fallback descriptions. Task projection is narrowed and relation-scoped.
Current known household roles retain send permission. No new parent/status gate,
partial-send cap or silent task truncation is introduced. Task UIDs, legacy-title
skip behavior, date-only/all-day timezone conversion and full success response
remain unchanged. Refusal status/code is additive and occurs before any effects.
The original full task/event/result arrays and 30-second transaction remain;
new lifecycle locks can serialize other household work for that duration. A
bounded full-intent protocol and contention/query acceptance remain unfinished.
Fake lifecycle-interleaving/current-name cases are authored/unrun; original
fixtures explicitly enable Projects. No QA/check/build/browser/API/database/
permission/household/release action ran. Real PG lock/rollback/revocation and
original compatibility/role/feature/privacy criteria remain open.

### Project detail task paging source — 2026-10-24 (#134)

`project-task-paging.ts` adds versioned keysets scoped to family/project/completed
filter, ordered position/created_at/id with exact tie continuation. Opt-in API
limit1–100 reads limit+1; legacy no-limit response/order remains unpaged and
unbounded. Task reads include a household project relation after the existing
scoped project check. The SSR detail checks the project household before child
hydration, reads 40 tasks plus lookahead and obtains whole-project total/completed
counts in one grouped aggregate, instead of deriving progress from the page.
`ProjectTaskPageNav` provides draft-aware More/First tasks and truthful EN/ES
page coverage/invalid/empty recovery. Public child-write routes and stored tasks
remain canonical; position/status changes between pages can move rows, so a
fresh first-page read is the recovery, not a snapshot/absence guarantee.
The additive Prisma/index SQL source supports the composite read; no migration,
Prisma generation or index execution occurred. Existing server/task-add fixtures
are adapted; original assertions retained. Cursor scope/ties and full-progress
versus bounded rendering cases authored/unrun. No QA/check/build/browser/API/
database/household/release ran. Full audit, legacy API adoption, query-plan/
concurrency/isolation/installed-client/rendered criteria remain open.

### Recent changes read recovery source — 2026-10-24 (#134)

`settings/activity/ActivityClient.tsx` now validates canonical 20-entry audit
pages, nested actor/rendered fields, dates, duplicate IDs and explicit bounded
cursor metadata. A malformed/missing envelope no longer falls back to a false
empty history. Empty pages with continuation and repeated/visited cursors refuse.
Fetch and body parsing share a 15-second deadline/abort; initial/older requests
use generation checks and offline/unmount/reconnect cancellation. A synchronous
pending guard blocks overlapping older reads. Older failure retains loaded rows
and exact retry cursor; late superseded responses cannot replace the new epoch.
Server parent/device gates, household scope, retention, public response shape,
summary/actor content and API page size remain unchanged. No new provider,
permission, API call or data mutation occurred during this source task.
Regression cases authored/unrun for malformed pages, cursor retry, reconnect
supersession and stalled body. No QA/test/check/build/browser/release ran.
The separate hidden-routine helper's production call sites all now pass bounded
ID scopes in source; that observation does not complete the full query audit.
Original household/privacy/browser/concurrency/scale acceptance remains open.

### Today chore and compatibility-probe batching — 2026-10-24 (#134/#450)

Today board and personal-summary chore reads now use `readVisibleChoreRows`;
their profile-compatibility probes also fill a visible result or reach true
candidate exhaustion with bounded ID-scoped metadata. No full-window hidden-ID
preload/notIn list remains in those readers. An optional private creation-time
cursor preserves the existing `(due_date, created_at, id)` order instead of
substituting the API's two-part public cursor. All three keys participate in
continuation; database ID collation stays in PostgreSQL. Creation times remain
internal to the readers and are not added to public DTOs. Date-only windows,
80/120 visible caps, member/profile eligibility and rollout/refusal behavior,
parent completed-awaiting-check count and canonical data remain unchanged.
Each candidate/metadata batch is at most 200; total dense-hidden-range work is
not claimed constant. Existing synthetic fixtures now distinguish bounded
probe reads and provide selected creation times; assertions retained. New
creation-order/three-part-cursor cases authored/unrun. No QA/tests/check/build/
browser/database/household/release ran. Other callers/counters and original
PostgreSQL/query-plan/concurrency/isolation/role/device acceptance remain open.

### Chore visibility before caps via bounded reads — 2026-10-24 (#134/#450)

`chore-visible-read.ts` now fills visible caps/lookahead by iterating canonical
candidate pages and ID-scoped `hiddenRoutineOccurrenceIds` reads. Both chores
GET (dated/undated; paged/unpaged) and the SSR open/current reader use it. Every
candidate and metadata batch is at most 200 IDs; visible retained rows remain
bounded by the existing caps. Hidden rows do not consume the visible cap, and a
hidden-only batch cannot end the page early. Errors propagate without a partial
result. Database due-date/ID keysets keep the original public cursor and all
household/status/assignee/date filters; private cursors only advance candidate
reads. PostgreSQL retains ID tie collation; local checks reject repeated rows,
backwards dates, invalid dates and oversized responses. Completed/verified API
history retains its single bounded read; legacy responses remain latest-visible
500 rows oldest first without a cursor. No public DTO/capability/write changes.
Total work/latency can still grow across an all-hidden dense range. Today/other
window/aggregate readers retain their current scoped helper; no full-query or
latency acceptance is claimed. New unit source authored/unrun for dense hidden
pages, ASC/DESC ties/continuation, legacy cap, all-hidden exhaustion, later read
failure and protocol/bound guards. No QA/check/build/browser/DB/household/release
ran. Original PostgreSQL query-plan/concurrency/isolation/recurrence criteria stay open.

### Dormant routine unlink batch preflight — 2026-10-24 (#557/#480)

`prepareRoutineSubjectUnlinkBatch` now validates a supplied complete household
future-root inventory before returning any changes. Foreign/non-root/malformed
rows, duplicate IDs, incomplete coverage or more than 1,000 roots hold; any
ambiguous/unsupported/conflicting/exhausted definition holds the entire batch
without exposing partial rewrite/stack lists. Ready plans retain prior revisions,
deterministic root order and unique sorted stack IDs without reordering inputs.
Completeness is internal reader metadata, not authority or a server proof. The
future locked reader must enumerate all non-null future definitions with no
subject/protocol filter and limit + 1; above the cap requires a reviewed path,
never truncation. No reader, transaction, schema, HTTP/UI caller or gate is changed.
Regression source authored/unrun; no QA/check/build/browser/database/household or
release action ran. Full unlink/stack/credit/provenance/domain acceptance remains.

### Dormant routine unlink adapter source — 2026-10-24 (#557/#480)

`routine-subject-unlink.ts` implements pure future-definition preflight only.
Exact account/member aliases and already-profile references receive a stable
profile subject/new revision; known unrelated/erased definitions stay unchanged.
Account-only, conflicting, unsupported/malformed and revision-exhausted metadata
holds. The adapter never changes historical assignments, actors, credits or
occurrences, and does not infer household/owner authority. Future use requires
all household future roots and atomic locked proof/stack/domain renewal; unknown
metadata cannot be declared unrelated by a current-protocol identifier query.
No existing lifecycle writer, HTTP/UI consumer, schema or gate is changed.
Regression source authored/unrun. No QA, tests/check/build/browser, database,
provider/permission, household mutation or release action ran. Full standalone
unlink/provenance/credit/domain parity remains unfinished; retain #557 open.

### Today-board settings copy source — 2026-10-24 (#142)

`fridge/BoardSettings.tsx` now uses 77 scoped typed EN/ES keys from
`i18n/board-settings.ts`. Colour/temperature labels, weather consent wording,
calm-screen idle choices, night-hour controls, person-only photo labels and
shared-tablet write controls follow translation context. Local status/error
notices retain semantic keys/parameters until render. Known person-transport
fallbacks map to those keys; arbitrary server/custom transport diagnostics stay
literal, preserving caller semantics. `BoardSettingsTransport` remains unchanged.
Member/place names, palette keys, coordinates, photos, times, idle choices,
privacy/disclosure wording and request patches remain canonical. Device audience
still cannot list/pick/upload photos or receive stored coordinates. Existing
load/save dependencies are unchanged; locale does not trigger reads or writes.
Forty-two owned copy inventory records removed, without running a scanner.
No new copy-only tests or QA/build/browser/provider/device/household action ran;
full shared-device/settings/locale-data acceptance remains open.

### Meals page and recovery-link copy source — 2026-10-24 (#142)

`dashboard/meals/page.tsx` now uses 39 scoped typed EN/ES keys for remaining
page/form copy, visible meal-type labels, exact restore notices, accessible Add
labels and empty-state/week controls. Five `food-planning-entry.ts` keys cover
`MealPlanningReviewLinks`. `meal-week.ts` follows scoped translation rather
than manual locale selection, so loaded-state copy can be pseudolocalized.
`mealTitle` accepts an optional translated display fallback while retaining its
old English default; existing nonblank source titles and all callers' stored
values remain unchanged. Date boundaries/Intl dates, read effects, session
errors/server refusals, payloads, household/cook/recipe IDs, quantities and
restore idempotency bodies/keys remain canonical. No release/QA/scanner ran.
Thirty-five owned copy inventory records removed. A locale-only review-link
test stub was removed so existing assertions use default translation context;
all cases remain unrun. This does not prove complete meal-flow localization.

### Food-plan launcher/AI/sheet copy source — 2026-10-24 (#142)

`FoodPlanningLauncher.tsx`, `FoodAiProposal.tsx` and `FoodPlanningSheet.tsx`
now use 120 typed EN/ES keys in route-owned `food-planning-entry.ts` and
`food-planning-sheet.ts`. Existing language is retained; AI held-choice count
uses scoped interpolation. Recovery/auth/role gating, sheet identity, owned
navigation, requests, exact retries, confirmation/local-removal acknowledgement,
quantities and callbacks remain canonical. Timing reads locale for formatting
exact time choices; fold selection, wall-time resolution, departure interval
and buffers remain untouched. No locale is added to an effect dependency.
Thirty-four owned inventory records removed; no scanner or QA/check/build ran.
Existing expiry/review callback cases remain unrun; no new copy-only tests.
This source checkpoint does not establish full localization/AI/runtime acceptance.

### Food grocery-selection/save-details copy source — 2026-10-24 (#142)

`FoodGroceryChoices.tsx` and `FoodSaveDetails.tsx` now use scoped typed EN/ES
`food-planning-inputs.ts` keys. Existing selection and exact-command review
remain canonical: no ingredient default changes, estimated-shortage arithmetic,
write/review callbacks, cook inheritance, source names, dates or quantities
changed. Five-row detail paging retains component identity and state; its copy
now follows translation context directly. Eighteen owned inventory records
removed; no scanner/check/test/build/browser ran. This is local source work,
not rendered, localization, household-write or release acceptance.

### Food-plan picker/allocation copy source — 2026-10-24 (#142)

FoodRecordPicker and FoodAllocationEditor use typed scoped EN/ES keys for recipe/
account/list/event descriptions, search/selection/retry/coverage, portion/date/
meal/cook/note fields and allocation actions. Existing translations are preserved;
caller labels and household names, values, units, IDs and event times remain
canonical. The picker read effect's dependencies/owner scope and page/search/
selection bounds are unchanged; locale only changes display. Allocation totals,
14-row cap, inherited cook, parent draft callbacks and field validation are
unchanged. Sixty-eight owned migration records removed, no scanner run. No new
copy-only tests, existing cases unrun; rendered/pseudolocale/selection/recovery/
privacy and original planning acceptance remain open. No writes or activation.

### Food-plan review presentation source — 2026-10-24 (#142 / #123)

FoodPlanSummary and FoodGroceryOutcomesView use typed scoped presentation keys
instead of inline language branches/pair picking. Domain hold/reason maps remain
exhaustive over the canonical contract; saved recipe/stock/meal/list/event names,
quantities, IDs, dates/instants and result/Undo state remain literal/canonical.
Existing EN/ES wording is preserved; pseudolocale now follows the translation
context. Internal detail pagination keeps its component/state identity; timing
text hooks precede early return. Grocery expiry effects, confirmed/unknown/refused
semantics, callback payloads and draft-aware list navigation are unchanged.
Fifty-four owned migration records removed, no scanner run. Three affected test
mocks use actual default translation context; assertions retained/unrun. No new
QA/provider/write/permission/store or release action; rendered locale/reflow/
privacy and original planning/grocery/Undo acceptance remain open.

### Join navigation recovery source — 2026-10-24 (#142)

JoinFamilyPage now retains the selected internal destination when history release
refuses/throws or synchronous router dispatch throws. A localized explicit
Continue retries only navigation through the same release controller, with a
synchronous duplicate-navigation guard and page-generation checks. It never
replays joining/token acceptance/auth reads. Successful join and pending-auth
states remain latched while recovery is available; destination state is memory-
only, not logged/persisted. No history ownership bypass, direct location change
or server API change. Deferred source cases cover joined-dashboard recovery and
an expired-invite session's registration continuation without POST. Router commit,
Back/lifecycle/browser and original household/localization acceptance are unrun.

### Household join copy/preview source — 2026-10-24 (#142)

JoinFamilyPage uses typed scoped EN/ES labels, invitation role/sentence and
semantic success/errors while keeping family names/emails/code/token values
literal. Locale changes do not rerun auth or code/token preview effects. Exact
checked-code identity and generation guards prevent stale lookups restoring a
previous family's preview; code edits invalidate/abort pending lookups. Bootstrap
reads and navigation timers clean up; late joined responses cannot apply/redirect
after unmount. Server auth, session-gated lookup/quota, code normalization, token
handling, join body/role enforcement, duplicate-submit guard and navigation
release stay canonical. Sixteen owned copy records removed; no scanner ran.
Stale-lookup and mounted-locale/no-reread cases authored/unrun. Full household/
role/token/client/navigation/privacy/rendered acceptance remains open.

### Import reviewed-scope source — 2026-10-24 (#104)

New-web reviewProtocol1 freezes server-derived actor/household IDs into the
reviewed persistence body. Missing/changed scope refuses before dispatch; IDs
are a precondition, never access authority or family selection. Legacy response/
write compatibility remains explicit, and new web refuses old-server metadata
absence rather than downgrading. No signed/source/target-state receipt or stored
review. IDs stay outside reconciliation display. Source fixtures adapted/unrun;
all current/previous client/server/lifecycle/reconciliation acceptance deferred.

### Import writer authority source — 2026-10-24 (#104 / #136)

All three persisted sources now share original-household/current-parent/mapped-
user renewal at job creation and effects. User advisory locks precede household
and current ordered User row locks; HTTP session generation is carried internally
and rechecked after waiting. Stale session ->401; identity conflicts retain409.
Internal compatibility callers still require current membership/parent/mappings.
Failure accounting updates only owned family/source/running jobs with fixed
content-free detail, preserving deleted/completed outcomes and the original
error. No public body, parser/provenance/schema or scheduler change. Helper/API
source cases are authored/unrun; exact PG locks, lifecycle, current/old clients,
reconciliation/replay/rollback and release acceptance remain open. See the import
review plan and API contract; no import or QA ran.

### Import form review/localization source — 2026-10-24 (#104 / #142)

ImportsClient now uses typed EN/ES copy and semantic known/local failures,
generation-bound file reads and a current-input preview. Exact reviewed JSON
and source are frozen for explicit persistence; synchronous duplicate/edit guards
and consumed local approval prevent accidental second submissions. Validated
result envelopes gate preview/job display; unknown writes require fresh review.
No backend authorization/transaction/importer change, live import or source data
was introduced. Twelve owned copy records removed; four literal labels/examples
remain. Source cases are authored/unrun. See `docs/plans/import-review-ui.md` for
server lifecycle/snapshot, real exports/rehearsal/rollback and QA limits.

### Recorded recipe localization source — 2026-10-24 (#142 / #460)

PreparedRecipe history dialog now uses typed EN/ES keys for launch/title/summary,
close/loading/refusal/retry, missing/unprepared evidence and captured-at copy.
Captured-at rendering keeps the existing locale clock; stored timestamps and
recipe snapshots remain unchanged. It still reads only the owned batch record,
never substitutes today's canonical recipe, and retains generation/ID/schema/
abort/explicit action boundaries. Eighteen owned migration records were removed;
no scanner ran. Existing history cases remain unrun; mounted locale/value/
layout and original history/localization acceptance remain open.

### Shared search/error copy source — 2026-10-24 (#142 / #136)

SearchField default placeholder/clear/accessible name now use typed scoped EN/ES
keys; caller labels, controlled input values, submission and clear/focus behavior
remain. ErrorBoundary generic title/message/Retry use the same scoped dictionary
through a hook-based fallback. Raw caught exception messages are no longer UI
copy, and componentDidCatch passes only describeError's redacted identity to the
existing logger. This does not suppress framework/browser diagnostics. Custom
fallbacks and explicit subtree retry remain. Four owned migration records were
removed; no scanner ran. Localization/redaction/retry/custom-fallback source
cases are authored/unrun. No rendered or broad privacy/release proof is claimed.

### Help sync diagnostics source — 2026-10-24 (#142 / #146)

SyncDiagnostics now uses typed EN/ES keys for controls, descriptions, semantic
clipboard/unavailable feedback and singular/plural count variants. Intl changes
count display only; the existing content-free QueueDiagnostics JSON stays exact.
Locale switches do not re-read, copy or send anything. Report/notice envelopes
match the current owner during render; request generations invalidate delayed
clipboard feedback after reload, owner change or unmount. No queue write/replay,
provider, telemetry, permissions or export transport was added. Eleven owned
migration records were removed by source edits; no scanner ran. Mounted-locale,
report-byte, singular/memory and owner-change/late-copy source cases are authored
and unrun. Original runtime/privacy/native/layout acceptance remains open.

### Recipe component localization source — 2026-10-24 (#142)

RecipeDetail, RecipePicker and RecipeReuseLauncher now use typed scoped EN/ES
presentation keys instead of inline language branches/English-only picker copy.
Loading/refusal/empty/retry/dismissal/explicit reuse, source/ingredient/method
headings and accessible labels follow current locale/pseudolocale. Serving counts
use Intl display; authored recipe text/units/URLs/identity and canonical requests
are untouched. All28 owned untranslated-copy records were removed; no scanner
ran. Mounted locale/no-reload/value-preservation and Spanish explicit-reuse
cases are authored/unrun; human copy/layout/date/native acceptance remains open.

### Wishlist bounded read source — 2026-10-24 (#134)

Canonical GET now supports opt-in limit/cursor and current-user mine filtering
before the cap, retaining the old complete unpaged response. Web reads24 wishes
per explicit page, labels partial/unknown coverage, retries the same position
and refreshes only viewer-loaded depth. Child/teen request only own wishes;
existing read/write permissions remain. New household-scoped GET/[id] inspects
write targets so missing rows on a collection page never prove deletion/failure.
EN/ES continuation, per-read timeout and stale/unmounted read suppression are
authored. API_CONTRACTS.md records old-server fallback and remaining acceptance;
source fixtures and original UI GET mock URL adoption are authored/unrun.
Present canonical page targets avoid a redundant row query; absent targets still
require their owned row read before recovery can resolve.
No schema/index/scheduler or new domain store.

### Routine visibility prefilter scope source — 2026-10-24 (#134/#450)

The ordinary recurrence expander also limits its future-occurrence read to the
required existing window and scopes upcoming/latest rows to the original family.
A full window still returns no inserts; an underfilled window still reads every
existing candidate. Once/repeating foreground passes each already cap roots100;
fair repeating continuation now has default-off source with household-owned
one-root attempted claims, separate canonical effects and failure isolation.
The additive cursor migration is unapplied; legacy behavior retains first100
selection. See `docs/plans/fair-chore-top-up.md`. No history deletion, window-size
change or scheduler; source cases authored only.

`hiddenRoutineOccurrenceIds` now accepts internal occurrence IDs and inclusive /
exclusive due-date bounds. Known chore GET, main Today window, personal home
summary, initial Chores window and dated chore API narrow metadata before visible
paging/caps; completed/verified history skips the open-occurrence scan. Root
metadata joins remain independent of the occurrence window and household-scoped.
No visible/hidden row cap, policy rewrite, schema, grant or write is introduced.
The dense/unscoped/default helper path and recurrence/roster fanout remain explicit
CORE_QUERY_PLAN work. Fabricated SQL/query-binding regression source is adapted,
not run; PostgreSQL/window/role/profile/rollback acceptance remains deferred.


### Notifications older-page read source — 2026-10-24 (#134/#141)

Existing GET `/api/notifications` adds opt-in scoped limit/cursor paging while
retaining its legacy50-row shape. Existing web inbox requests50, loads older
rows, retains exact retry state and local action state, and uses truthful loaded
count/empty labels until completion. Missing old-server metadata has explicit
unsupported/refresh copy. No write route/model/provider/permission is added.
Canonical personal auth, preferences and snooze/mark/Delete/Undo remain in source.
Typed EN/ES copy is in supporting-ui. Parser/API/inbox regression source is
authored, not run; API_CONTRACTS records scope, timeout, recovery and remaining
role/concurrency/rendered acceptance. No QA/build/CI/deployment action ran.


### Projects bounded overview source — 2026-10-24 (#134)

Existing `/dashboard/projects` now reads24 project summaries plus a continuation
sentinel with deterministic created-at/id order and explicit older/newest page
links. Canonical source is `project-overview.ts`; no project/task model or writer
is added. One grouped query counts task completion states for only returned
project IDs, avoiding materializing completed task IDs or a per-card query.
Streaming content rechecks current personal household and feature before reads;
the existing canonical project-route role allowlist and parent-only creation
remain in source. API read authorization retains its existing policy.
Invalid/cross-household/filter cursors do not query projects or claim an empty
household. EN/ES paging/error/empty-page copy is in project-overview dictionary.

`GET /api/projects` opts into the same summary reader with `limit`/`cursor`;
legacy callers without limit retain the full `{ projects }` response and status
filter behavior. No legacy collection is silently truncated. That legacy path
is intentionally still unbounded and remains migration work under #134; source
paging is not proof the whole query audit is complete. No schema/index migration,
public capability change, offline write or native activation is introduced.
Cursor parser/summary regression source is authored, not run. No QA/tests/build/
lint/typecheck/browser/CI/push/merge/deploy or production data action occurred.


### Restock UI/owned request extension — 2026-10-20

New read-only body-based POST `/api/inventory/restock/review` avoids private draft
names in URLs, with common auth, read-scope echo and canonical restock review.
InventoryRestockSheet is wired from item editing/history; explicit target/amount/
duplicate policy, exact retry/result/list-link/Undo controls are authored. Existing
inventory entry/recovered-review/provider contracts add the fixed `restock` kind;
no new schema, offline queue action or provider/native activation. Unknown Undo
is open-sheet retry/manual acknowledgement, not another durable operation. Source
tests are authored only; cooking stock review remains implementation work.

### Inventory restock backend source — 2026-10-20

New GET/POST `/api/inventory/restock` and POST `/api/inventory/restock/undo` use
paired-first personal auth and renewed canonical parent/teen inventory+lists
authority. Shared effect in `inventory-restock.ts`, strict v1 contract, explicit
source version/purchase values and atomic canonical ListItem/receipt. Existing
createListItem accepts internal inventory provenance; grocery O-5 Undo is shared
with its existing recipe wrapper retained. No schema/source enum/new stock store.
UI/owned-journal integration remains open; source integration/paired tests are
authored, not run. Details: `architecture/INVENTORY_RESTOCK.md`.

### Shared meal/food foreground draft source — 2026-10-20

No route/model/schema added. `ReviewedDescriptionDraft` owns common collapsed
typing/browser/local-preview voice, owner-context/lifecycle guards and explicit
Apply. FoodDescriptionDraft reuses it. New MealDescriptionDraft + bounded
meal-description parser fill only free-text unlinked Add meal fields. Linked
recipe/edit/prepared paths are not repurposed; useMealCreation still owns the
atomic save/original context and recovery. EN/ES test source is authored, not
run. Stock-lot consumption review and direct replacement restocking remain open.

### Food voice/text draft source — 2026-10-20

No route/schema added. `FoodDescriptionDraft` is an optional disclosure in the
canonical ItemModal create mode. `food-description.ts` is a bounded suggestion
parser, not another stock model. Browser speech reuses `use-voice-draft` with
optional language/deadline and stale-callback guards; the existing local Android
preview gate remains unchanged. Only explicit Apply updates editable fields;
Save retains the intake/recovery contracts. Parsing/UI test source is authored,
not executed. Recipe/prep stock review and direct restocking remain code gaps.

### Inventory recovery UI integration source — 2026-10-20

No new route/schema. Personal InventoryClient now owns InventoryRecoveryProvider
and EN/ES recovery sheets. Manual ItemModal, BarcodeFoodDialog, ScanFridgeDialog
and stock actions share gated stage/send/confirmed-dismiss. Root server props
carry the adopted rollback boundary; default legacy mode does not negotiate or
persist. Paused writing retains current-owner review/local dismissal while
stage/send stay refused. Both write transports settle unknown at 15 seconds
even if the native bridge ignores abort. New source tests cover sender order,
storage failure, original-key retry, hidden names and EN/ES/paused controls.
No code execution or rendered/native acceptance; provider/activation gates stay off.

### Inventory recovery canonical review — 2026-10-20

New `POST /api/inventory/recovery/review`: paired-first personal auth, required
inventory owner proof and canonical inventory authority; read-only receipt and
owned target/Undo review with time/size/rate boundaries. Shared reviewer and
response contract in `inventory-recovery-review*.ts`; bounded browser reads in
`inventory-recovery-client.ts`, storage binding in `inventory-recovery-browser.ts`.
No model/queue action or native capability added. Form/UI integration is next;
source tests and common paired-context negatives are authored, not run.

### Inventory restart recovery source addendum — 2026-10-20

One new personal GET route: `/api/inventory/recovery`, common paired-first auth
and canonical parent/teen inventory authority, gated support/private no-store.
`inventory-recovery-{contract,server,store}.ts` provide bounded original online
requests, a separate owner scope, optional pre-replay proof and owned persistence
with explicit recovered review. No schema/new queue action. Existing intake and
change routes keep legacy no-header behavior. Browser/canonical-review/UI
integration remains in progress; all source test execution is deferred.

### Inventory read binding source addendum — 2026-10-19

No route added: inventory list, use-soon, cook and adjustments GET now share
`inventory-read-http.ts` for optional original-actor/household request binding,
canonical success echo and private/no-store outcomes. Personal clients share
`inventory-reader.ts`, `inventory-read-contract.ts` and `inventory-read-scope.ts`
for bounded refresh generations and DTO validation. Old unbound reads remain
compatible; new bound readers need the backend first. Details and limits live in
`architecture/API_CONTRACTS.md` and `architecture/OFFLINE_SYNC.md`. Source only;
no new queue/manifest action and no QA/release claim.

**Inspected:** `master` at `cbef026` (#280), 2026-09-29. Static source inspection only: no route was run for this document, no production data was read, and nothing here claims runtime behaviour.

**Scope:** every page (`src/app/**/page.tsx`, 57 files) and every API route (`src/app/api/**/route.ts`, 131 files, 197 exported handlers; reconciled with #281 at `32f10d0`). The lists were produced by a throwaway Node script (not committed; the repository has no tooling-scripts location for doc generators) that walks `src/app`, reads each file's exported HTTP methods, `featureGate(...)` / `FeatureGate` / `useFeatureEnabled(...)` calls, device helpers (`authenticateDevice`, `requireElevation`, `refusePairedDevice`), env kill-switch helpers, Prisma delegates used in the route file and its direct `@/lib/*` imports, and joins each handler to the "Role gate" column of [`security/API_ISOLATION_AUDIT.md`](../security/API_ISOLATION_AUDIT.md). Hand-checked rows are marked.

**Related documents.** Roles: [`ROLE_AND_ISOLATION_MATRIX.md`](../ROLE_AND_ISOLATION_MATRIX.md). Navigation: [`product/NAVIGATION.md`](../product/NAVIGATION.md). Meal/list model decision: [ADR-0007](../architecture/adr/0007-canonical-meal-recipe-grocery-models.md) and [`architecture/MEALS_AND_GROCERIES.md`](../architecture/MEALS_AND_GROCERIES.md) §2. Shared device: [`architecture/SHARED_DEVICE.md`](../architecture/SHARED_DEVICE.md). Feature flags: `src/lib/features.ts`.

**Boundary.** This audit deletes no route and runs no migration. Findings that need work are proposed as issues below; none were filed from this change.

### Current-source count correction — 2026-10-11

The historical generated table above is retained for provenance. A fresh walk
of the current source tree counts **163 API route files and 233 exported HTTP
handlers**. The shared-device allowlist separately tracks **153 common
person-authenticated methods**, the ten `requireDeviceManager` parent-management
methods, and the remaining device-allowed, public, token, cron and health
handlers. Calendar sync has six additional explicitly listed methods because
its provider kill switch runs before person authentication. These counts are
source inventory only; they do not establish rendered, device or production
acceptance.

## All-feature UX alignment contract — 2026-10-11

Cameron's latest direction: align UI/UX across **all features**, including all-features-on households. This supplements the historical audit below; it does not claim that old route counts, role descriptions, or every screen remain current. Source reviewed for this addition: `9e6ac899` (`src/lib/features.ts`, `src/lib/nav-items.ts`, `src/lib/kid-access.ts`, dashboard page paths, shared UI primitives and form-sheet hosts). Static inspection only; no new rendered, native, production or customer evidence.

Execution owner: Codex; product owner: Cameron. Track the current all-feature continuation in #499 (preserving closed #143 acceptance/history), foundation/component work in #152, adaptive journey acceptance in #133 and rendered evidence in #139. Preserve the existing [cross-device sequence](../product/CROSS_DEVICE_ROADMAP.md); this is its coverage contract, not a parallel roadmap. Significant flow changes use the existing [editable design file](../../design/README.md) before implementation.

### Approved navigation update — 2026-10-17

The current parent navigation is Today, Calendar, Meals, Lists and Explore.
Explore retains `/dashboard/family/more`, with Family first in Core; child/teen
Emergency tabs and route permissions are unchanged. The historical generated
IA rows below retain their inspected-source wording. For the current parent
entry points use [navigation](../product/NAVIGATION.md) and the approved
[implementation ledger](../../design/APPROVED_UI_ROLLOUT.md).

### One interaction system

- Stable primary destinations, grouped feature discovery, consistent active/back context. Turning on a feature must not add a permanent top-level tab or an automatic Today tile. Favorites and personal layout remain separate from household availability and permissions.
- Shared semantic typography, surfaces, spacing, radii, focus and control states from `design/FOUNDATIONS.md` and production tokens. Category icons must not replace text or create competing styles. Native select options, date/time controls and disabled states need light/dark contrast checks on actual browsers.
- Full-width desktop shell with intentional reading/form widths. Data-heavy calendar/list views use space; text forms stay bounded. Phone uses short rounded sheets; expanded views may use side/detail panes. Complex forms have named steps and visible progress rather than a long stack of fields.
- Same action vocabulary and placement: a clear primary action, adjacent filters/view switch, labeled row actions, predictable Close/Back. Preserve source routes for direct links; inspect intercepted and direct form paths. On closing, restore focus and list position. Explicitly specify draft retention or clearing, including browser/native Back and process death.
- Reuse `Dialog`, `FormSheet`, `ListRow`, `EmptyState`, route loading, offline feedback and undo primitives where appropriate; a reuse target is not evidence of integration. Do not create a second business model or pretend every existing component already supports every state.
- Empty, loading, partial, error/retry, offline/stale, pending, conflict and success states must explain what happened and the next action. Show only saved success; retryable actions must not duplicate records. Destructive actions show scope and recovery accurately; undo only where server semantics support it.
- Parent, teen, child and shared-device presentations use the same visual language with permitted actions and different density. Customization, enabled flags, AI, voice and selecting a display profile never grant authorization. Shared surfaces use an allowlisted DTO; personal API/page access does not establish device access.

### Feature coverage and disposition

Every row below is a **migration/QA target**, not a completed audit. Retain working domains (disposition 1), adapt permitted teen/child surfaces (5), and preserve parent-only boundaries (4) according to current server policy. Optional features remain gated (7). Role/action details must be verified vertically; this table deliberately grants no new access. All rows share the execution/design/QA owners above.

| Feature key     | Canonical destination      | Alignment and journey acceptance target                                                                                                                        |
| --------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chores`        | `/dashboard/chores`        | One recurring-series row with schedule and expandable occurrences; same-day scheduling, weekly day selection, all-age routine stack, review/undo/snooze scope. |
| `calendar`      | `/dashboard/calendar`      | Consistent day/week/agenda controls, source connections, event detail/edit sheet, duration, return refresh, overlap/all-day/long-title layouts.                |
| `lists`         | `/dashboard/lists`         | Custom types, consistent item/image controls and check/undo; Today grocery action resolves the actual grocery destination, not an unexplained generic list.    |
| `family`        | `/dashboard/family`        | Add everyone during onboarding; name-only profile, optional verified account linking, role clarity, safe archive/removal and separate permanent deletion.      |
| `meals`         | `/dashboard/meals`         | Plan/explore/saved recipe hierarchy; short meal sheet, source attribution, recipe import failures, plan-to-grocery handoff without duplicates.                 |
| `inventory`     | `/dashboard/inventory`     | Pantry/fridge/freezer views and use-soon actions; amount/unit controls, consume/discard/undo, scan unavailable/failure states.                                 |
| `notes`         | `/dashboard/notes`         | Quick note sheet, long-text cards, consistent pin/edit/delete affordances; explicit shared visibility.                                                         |
| `anniversaries` | `/dashboard/anniversaries` | Clear upcoming/date views, shared date selector and recurrence wording; sensible empty state.                                                                  |
| `gamification`  | `/dashboard/analytics`     | Points/streaks presented as optional context, not a second Analytics destination; disabled/dependency behavior is clear.                                       |
| `rewards`       | `/dashboard/rewards`       | Browse/claim/parent-review states with points requirement; do not show claim success before persistence.                                                       |
| `budget`        | `/dashboard/budget`        | Parent-only dense overview, transaction/category sheets, period controls; no financial information on shared display.                                          |
| `projects`      | `/dashboard/projects`      | Overview/detail/task hierarchy, progress and canonical calendar handoff; scoped destructive confirmation.                                                      |
| `messages`      | `/dashboard/messages`      | Familiar thread/composer, unread and send/retry states; personal privacy preserved on shared surfaces.                                                         |
| `analytics`     | `/dashboard/analytics`     | One destination shared with gamification, understandable periods/empty charts; never fabricated example metrics.                                               |
| `wishlist`      | `/dashboard/wishlist`      | Consistent image/item cards, add/edit sheet and labeled status controls; actor-specific actions.                                                               |
| `emergency`     | `/dashboard/emergency`     | Quickly find permitted contacts, readable emergency actions and printable layout; shared medical fields require explicit policy.                               |
| `locations`     | `/dashboard/locations`     | Compact place cards and address form; parent/private address boundaries, safe removal.                                                                         |
| `pickups`       | `/dashboard/pickups`       | Day/person/status hierarchy with assignment sheet; ownership and conflicts visible.                                                                            |
| `allowance`     | `/dashboard/allowance`     | Personal versus parent overview clearly labeled, payment/IOU status and permitted actions; private on shared device.                                           |
| `travel`        | `/dashboard/travel`        | Clear date range and preview of schedule effects; resume/undo semantics must match server behavior.                                                            |
| `handoff`       | `/dashboard/handoff`       | Readable sitter brief, reduced role fields, explicit sharing scope/expiry and revocation; sensitive information not shown by default.                          |
| `sick-days`     | `/dashboard/sick-days`     | Person/day/dose hierarchy, own versus parent actions, privacy, pending/error dose state; prevent repeat effects.                                               |

The registry contains **22 feature keys**, each represented once above. Supporting flows and Today are not additional feature flags. Reconcile this coverage against `src/lib/features.ts` as features change.

### Supporting flows are part of the same system

| Surface                                | Required alignment and evidence                                                                                                                                                               |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Today and fridge board                 | Consistent region headings/gutters; bounded information density with all features on; customize/preview/reset controls; groceries route correctly; avoid repeated occurrences across regions. |
| Onboarding, register/login/join        | Short steps, add-everyone prompt, optional email, resend/retry and household-switch clarity; shared display does not inherit an account by choosing a person.                                 |
| Explore, search and command palette    | Grouped searchable destinations, no duplicated Analytics route; permission-filtered results, off-feature state, keyboard/Back/focus continuity.                                               |
| Notifications                          | Consistent unread/read/snooze controls and time labels; return/resume state, persistence and clear snooze scope.                                                                              |
| Settings, preferences, features        | Separate personal arrangement, household flags, roles and integrations; dependency explanation, reset/preview and save failure.                                                               |
| Calendar provider setup/imports        | Provider enabled/disabled/disconnect/failure states, consistent connection shortcuts; honest read-only/sync status.                                                                           |
| Help, report and family AI             | Stable launcher and accessible panel; permission-aware answers, reviewed action preview, pending/retry/conflict/undo; voice listening/mute and unsupported wake states.                       |
| Pairing, elevation and device recovery | Explicit shared/private mode, safe lock/back/timeout/revoke; offline/reconnect, rotation, resume and process-death checks on physical hardware.                                               |
| Export, removal, deletion and activity | Consistent scope explanations and confirmation; account versus household versus profile; no private provenance fields in display or AI payloads.                                              |

### Acceptance and evidence record for each vertical migration

Record route, feature, component/token mapping, Figma reference, current role/API gates, direct versus intercepted entry, changed states, viewport/theme evidence, measured bundle/performance impact, test results, PR/SHA and release status in the existing issue. No row is Done based only on a screenshot or build. Preserve previous clients and rollback aliases until replacement evidence supports removal.

Use isolated fabricated households: new/empty; busy; all 22 flags on; dependency flags off; long/localized names; multiple groceries/custom lists; adults/teen/email-free preschool profile; slow/offline/concurrent devices. Verify phone 390×844 and 430×932, portrait 800×1280, fridge 1280×800, large tablet 1920×1200 and desktop 1366×768. Exercise keyboard, screen reader, large text, reduced motion, light/dark/night, keyboard/toast/sheet collisions and native Back. Primary targets are at least 44px; shared primary targets aim for 56px. Physical device, signed/store and household usability evidence remain distinct gates.

### Current-source corrections to historical role rows

`src/lib/kid-access.ts` gives teens extra Meals/Help/Notifications prefixes and exact Calendar, Calendar create and personal Settings paths. Children retain the shared allowlist. The older P-only descriptions below for Calendar, Meals, Help, Notifications and Settings must not drive implementation or tests. Calendar edit and Settings subroutes are not implied by teen exact-path access. API action permissions must still be checked independently. No role expansion is authorized by this document.

## Legend

- **Roles.** P = parent, T = teen, C = child. "all" = every member of the household. "n/a" = no person session (public, token or device). Page roles come from `src/middleware.ts` and `src/lib/kid-access.ts`: children may open `/dashboard` (kid home) and the prefixes in `KID_ALLOWED_PREFIXES`; teens additionally have `TEEN_EXTRA_PREFIXES` and `TEEN_EXACT_PATHS`. Other dashboard paths redirect them home. Historical route rows below are not a substitute for these current source gates.
- **Device cookie.** "device only" / "device + elevation" = accepts only the `fp_device` cookie (`src/lib/device-route.ts`). "refused" = `refusePairedDevice` rejects a paired tablet before person auth. "no" = person session only; the common refusal boundary runs before `authenticateRequest` and direct `getServerUser` handlers, and the route-allowlist test guards this.
- **Env gate.** Server kill switch or provider key; see [`CURRENT_STATE.md`](../CURRENT_STATE.md) "What is on and what is off by default". `SHARED_DEVICE_ENABLED` routes return 404 while off; calendar sync routes 404 until `isCalendarSyncEnabled()`; the scan and import routes 404 while their Anthropic key is unset.
- **Meal/list model.** Delegates used by the route file and the `@/lib` modules it imports directly. Canonical and legacy follow ADR-0007. "—" means no meal/recipe/list table is touched at that depth (the board loader and importer are covered by hand in "Meal and list overlap").
- **IA home** follows `product/NAVIGATION.md` and `src/lib/nav-items.ts`: _Tab_ (phone tab bar and top bar), _More_ (`/dashboard/family/more`, parents), _Settings_ (settings, Features, family settings), _Sub-page_ (reached from a parent page), _Utility_ (top bar or user menu), _Hidden_ (no in-app link; reached by URL, email link, redirect or device flow).

## Summary

|                                               | Count                                                                                                                                                                                                                      |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page routes                                   | 59 (48 under `/dashboard`, including `/dashboard/settings/activity` from #285; 4 under `/device`, 4 auth, `/`, `/join`, `/privacy`, `/terms`, `/handoff/[token]`, and the development-only `/dev/design-system` from #156) |
| API route files                               | **163 current source files** (the historical generated table above remains 131; the earlier summary was not refreshed as new route files landed)                                                                           |
| API handlers (file × method)                  | **233 current source handlers** (the historical generated table above remains 197; the earlier summary was not refreshed as new handlers landed)                                                                           |
| API handlers missing from the isolation audit | 0 (the 5 `/api/calendar/subscriptions/**` handlers were added for finding F-4)                                                                                                                                             |
| Routes that read a legacy ADR-0007 table      | 2: `GET /api/users/export`, `DELETE /api/recipes/[id]` (finding F-7)                                                                                                                                                       |
| Route-level `loading.tsx` / `error.tsx` files | `error.tsx` for `/dashboard` and `/device`; `loading.tsx` for the today, chores, lists, calendar and rewards tabs (finding F-9, fixed)                                                                                     |

API route files by domain (first path segment, all 163 current files): family 24, lists 16, device 15, calendar 13, auth 9, inventory 9, chores 5, projects 5, users 5, budget 5, handoff 4, recipes 4, rewards 3, wishlist 3, capture 3, and 1–2 each for sick-days, allowance, medications, health, anniversaries, admin, notes, emergency-contacts, locations, meals, files, notifications, cron, analytics, pickups, assistant, messages, capabilities, activity, feedback, search, audit, version, events and upload.

## Page routes

**Historical snapshot:** route roles and counts in this table have not been fully re-audited. Apply the current-source corrections above and verify current page/API policy before implementation; P-only Calendar/Meals/Settings descriptions are stale for teen access.

Disposition uses the #148 classes: **1** keep with visual refactor; **2** keep but move in IA; **3** merge into another journey; **4** parent/admin only; **5** child/teen simplified; **6** deprecate after migration evidence; **7** later/feature-gated.

| Route                                                        | Roles                                         | Device                                              | Feature gate (page)                                                                          | IA home                                                            | Canonical data / API                                                                                                                                                                                                                                                                                                                    | Disposition                          |
| ------------------------------------------------------------ | --------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `/`                                                          | public                                        | no                                                  | —                                                                                            | Hidden (landing; middleware sends signed-in users to `/dashboard`) | —                                                                                                                                                                                                                                                                                                                                       | 1                                    |
| `/login`, `/register`, `/forgot-password`, `/reset-password` | public                                        | login/register return 409 on a paired device (#240) | —                                                                                            | Hidden (auth)                                                      | `/api/auth/*`                                                                                                                                                                                                                                                                                                                           | 1                                    |
| `/join`                                                      | public / signed-in                            | no                                                  | —                                                                                            | Hidden (invite link)                                               | `/api/family/invites/preview`, `/api/family/join`, `/api/family/lookup`                                                                                                                                                                                                                                                                 | 1                                    |
| `/privacy`, `/terms`                                         | public                                        | no                                                  | —                                                                                            | Hidden (linked from register)                                      | static                                                                                                                                                                                                                                                                                                                                  | 1                                    |
| `/handoff/[token]`                                           | public (share token)                          | no                                                  | — (API checks `handoff`)                                                                     | Hidden (shared link)                                               | `GET /api/handoff/share/[token]`                                                                                                                                                                                                                                                                                                        | 7                                    |
| `/dashboard`                                                 | P → redirect `/dashboard/today`; T/C kid home | no                                                  | —                                                                                            | Tab (kid Today)                                                    | server: own chores, routines (#272)                                                                                                                                                                                                                                                                                                     | 5                                    |
| `/dashboard/today`                                           | all                                           | no (the device board is `/device/today`)            | per tile (weather, meals, inventory)                                                         | Tab (parent Today); user menu for T/C                              | board loader `src/app/dashboard/today/today-board-data.ts`: `Event`, `Chore`, `FamilyMeal`, `ListItem`; home summary `/api/chores/complete`, `/api/chores/uncomplete`                                                                                                                                                                   | 1                                    |
| `/dashboard/calendar`                                        | P                                             | no                                                  | core (always on)                                                                             | Tab                                                                | `/api/events`, `/api/calendar/import-suggestions*`                                                                                                                                                                                                                                                                                      | 1                                    |
| `/dashboard/calendar/create`, `/dashboard/calendar/edit`     | P                                             | no                                                  | core                                                                                         | Sub-page                                                           | `/api/events`                                                                                                                                                                                                                                                                                                                           | 1                                    |
| `/dashboard/chores`                                          | P                                             | no                                                  | core; `gamification` hides points                                                            | Sub-page (Today summary "All chores", More)                        | `/api/chores`, `/api/chores/complete`, `/api/chores/verify`                                                                                                                                                                                                                                                                             | 1                                    |
| `/dashboard/chores/create`, `/dashboard/chores/edit`         | P                                             | no                                                  | core; `gamification`                                                                         | Sub-page                                                           | `/api/chores/create`, `/api/chores`, `/api/upload`                                                                                                                                                                                                                                                                                      | 1                                    |
| `/dashboard/meals`                                           | P                                             | no                                                  | `meals` (FeatureGate); `inventory` for tiles                                                 | Tab                                                                | `/api/meals`, `/api/meals/[id]` → `FamilyMeal`                                                                                                                                                                                                                                                                                          | 1                                    |
| `/dashboard/meals/recipes/[id]`                              | P                                             | no                                                  | `meals`                                                                                      | Sub-page                                                           | `/api/recipes/[id]` → `Recipe`, `RecipeIngredient`                                                                                                                                                                                                                                                                                      | 1                                    |
| `/dashboard/lists`                                           | all                                           | no                                                  | core                                                                                         | Tab (P and T/C)                                                    | server → `List`; shows `meal_plan` card only while such lists exist; `?type=` filters by list type (F-6)                                                                                                                                                                                                                                | 1                                    |
| `/dashboard/lists/[listId]`                                  | all (delete P)                                | no                                                  | core                                                                                         | Sub-page                                                           | `/api/lists/items/*` (item delete: `DELETE /api/lists/items/[id]`, F-6), `/api/lists/section-sort` → `List`, `ListItem`, `Ingredient`                                                                                                                                                                                                   | 1                                    |
| `/dashboard/lists/type/[type]`                               | all                                           | no                                                  | core                                                                                         | Hidden (redirect only, F-6 fixed)                                  | none: redirects to `/dashboard/lists?type=<type>` (unknown type: `/dashboard/lists`); the type cards filter `/dashboard/lists` in place                                                                                                                                                                                                 | 3 (kept for old links and bookmarks) |
| `/dashboard/lists/create`                                    | all (API: P+T)                                | no                                                  | core                                                                                         | Sub-page                                                           | `/api/lists/create`                                                                                                                                                                                                                                                                                                                     | 1                                    |
| `/dashboard/family`                                          | P                                             | no                                                  | core                                                                                         | Tab                                                                | `/api/family/members`, `/api/family/members/[id]` (remove, O-34), `/api/auth/me`                                                                                                                                                                                                                                                        | 4                                    |
| `/dashboard/family/more`                                     | P                                             | no                                                  | — (lists enabled features)                                                                   | Tab (Family → More)                                                | `src/lib/nav-items.ts`                                                                                                                                                                                                                                                                                                                  | 4                                    |
| `/dashboard/family/settings`                                 | P                                             | no                                                  | —                                                                                            | Settings                                                           | `/api/family`; the D-3 deletion dialog (`/api/users/deletion`, `DELETE /api/users`, `DELETE /api/family`); board settings component → `/api/family/board-settings`                                                                                                                                                                      | 4                                    |
| `/dashboard/family/invite`                                   | P                                             | no                                                  | —                                                                                            | Settings (Family)                                                  | `/api/family/invites*`, `/api/family/invite-code` (new code, O-34)                                                                                                                                                                                                                                                                      | 4                                    |
| `/dashboard/family/create`                                   | P (no family yet)                             | no                                                  | —                                                                                            | Settings / onboarding                                              | `POST /api/family`                                                                                                                                                                                                                                                                                                                      | 4                                    |
| `/dashboard/features`                                        | P                                             | no                                                  | —                                                                                            | Settings (More, Settings)                                          | `/api/family/features` (via provider)                                                                                                                                                                                                                                                                                                   | 4                                    |
| `/dashboard/settings`                                        | P                                             | no                                                  | sections by env: calendar sync, shared device                                                | Utility (user menu)                                                | `/api/users` (incl. `DELETE`, D-3), `/api/users/deletion`, `/api/users/export`, `/api/family` (`DELETE`, only parent), `/api/auth/change-password`, `/api/family/ai-settings`, `/api/family/feed-token`, `/api/calendar/*`, `/api/users/elevation-pin`, `/api/users/preferences` (#286; teens and children reach it from the user menu) | 4                                    |
| `/dashboard/settings/devices`                                | P                                             | manages devices                                     | `SHARED_DEVICE_ENABLED` (`notFound()` while off)                                             | Settings                                                           | `/api/family/devices*`                                                                                                                                                                                                                                                                                                                  | 4, 7                                 |
| `/dashboard/settings/imports`                                | P                                             | no                                                  | —                                                                                            | Settings                                                           | `POST /api/admin/imports/[source]`                                                                                                                                                                                                                                                                                                      | 4                                    |
| `/dashboard/settings/activity`                               | P                                             | no                                                  | —                                                                                            | Settings → Family "Recent changes" (parents)                       | `GET /api/audit` (#285)                                                                                                                                                                                                                                                                                                                 | 1                                    |
| `/dashboard/search`                                          | P                                             | no                                                  | — (per type in the API)                                                                      | Utility (top bar link; command palette "Search the household")     | `GET /api/search` (F-3 search part fixed)                                                                                                                                                                                                                                                                                               | 1                                    |
| `/dashboard/notifications`                                   | P                                             | no                                                  | —                                                                                            | Utility (bell)                                                     | `/api/notifications`                                                                                                                                                                                                                                                                                                                    | 1                                    |
| `/dashboard/emergency`                                       | all (edit P)                                  | no                                                  | `emergency`                                                                                  | Tab (T/C); Family → Emergency (P)                                  | `/api/emergency-contacts*`                                                                                                                                                                                                                                                                                                              | 5                                    |
| `/dashboard/inventory`                                       | all (edit P+T)                                | no                                                  | `inventory`; `meals` for "what can I cook"                                                   | More; user menu (all roles)                                        | `/api/inventory*`                                                                                                                                                                                                                                                                                                                       | 7                                    |
| `/dashboard/notes`                                           | P                                             | no                                                  | `notes`                                                                                      | More                                                               | `/api/notes`, `/api/notes/[id]` (F-1 fixed)                                                                                                                                                                                                                                                                                             | 1                                    |
| `/dashboard/anniversaries`                                   | P                                             | no                                                  | `anniversaries`                                                                              | More                                                               | `/api/anniversaries*`                                                                                                                                                                                                                                                                                                                   | 1                                    |
| `/dashboard/messages`                                        | P                                             | no                                                  | `messages` (FeatureGate; F-2 fixed)                                                          | More                                                               | `/api/messages`                                                                                                                                                                                                                                                                                                                         | 1                                    |
| `/dashboard/projects`                                        | P                                             | no                                                  | `projects` (checked in page before any read; F-2 fixed)                                      | More                                                               | server Prisma; `/api/projects`                                                                                                                                                                                                                                                                                                          | 1                                    |
| `/dashboard/projects/[id]`, `/dashboard/projects/create`     | P                                             | no                                                  | `projects` (`[id]` checked in page before the project read; `create` FeatureGate; F-2 fixed) | Sub-page                                                           | `/api/projects/*`; "Add task" on an active project → `POST /api/projects/[id]/tasks` (F-5)                                                                                                                                                                                                                                              | 1                                    |
| `/dashboard/budget`                                          | P                                             | no                                                  | `budget` (checked in page before any read; F-2 fixed)                                        | More                                                               | server Prisma; budget components → `/api/budget/*`                                                                                                                                                                                                                                                                                      | 4                                    |
| `/dashboard/rewards`                                         | P                                             | no                                                  | `rewards` (checked in page; requires `gamification`)                                         | More                                                               | server; `/api/rewards*`                                                                                                                                                                                                                                                                                                                 | 7                                    |
| `/dashboard/rewards/create`                                  | P                                             | no                                                  | `rewards`                                                                                    | Sub-page                                                           | `/api/rewards`                                                                                                                                                                                                                                                                                                                          | 7                                    |
| `/dashboard/analytics`                                       | P                                             | no                                                  | `analytics` (requires `gamification`)                                                        | More                                                               | `/api/analytics`                                                                                                                                                                                                                                                                                                                        | 7                                    |
| `/dashboard/wishlist`                                        | all                                           | no                                                  | `wishlist` (off by default)                                                                  | More                                                               | `/api/wishlist*`                                                                                                                                                                                                                                                                                                                        | 5, 7                                 |
| `/dashboard/pickups`                                         | P                                             | no                                                  | `pickups` (off by default)                                                                   | More                                                               | `/api/pickups*`                                                                                                                                                                                                                                                                                                                         | 7                                    |
| `/dashboard/allowance`                                       | all (T/C read own)                            | no                                                  | `allowance` (off by default)                                                                 | More                                                               | `/api/allowance*`                                                                                                                                                                                                                                                                                                                       | 5, 7                                 |
| `/dashboard/handoff`                                         | all (T/C reduced)                             | no                                                  | `handoff` (off by default)                                                                   | More                                                               | `/api/handoff*`                                                                                                                                                                                                                                                                                                                         | 5, 7                                 |
| `/dashboard/sick-days`                                       | all (T/C own)                                 | no                                                  | `sick-days` (off by default)                                                                 | More                                                               | `/api/sick-days*`, `/api/medications*`                                                                                                                                                                                                                                                                                                  | 5, 7                                 |
| `/dashboard/locations`                                       | P                                             | no                                                  | `locations` (off by default)                                                                 | More                                                               | `/api/locations*`                                                                                                                                                                                                                                                                                                                       | 4, 7                                 |
| `/dashboard/travel`                                          | P                                             | no                                                  | `travel` (off by default)                                                                    | More                                                               | `/api/family/travel`, `/api/chores`                                                                                                                                                                                                                                                                                                     | 7                                    |
| `/device`                                                    | device                                        | device cookie                                       | `SHARED_DEVICE_ENABLED`                                                                      | Hidden (redirects to `/device/today`)                              | —                                                                                                                                                                                                                                                                                                                                       | 7                                    |
| `/device/pair`                                               | none (pairing)                                | pairing                                             | `SHARED_DEVICE_ENABLED`                                                                      | Hidden (device flow)                                               | `/api/device/pair/*`                                                                                                                                                                                                                                                                                                                    | 7                                    |
| `/device/today`                                              | device (+ parent elevation)                   | device only                                         | `SHARED_DEVICE_ENABLED`                                                                      | Hidden (device home)                                               | `GET /api/device/today` (same board loader as `/dashboard/today`)                                                                                                                                                                                                                                                                       | 7                                    |
| `/device/removed`                                            | none                                          | after revoke                                        | `SHARED_DEVICE_ENABLED`                                                                      | Hidden                                                             | —                                                                                                                                                                                                                                                                                                                                       | 7                                    |
| `/dev/design-system`                                         | none (not a product page)                     | no                                                  | 404 in a production build unless `DESIGN_GALLERY_ENABLED=1` (E2E server only)                | Hidden (development and QA tool, `noindex`)                        | none: fixture props only (`src/app/dev/design-system/fixtures.ts`), no session, Prisma or API (#156, `design/DESIGN_GALLERY.md`)                                                                                                                                                                                                        | 7                                    |

## Feature flags (`src/lib/features.ts`)

New households start simple ([O-38](../decisions/PROVISIONAL_OWNER_DECISIONS.md), 2026-10-03): only `chores`, `calendar`, `lists`, `family`, `meals` and `emergency` are on. "On for pre-O-38 households" means a household that existed before the change keeps the section on, including one whose stored blob is empty or lacks the key (`legacyDefault`); nothing stored is rewritten.

| Feature                                 | Default (new household)                                   | Page                   | API gate                                                    | Disposition                |
| --------------------------------------- | --------------------------------------------------------- | ---------------------- | ----------------------------------------------------------- | -------------------------- |
| `chores`, `calendar`, `lists`, `family` | core, always on                                           | yes                    | `lists` gated (O-11); others core                           | 1                          |
| `meals`                                 | on                                                        | `/dashboard/meals`     | `featureGate('meals')` on meals, recipes, from-recipe, cook | 1                          |
| `inventory`                             | off (also for existing households)                        | `/dashboard/inventory` | `featureGate('inventory')`; scan also needs its key         | 7                          |
| `notes`                                 | off; on for pre-O-38 households                           | `/dashboard/notes`     | yes                                                         | 1 (F-1 fixed)              |
| `anniversaries`                         | off; on for pre-O-38 households                           | yes                    | yes                                                         | 1                          |
| `gamification`                          | off; on for pre-#248 households                           | setting, not a page    | hides fields (`isGamificationOn`)                           | 7                          |
| `rewards`                               | off (on for pre-O-38 households), requires `gamification` | yes                    | yes                                                         | 7                          |
| `analytics`                             | off (on for pre-O-38 households), requires `gamification` | yes                    | yes                                                         | 7                          |
| `budget`                                | off; on for pre-O-38 households                           | yes (F-2 fixed)        | yes                                                         | 4                          |
| `projects`                              | off; on for pre-O-38 households                           | yes (F-2 fixed)        | yes                                                         | 1                          |
| `messages`                              | off; on for pre-O-38 households                           | yes (F-2 fixed)        | yes                                                         | 1                          |
| `emergency`                             | on                                                        | yes                    | yes                                                         | 5 (kid-readable by design) |
| `wishlist`                              | off                                                       | yes                    | yes                                                         | 5, 7                       |
| `locations`                             | off                                                       | yes                    | yes                                                         | 4, 7                       |
| `pickups`                               | off                                                       | yes                    | yes                                                         | 7                          |
| `allowance`                             | off                                                       | yes                    | yes                                                         | 5, 7                       |
| `travel`                                | off                                                       | yes                    | yes                                                         | 7                          |
| `handoff`                               | off                                                       | yes                    | yes                                                         | 5, 7                       |
| `sick-days`                             | off                                                       | yes                    | yes                                                         | 5, 7                       |

## Shared-device and role exposure

- Only `/api/device/*` accepts the device cookie (9 route files, including #281's `GET /api/device/today/version`). `/api/device/label` and `/api/device/revoke-self` also need parent elevation. `/api/family/devices/*` and `/api/users/elevation-pin` are parent person routes behind `SHARED_DEVICE_ENABLED`.
- All 153 common person-authenticated API methods refuse a live paired tablet before person auth through the common boundary in `src/lib/device-refusal.ts`; direct `getServerUser` handlers add the same early guard. The ten parent-only device-management methods using `requireDeviceManager` preserve the same 403 refusal when both a live device credential and person session are present, while device-only calls remain 401. Calendar sync's six provider-gated methods are listed separately because an unconfigured provider returns 404 before auth. The route-allowlist test's `DEVICE_REFUSED_ROUTES`, `PRIVATE_PERSON_ROUTES`, `COMMON_PERSON_AUTH_ROUTES`, `DEVICE_MANAGER_ROUTES` and `CALENDAR_SYNC_ROUTES` are the current method inventory. Public token/credential flows, anonymous analytics events, `/api/auth/logout`, and `/api/device/*` remain explicit exceptions.
- The tablet surface is `/device/today`, fed by the same board loader as `/dashboard/today`; its DTO allowlist is in `SHARED_DEVICE.md` §9.1. Device writes are off (#274 proposes extending them deliberately, ADR-0006).
- Children: page access is the kid allowlist (`/dashboard`, `today`, `lists`, `emergency`, `inventory`, `wishlist`, `allowance`, `handoff`, `sick-days`). Teens also have the extra prefixes and exact paths described in the current-source correction above. API rows are historical per-method observations; verify current API policy separately.

## Meal and list overlap (for ADR-0007 and #254)

| Path                                                                           | Model today                                                                                                      | Notes                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/dashboard/meals`, `/api/meals*`                                              | canonical `FamilyMeal` (+ `Recipe` link)                                                                         | #251/#252                                                                                                                                                                                                                   |
| `/dashboard/meals/recipes/[id]`, `/api/recipes*`                               | canonical `Recipe`, `RecipeIngredient`, `Ingredient`                                                             | `DELETE /api/recipes/[id]` also counts `MealPlanEntry` rows that still reference the recipe (`src/app/api/recipes/[id]/route.ts:133`): a legacy **read** that must go with #254                                             |
| `/dashboard/lists*`, `/api/lists/**`                                           | canonical `List`, `ListItem`, `Ingredient`                                                                       | every handler has `featureGate('lists')` (O-11). The `meal_plan` list type still opens (`src/app/dashboard/lists/ListsClient.tsx:71`) but is no longer offered for new lists (`src/app/dashboard/lists/create/page.tsx:14`) |
| `/api/lists/items/from-recipe`, `/undo-add`, `/api/lists/default-grocery`      | canonical, via `src/lib/grocery-from-recipe.ts`                                                                  | #253                                                                                                                                                                                                                        |
| `/api/inventory/cook`, `/use-soon`                                             | canonical `Ingredient`, `Recipe`                                                                                 | #263                                                                                                                                                                                                                        |
| Today board and `/api/device/today`                                            | canonical `FamilyMeal`, `ListItem` via `today-board-data.ts` and `src/lib/shopping-snapshot.ts`                  | `shopping-snapshot.ts` reads `ListItem` on `grocery`/`shopping` lists; the name is not the legacy table                                                                                                                     |
| `POST /api/admin/imports/[source]` (meal-planner)                              | writes canonical `FamilyMeal`/`List`/`ListItem`/`Recipe*` (`src/lib/imports/persist-meal-planner.ts`, audit row) | existing `ImportedRecord` rows may still name a legacy `target_model`; #254 step 1 rewrites them                                                                                                                            |
| `GET /api/users/export`                                                        | reads canonical **and legacy** `MealPlan`, `ShoppingList` (`src/app/api/users/export/route.ts:129`, `:133`)      | #254 step 2 removes the legacy sections                                                                                                                                                                                     |
| `scripts/backfill-meals-groceries.mjs` / `src/lib/backfill/meals-groceries.ts` | reads legacy, writes canonical                                                                                   | production run owner-gated (`runbooks/MEALS_GROCERIES_BACKFILL.md`)                                                                                                                                                         |
| `src/lib/fixtures/*`                                                           | seeds legacy rows for rehearsal                                                                                  | test-only                                                                                                                                                                                                                   |

No page or API route **writes** a legacy table. The two live legacy reads above are the complete list found by `grep -rnE "\.(mealPlan|mealPlanEntry|shoppingList|shoppingItem)\b" src scripts` outside tests and fixtures. This matches ADR-0007; no new live path triggers its revisit clause.

## Findings

Each is from source inspection at `cbef026`. "Proposed issue" means an issue should be filed; none was filed here. F-2, F-4, F-8 and F-9 were fixed in a follow-up change on top of `c379c5e`; their rows say what changed.

| ID  | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Evidence                                                                                                                                      | Proposed action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F-1 | **Notes edit and delete cannot work.** The page sends `PATCH` and `DELETE` to `/api/notes`, which exports only `GET` and `POST`; the handlers live in `/api/notes/[id]`, which nothing calls.                                                                                                                                                                                                                                                                        | `src/app/dashboard/notes/page.tsx:132-133`, `:158-159`; `src/app/api/notes/route.ts` (GET, POST); `src/app/api/notes/[id]/route.ts`           | **Fixed** in this change: the page calls `/api/notes/${id}`; `src/app/dashboard/notes/__tests__/edit-delete.test.tsx` covers both                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| F-2 | **Three pages do not check their feature flag.** `/dashboard/budget` and `/dashboard/projects` read Prisma on the server and render with `budget`/`projects` off; `/dashboard/messages` renders and gets 403 from its API. Their APIs are gated, and the nav hides them, so this is a direct-URL inconsistency, not a cross-household leak.                                                                                                                          | `src/app/dashboard/budget/page.tsx:55-90`, `src/app/dashboard/projects/page.tsx:17`, `src/app/dashboard/messages/page.tsx` (no `FeatureGate`) | **Fixed** (route inventory follow-up): budget, projects and projects/[id] check the effective flag on the server before any Prisma read and render `FeatureOffState` (as rewards does); messages and projects/create use `FeatureGate`. Tests: `src/app/dashboard/{budget,projects,messages}/__tests__/feature-gate.test.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| F-3 | **Placeholder UI in production paths.** `/dashboard/search` had no data source and showed "No results" for every query; Settings has "Two-Factor Authentication", "Data Export" and "Delete Account" buttons with no handler (the export and delete APIs exist).                                                                                                                                                                                                     | `src/app/dashboard/search/page.tsx` (whole file); `src/app/dashboard/settings/SettingsClient.tsx:731-739`                                     | **Search fixed** (#101 D-2): `GET /api/search` searches the household's canonical members, events, chores, lists, list items, recipes, notes and active inventory, per feature and role (`ROLE_AND_ISOLATION_MATRIX.md` "Household search"); the page and the command palette use it. Settings part **fixed (D-3)**: Data Export downloads `GET /api/users/export`, the Two-Factor Authentication entry is removed (no 2FA exists), Delete Account opens the in-page deletion dialog (`product/ACCOUNT_DELETION.md`). Settings → Notifications **fixed** (#286, PR101 D-5): its four switches only wrote `localStorage` and nothing read them; they are replaced by three per-member switches stored on `User` and enforced by `src/lib/notification-delivery.ts`                                                                                                                                                                                                                                                                                                                                                                                                              |
| F-4 | **ICS subscription routes are missing from the isolation audit and the role matrix.** 5 handlers. From source: list P+T (URL hint parent only), create/update/delete P, refresh P+T; every lookup uses `authenticateWithFamily`.                                                                                                                                                                                                                                     | `src/app/api/calendar/subscriptions/**`; no row in `security/API_ISOLATION_AUDIT.md`                                                          | **Fixed** (route inventory follow-up): 5 rows and an update note in `security/API_ISOLATION_AUDIT.md`, a row in `ROLE_AND_ISOLATION_MATRIX.md`; the existing two-household suite `src/app/api/calendar/subscriptions/__tests__/isolation.test.ts` now also pins the exact 404/403/400 statuses                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| F-5 | **API routes with no in-app caller.** `GET /api/admin/imports`, `GET/POST /api/projects/[id]/tasks` (no UI adds a task to an existing project), `GET /api/lists/items` (only `e2e/`). Expected callers outside the app: `/api/calendar/connections/[provider]/callback` (OAuth redirect), `/api/calendar/feed` (ICS URL), `/api/health*` (release smoke). `/api/users/export` is no longer on this list: Settings → Data Export and the delete dialog call it (D-3). | generated reference scan of `src/` and `e2e/`                                                                                                 | **Resolved** (#289), nothing deleted. `GET /api/admin/imports`: kept for operators (parent-only list of the household's last 50 import jobs; documented in `architecture/API_CONTRACTS.md` "Deprecated, duplicate and operator routes"). `GET/POST /api/projects/[id]/tasks`: **wired**, "Add task" on an active project's page (`src/components/projects/AddProjectTaskForm.tsx`); lookups are now household-scoped (foreign project or assignee = the same 404 as a missing one). `GET /api/lists/items`: **deprecated**, unchanged body plus a `Deprecation` header (`src/lib/deprecation.ts`); removal only after the ADR-0004 review of installed Android clients. Tests: `src/app/api/projects/__tests__/isolation.test.ts`, `src/components/projects/__tests__/add-project-task-form.test.tsx`, `src/app/dashboard/projects/__tests__/add-task-wiring.test.tsx`, `src/app/api/lists/__tests__/item-delete.test.ts`                                                                                                                                                                                                                                                      |
| F-6 | **Duplicate or overlapping routes.** `/dashboard/lists/type/[type]` duplicates a filter of `/dashboard/lists`; `/api/lists/items/delete` (body id) sits beside REST-style `[id]` routes elsewhere; `/api/files/[filename]` and `/api/files/chores/[filename]` serve two upload generations (D3 legacy path in the audit); `/api/chores/complete` and `PATCH /api/chores` both change chore status.                                                                   | route list above                                                                                                                              | **Resolved** (#289), nothing deleted. `/dashboard/lists/type/[type]`: redirects to `/dashboard/lists?type=<type>`, and the type cards filter in place. List item delete: new REST `DELETE /api/lists/items/[id]` (parent, lists on, household-scoped 404, paired device refused), which the web app now calls; `DELETE /api/lists/items/delete?itemId=` (the id is a query parameter, not a body field) stays for installed Android builds with a `Deprecation` header; both go through `deleteHouseholdListItem` (`src/lib/list-item-delete.ts`). `/api/files/[filename]`: unchanged; stays until there is migration evidence (D3 legacy path, `security/API_ISOLATION_AUDIT.md`). Chore status: one path already — `completeChore` for complete, `reopenCompletedChoreInTx` for Undo and the verify reject; `PATCH /api/chores` never changed status (its schema drops `status`), so no endpoint changed; pinned by `src/app/api/chores/__tests__/status-single-path.test.ts`. Tests: `src/app/dashboard/lists/__tests__/type-filter.test.tsx`, `src/app/api/lists/__tests__/item-delete.test.ts`, `src/lib/__tests__/list-item-delete.integration.test.ts`, route allowlist |
| F-7 | **Legacy table reads** that block #254: `GET /api/users/export`, `DELETE /api/recipes/[id]`.                                                                                                                                                                                                                                                                                                                                                                         | see "Meal and list overlap"                                                                                                                   | Part of #254 (gated)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| F-8 | **Dead helper.** `generateFamilyCode` (uses `Math.random`) is exported and has no caller.                                                                                                                                                                                                                                                                                                                                                                            | `src/lib/utils.ts:106`                                                                                                                        | **Fixed** (route inventory follow-up): deleted; no caller in `src`, `e2e`, `scripts` or tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| F-9 | **No route-level `loading.tsx` or `error.tsx` anywhere in `src/app`.** Loading, error and empty states are per component, so a server-page exception falls through to the framework error page.                                                                                                                                                                                                                                                                      | `find src/app -name loading.tsx -o -name error.tsx` returns nothing                                                                           | **Fixed** (route inventory follow-up): `src/app/dashboard/error.tsx` and `src/app/device/error.tsx` (plain-words message, Try again calls `reset()`, no error text, stack or digest; the tablet one shows no household data and does not unpair), `loading.tsx` in the today, chores, lists, calendar and rewards segments (one shared polite `role="status"` skeleton, `src/components/ui/route-loading.tsx`). Not at `/dashboard` itself or above pages that `redirect()` or `notFound()`: a loading boundary streams the page, which turns the parent redirect from `/dashboard` into a client-side one (caught by `e2e/journeys.spec.ts`) and a 404 into a 200. Tests: `src/app/dashboard/__tests__/route-states.test.tsx`, `src/app/device/__tests__/error.test.tsx`                                                                                                                                                                                                                                                                                                                                                                                                      |

Not assessed here, because static inspection cannot support a claim: responsive/tablet weaknesses beyond the tab model already in `NAVIGATION.md`, and bundle/performance hotspots (#137 owns route budgets).

## Proposed migration order

Highest-frequency daily flows first, each as one vertical slice (UI + canonical API + authorization + tests):

1. **Today / home** (`/dashboard/today`, kid `/dashboard`, `/device/today`): already canonical; next are #271 (PR #281) and #274.
2. **Chores** (`/dashboard/chores*`): canonical; #272 merged in #280.
3. **Lists and groceries** (`/dashboard/lists*`): canonical; `/lists/type/[type]` folded into the `?type=` filter (F-6 fixed).
4. **Calendar** (`/dashboard/calendar*`): canonical `Event`; the missing audit rows are added (F-4 fixed).
5. **Meals and recipes** (`/dashboard/meals*`): canonical; #252 design review against FridgeCal is open.
6. **Notes** (F-1 fixed), inventory, messages.
7. **Weekly/occasional:** projects, budget, anniversaries, rewards/analytics, then the off-by-default family features (wishlist, pickups, allowance, handoff, sick days, locations, travel).
8. **Settings and placeholders:** F-3, F-2 and F-9 fixed.
9. **Contract (gated):** #254 after the backfill run and a release with zero legacy reads.

## API routes

Generated table. Roles are the audit's "Role gate" column per method; the three `/api/calendar/subscriptions` rows were read from source before the audit had them (F-4, now fixed). "Device cookie: refused" is `refusePairedDevice`.

| Route                                           | Methods                  | Roles (audit "Role gate", per method)                                                                                      | Device cookie                      | Feature gate                                                       | Env gate                              | Meal/list model                                                                       |
| ----------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------- |
| `/api/activity`                                 | GET                      | GET: all                                                                                                                   | no                                 | —                                                                  | —                                     | —                                                                                     |
| `/api/audit`                                    | GET                      | GET: P (teen/child 403) — hand-checked (#285)                                                                              | refused                            | —                                                                  | —                                     | `AuditLog` (household audit history, ADR-0008)                                        |
| `/api/admin/imports/[source]`                   | POST                     | POST: P                                                                                                                    | no                                 | —                                                                  | —                                     | —                                                                                     |
| `/api/admin/imports`                            | GET                      | GET: P                                                                                                                     | no                                 | —                                                                  | —                                     | —                                                                                     |
| `/api/allowance/[id]`                           | PATCH                    | PATCH: P                                                                                                                   | no                                 | allowance                                                          | —                                     | —                                                                                     |
| `/api/allowance`                                | GET, POST                | GET: P; teen/child own (`to_user_id = self`) ; POST: P                                                                     | no                                 | allowance                                                          | —                                     | —                                                                                     |
| `/api/analytics/event`                          | POST                     | POST: all                                                                                                                  | no                                 | —                                                                  | —                                     | —                                                                                     |
| `/api/analytics`                                | GET                      | GET: all                                                                                                                   | no                                 | analytics                                                          | —                                     | —                                                                                     |
| `/api/anniversaries/[id]`                       | PATCH, DELETE            | PATCH: P; teen/child own (`created_by = self`; NULL = parent-only) ; DELETE: P                                             | no                                 | anniversaries                                                      | —                                     | —                                                                                     |
| `/api/anniversaries`                            | GET, POST                | GET: all ; POST: all                                                                                                       | no                                 | anniversaries                                                      | —                                     | —                                                                                     |
| `/api/auth/change-password`                     | POST                     | POST: all                                                                                                                  | no                                 | —                                                                  | —                                     | —                                                                                     |
| `/api/auth/forgot-password`                     | POST                     | POST: n/a                                                                                                                  | no                                 | —                                                                  | —                                     | —                                                                                     |
| `/api/auth/login`                               | POST                     | POST: n/a                                                                                                                  | no                                 | gamification (fields hidden)                                       | —                                     | —                                                                                     |
| `/api/auth/logout`                              | POST                     | POST: n/a                                                                                                                  | no                                 | —                                                                  | —                                     | —                                                                                     |
| `/api/auth/me`                                  | GET                      | GET: all                                                                                                                   | no                                 | gamification (fields hidden)                                       | —                                     | —                                                                                     |
| `/api/auth/register`                            | POST                     | POST: n/a                                                                                                                  | no                                 | —                                                                  | —                                     | —                                                                                     |
| `/api/auth/resend-verification`                 | POST                     | POST: n/a                                                                                                                  | no                                 | —                                                                  | —                                     | —                                                                                     |
| `/api/auth/reset-password`                      | POST                     | POST: n/a                                                                                                                  | no                                 | —                                                                  | —                                     | —                                                                                     |
| `/api/auth/verify-email`                        | GET, POST                | GET: n/a; POST: n/a                                                                                                        | no                                 | —                                                                  | —                                     | —                                                                                     |
| `/api/budget/categories/[id]`                   | PATCH, DELETE            | PATCH: P ; DELETE: P                                                                                                       | no                                 | budget                                                             | —                                     | —                                                                                     |
| `/api/budget/categories`                        | GET, POST                | GET: P ; POST: P                                                                                                           | no                                 | budget                                                             | —                                     | —                                                                                     |
| `/api/budget/stats`                             | GET                      | GET: P                                                                                                                     | no                                 | budget                                                             | —                                     | —                                                                                     |
| `/api/budget/transactions/[id]`                 | PATCH, DELETE            | PATCH: P ; DELETE: P                                                                                                       | no                                 | budget                                                             | —                                     | —                                                                                     |
| `/api/budget/transactions`                      | GET, POST                | GET: P ; POST: P                                                                                                           | no                                 | budget                                                             | —                                     | —                                                                                     |
| `/api/calendar/connections/[provider]/callback` | GET                      | GET: P                                                                                                                     | no                                 | —                                                                  | calendar sync envs                    | —                                                                                     |
| `/api/calendar/connections/[provider]/start`    | POST                     | POST: P                                                                                                                    | no                                 | —                                                                  | calendar sync envs                    | —                                                                                     |
| `/api/calendar/connections`                     | GET                      | GET: P                                                                                                                     | no                                 | —                                                                  | calendar sync envs                    | —                                                                                     |
| `/api/calendar/feed`                            | GET                      | GET: n/a                                                                                                                   | no                                 | —                                                                  | —                                     | —                                                                                     |
| `/api/calendar/import-suggestions/commit`       | POST                     | POST: P+T                                                                                                                  | refused                            | calendar                                                           | —                                     | —                                                                                     |
| `/api/calendar/import-suggestions`              | POST                     | POST: P+T                                                                                                                  | refused                            | calendar                                                           | EVENT_IMPORT_ANTHROPIC_API_KEY        | —                                                                                     |
| `/api/calendar/import-suggestions/undo`         | POST                     | POST: P+T (own import only)                                                                                                | refused                            | calendar                                                           | —                                     | —                                                                                     |
| `/api/calendar/subscriptions/[id]/refresh`      | POST                     | POST: P+T                                                                                                                  | no                                 | —                                                                  | —                                     | —                                                                                     |
| `/api/calendar/subscriptions/[id]`              | PATCH, DELETE            | PATCH: P ; DELETE: P                                                                                                       | no                                 | —                                                                  | —                                     | —                                                                                     |
| `/api/calendar/subscriptions`                   | GET, POST                | GET: P+T (URL hint parent only) ; POST: P                                                                                  | no                                 | —                                                                  | —                                     | —                                                                                     |
| `/api/calendar/sync-connections/[id]/calendars` | GET                      | GET: P, connecting member only (403)                                                                                       | no                                 | —                                                                  | calendar sync envs                    | —                                                                                     |
| `/api/calendar/sync-connections/[id]`           | PATCH, DELETE            | PATCH: P, connecting member only (403) ; DELETE: P                                                                         | no                                 | —                                                                  | calendar sync envs                    | —                                                                                     |
| `/api/calendar/sync-connections/[id]/sync`      | POST                     | POST: P                                                                                                                    | no                                 | —                                                                  | calendar sync envs                    | —                                                                                     |
| `/api/capture`                                  | POST, GET                | POST: P+T (child 403 "Ask a parent to add this.") ; GET: all; returns `allowed` (false for child)                          | no                                 | —                                                                  | —                                     | —                                                                                     |
| `/api/chores/complete`                          | POST                     | POST: all (any family chore, by design)                                                                                    | no                                 | —                                                                  | —                                     | —                                                                                     |
| `/api/chores/create`                            | POST                     | POST: P                                                                                                                    | no                                 | gamification (fields hidden)                                       | —                                     | —                                                                                     |
| `/api/chores`                                   | GET, PATCH, DELETE       | GET: all ; PATCH: P or assignee; P-only fields ; DELETE: P or assignee                                                     | no                                 | gamification (fields hidden)                                       | —                                     | —                                                                                     |
| `/api/chores/uncomplete`                        | POST                     | POST: P or assignee (403); only from `completed` (verified: 409 `CHORE_ALREADY_VERIFIED`)                                  | no                                 | —                                                                  | —                                     | —                                                                                     |
| `/api/chores/verify`                            | POST                     | POST: P (approve and reject)                                                                                               | no                                 | gamification (fields hidden)                                       | —                                     | —                                                                                     |
| `/api/cron/recurring-chores`                    | POST                     | POST: n/a                                                                                                                  | no                                 | —                                                                  | CRON_SECRET                           | —                                                                                     |
| `/api/cron/morning-summary`                     | POST                     | POST: n/a                                                                                                                  | no                                 | —                                                                  | CRON_SECRET                           | —                                                                                     |
| `/api/device/elevation`                         | POST, DELETE             | POST: target must be a `parent` of the device's family (DB); PIN or password; every failure the same 401 ; DELETE: n/a     | device only                        | —                                                                  | SHARED_DEVICE_ENABLED                 | —                                                                                     |
| `/api/device/label`                             | PATCH                    | PATCH: elevated parent (role, family, token_version re-read)                                                               | device + elevation                 | —                                                                  | SHARED_DEVICE_ENABLED                 | —                                                                                     |
| `/api/device/me`                                | GET                      | GET: n/a                                                                                                                   | device only                        | —                                                                  | SHARED_DEVICE_ENABLED                 | —                                                                                     |
| `/api/device/pair/claim`                        | POST                     | POST: n/a                                                                                                                  | device pairing/session (no person) | —                                                                  | SHARED_DEVICE_ENABLED                 | —                                                                                     |
| `/api/device/pair/status`                       | POST                     | POST: n/a                                                                                                                  | device pairing/session (no person) | —                                                                  | SHARED_DEVICE_ENABLED                 | —                                                                                     |
| `/api/device/revoke-self`                       | POST                     | POST: elevated parent                                                                                                      | device + elevation                 | —                                                                  | SHARED_DEVICE_ENABLED                 | —                                                                                     |
| `/api/device/session/refresh`                   | POST                     | POST: n/a                                                                                                                  | device pairing/session (no person) | —                                                                  | SHARED_DEVICE_ENABLED                 | —                                                                                     |
| `/api/device/today`                             | GET                      | GET: n/a                                                                                                                   | device only                        | —                                                                  | SHARED_DEVICE_ENABLED                 | —                                                                                     |
| `/api/device/today/version`                     | GET                      | GET: n/a (the device's own household; returns only `{ version }`, #281)                                                    | device only                        | —                                                                  | SHARED_DEVICE_ENABLED                 | —                                                                                     |
| `/api/emergency-contacts/[id]`                  | PATCH, DELETE            | PATCH: P ; DELETE: P                                                                                                       | no                                 | emergency                                                          | —                                     | —                                                                                     |
| `/api/emergency-contacts`                       | GET, POST                | GET: all (kid-readable by design, kid-access.ts) ; POST: P                                                                 | no                                 | emergency                                                          | —                                     | —                                                                                     |
| `/api/events`                                   | GET, POST, PATCH, DELETE | GET: all ; POST: all ; PATCH: P ; DELETE: P                                                                                | no                                 | —                                                                  | —                                     | —                                                                                     |
| `/api/family/ai-settings`                       | GET, POST                | GET: P ; POST: P                                                                                                           | no                                 | —                                                                  | —                                     | —                                                                                     |
| `/api/family/board-version`                     | GET                      | GET: all (the caller's own household and role; returns only `{ version }`, #281)                                           | no (tablet cookie 401)             | —                                                                  | —                                     | —                                                                                     |
| `/api/family/beta-metrics`                      | PATCH                    | PATCH: P (teen/child 403; strict body) — hand-checked (#287)                                                               | refused                            | —                                                                  | —                                     | `BetaMetricDaily` (beta usage counts)                                                 |
| `/api/family/board-settings/places`             | GET                      | GET: P                                                                                                                     | no                                 | —                                                                  | WEATHER_ENABLED                       | —                                                                                     |
| `/api/family/board-settings`                    | GET, PATCH               | GET: P ; PATCH: P                                                                                                          | no                                 | —                                                                  | WEATHER_ENABLED (weather fields only) | —                                                                                     |
| `/api/family/devices/[id]/events`               | GET                      | GET: P                                                                                                                     | no                                 | —                                                                  | SHARED_DEVICE_ENABLED                 | —                                                                                     |
| `/api/family/devices/[id]/revoke`               | POST                     | POST: P                                                                                                                    | no                                 | —                                                                  | SHARED_DEVICE_ENABLED                 | —                                                                                     |
| `/api/family/devices/[id]`                      | PATCH                    | PATCH: P                                                                                                                   | no                                 | —                                                                  | SHARED_DEVICE_ENABLED                 | —                                                                                     |
| `/api/family/devices/pairings/[id]/confirm`     | POST                     | POST: P                                                                                                                    | no                                 | —                                                                  | SHARED_DEVICE_ENABLED                 | —                                                                                     |
| `/api/family/devices/pairings/[id]`             | GET, DELETE              | GET: P ; DELETE: P                                                                                                         | no                                 | —                                                                  | SHARED_DEVICE_ENABLED                 | —                                                                                     |
| `/api/family/devices/pairings`                  | POST                     | POST: P                                                                                                                    | no                                 | —                                                                  | SHARED_DEVICE_ENABLED                 | —                                                                                     |
| `/api/family/devices`                           | GET                      | GET: P                                                                                                                     | no                                 | —                                                                  | SHARED_DEVICE_ENABLED                 | —                                                                                     |
| `/api/family/features`                          | GET, PATCH               | GET: all ; PATCH: P                                                                                                        | no                                 | —                                                                  | —                                     | —                                                                                     |
| `/api/family/feed-token`                        | GET, POST                | GET: P ; POST: P                                                                                                           | no                                 | —                                                                  | —                                     | —                                                                                     |
| `/api/family/invite-code`                       | POST                     | POST: P (teen/child 403; "Get a new family code", O-34)                                                                    | refused                            | —                                                                  | —                                     | —                                                                                     |
| `/api/family/invites/[id]`                      | DELETE                   | DELETE: P                                                                                                                  | no                                 | —                                                                  | —                                     | —                                                                                     |
| `/api/family/invites/preview`                   | GET                      | GET: n/a                                                                                                                   | no                                 | —                                                                  | —                                     | —                                                                                     |
| `/api/family/invites`                           | GET, POST                | GET: P ; POST: P                                                                                                           | no                                 | —                                                                  | —                                     | —                                                                                     |
| `/api/family/join`                              | POST                     | POST: n/a                                                                                                                  | no                                 | —                                                                  | —                                     | —                                                                                     |
| `/api/family/lookup`                            | GET                      | GET: n/a                                                                                                                   | no                                 | —                                                                  | —                                     | —                                                                                     |
| `/api/family/members/[id]`                      | DELETE                   | DELETE: P, own household only, not self, never the last parent ("Remove from household", O-34)                             | refused                            | —                                                                  | —                                     | —                                                                                     |
| `/api/family/members`                           | GET                      | GET: all                                                                                                                   | no                                 | —                                                                  | —                                     | —                                                                                     |
| `/api/family`                                   | POST, GET, PATCH, DELETE | POST: n/a (rejects if already in a family) ; GET: all ; PATCH: P ; DELETE: P, only parent, password + household name (D-3) | refused (DELETE)                   | —                                                                  | —                                     | —                                                                                     |
| `/api/family/travel`                            | GET, PATCH               | GET: P (was all) ; PATCH: P                                                                                                | no                                 | travel                                                             | —                                     | —                                                                                     |
| `/api/files/[filename]`                         | GET                      | GET: all                                                                                                                   | no                                 | —                                                                  | —                                     | —                                                                                     |
| `/api/files/chores/[filename]`                  | GET                      | GET: all                                                                                                                   | no                                 | —                                                                  | —                                     | —                                                                                     |
| `/api/handoff/[id]/regenerate-token`            | POST                     | POST: P                                                                                                                    | no                                 | handoff                                                            | —                                     | —                                                                                     |
| `/api/handoff/[id]`                             | PATCH, DELETE            | PATCH: P ; DELETE: P                                                                                                       | no                                 | handoff                                                            | —                                     | —                                                                                     |
| `/api/handoff`                                  | GET, POST                | GET: all; teen: no share token; child: `id`, `sitter_name`, `arrival_time`, `departure_time` only ; POST: P                | no                                 | handoff                                                            | —                                     | —                                                                                     |
| `/api/handoff/share/[token]`                    | GET                      | GET: n/a                                                                                                                   | no                                 | —                                                                  | —                                     | —                                                                                     |
| `/api/health/live`                              | GET                      | GET: n/a                                                                                                                   | no                                 | —                                                                  | —                                     | —                                                                                     |
| `/api/version`                                  | GET                      | GET: n/a                                                                                                                   | no                                 | —                                                                  | —                                     | —                                                                                     |
| `/api/health`                                   | GET                      | GET: n/a                                                                                                                   | no                                 | —                                                                  | —                                     | —                                                                                     |
| `/api/inventory/[id]`                           | GET, PATCH, DELETE       | GET: all ; PATCH: P+T ; DELETE: P+T                                                                                        | refused                            | inventory                                                          | —                                     | canonical: Ingredient, Recipe                                                         |
| `/api/inventory/cook`                           | GET                      | GET: all                                                                                                                   | no                                 | inventory, meals                                                   | —                                     | canonical: Ingredient, Recipe                                                         |
| `/api/inventory`                                | GET, POST                | GET: all ; POST: P+T                                                                                                       | refused                            | inventory                                                          | —                                     | canonical: Ingredient, Recipe                                                         |
| `/api/inventory/scan`                           | POST                     | POST: P                                                                                                                    | refused                            | inventory                                                          | INVENTORY_SCAN_ANTHROPIC_API_KEY      | —                                                                                     |
| `/api/inventory/use-soon`                       | GET                      | GET: all                                                                                                                   | no                                 | inventory                                                          | —                                     | canonical: Ingredient, Recipe                                                         |
| `/api/lists/create`                             | POST                     | POST: P+T                                                                                                                  | no                                 | lists                                                              | —                                     | canonical: List                                                                       |
| `/api/lists/default-grocery`                    | POST                     | POST: P+T                                                                                                                  | no                                 | lists                                                              | —                                     | canonical: FamilyMeal, List, ListItem, Recipe                                         |
| `/api/lists/items/create`                       | POST                     | POST: all                                                                                                                  | no                                 | lists                                                              | —                                     | canonical: Ingredient, List, ListItem                                                 |
| `/api/lists/items/delete`                       | DELETE                   | DELETE: P — deprecated (F-6): `Deprecation` header, kept for installed Android builds                                      | no                                 | lists                                                              | —                                     | canonical: ListItem                                                                   |
| `/api/lists/items/[id]`                         | DELETE                   | DELETE: P — hand-checked (F-6, #289)                                                                                       | refused                            | lists                                                              | —                                     | canonical: ListItem                                                                   |
| `/api/lists/items/from-recipe`                  | POST                     | POST: all                                                                                                                  | refused                            | meals, lists                                                       | —                                     | canonical: FamilyMeal, List, ListItem, Recipe                                         |
| `/api/lists/items`                              | GET                      | GET: all — deprecated (F-5): `Deprecation` header, no in-app caller                                                        | no                                 | lists                                                              | —                                     | canonical: Ingredient, List, ListItem                                                 |
| `/api/lists/items/section`                      | PATCH                    | PATCH: all                                                                                                                 | refused                            | lists                                                              | —                                     | canonical: Ingredient, List, ListItem                                                 |
| `/api/lists/items/undo-add`                     | POST                     | POST: all (own request)                                                                                                    | refused                            | lists                                                              | —                                     | canonical: FamilyMeal, List, ListItem, Recipe                                         |
| `/api/lists/items/update`                       | PATCH                    | PATCH: all                                                                                                                 | no                                 | lists                                                              | —                                     | canonical: Ingredient, List, ListItem                                                 |
| `/api/lists`                                    | GET, DELETE              | GET: all ; DELETE: P                                                                                                       | no                                 | lists                                                              | —                                     | canonical: List                                                                       |
| `/api/lists/section-sort`                       | PATCH                    | PATCH: P+T                                                                                                                 | refused                            | lists                                                              | —                                     | canonical: Ingredient, List, ListItem                                                 |
| `/api/locations/[id]`                           | DELETE                   | DELETE: P                                                                                                                  | no                                 | locations                                                          | —                                     | —                                                                                     |
| `/api/locations`                                | GET, POST                | GET: P (was all) ; POST: P                                                                                                 | no                                 | locations                                                          | —                                     | —                                                                                     |
| `/api/meals/[id]`                               | PATCH, DELETE            | PATCH: all ; DELETE: all                                                                                                   | no                                 | meals                                                              | —                                     | canonical: FamilyMeal, Recipe                                                         |
| `/api/meals`                                    | GET, POST                | GET: all ; POST: all                                                                                                       | no                                 | meals                                                              | —                                     | canonical: FamilyMeal, Recipe                                                         |
| `/api/medications/[id]`                         | PATCH, DELETE            | PATCH: P; teen/child dose-log only, own medication (sibling's 404) ; DELETE: P                                             | no                                 | sick-days                                                          | —                                     | —                                                                                     |
| `/api/medications`                              | GET, POST                | GET: P; teen/child own (`person_id = self`) ; POST: P                                                                      | no                                 | sick-days                                                          | —                                     | —                                                                                     |
| `/api/messages`                                 | GET, POST, PATCH         | GET: all ; POST: all ; PATCH: all                                                                                          | no                                 | messages                                                           | —                                     | —                                                                                     |
| `/api/notes/[id]`                               | PATCH, DELETE            | PATCH: P; teen/child own (`created_by = self`) ; DELETE: P                                                                 | no                                 | notes                                                              | —                                     | —                                                                                     |
| `/api/notes`                                    | GET, POST                | GET: all ; POST: all                                                                                                       | no                                 | notes                                                              | —                                     | —                                                                                     |
| `/api/notifications`                            | GET, POST, PATCH, DELETE | GET: all ; POST: P ; PATCH: all ; DELETE: all                                                                              | no                                 | —                                                                  | —                                     | —                                                                                     |
| `/api/pickups/[id]`                             | PATCH, DELETE            | PATCH: all ; DELETE: P                                                                                                     | no                                 | pickups                                                            | —                                     | —                                                                                     |
| `/api/pickups`                                  | GET, POST                | GET: all ; POST: all                                                                                                       | no                                 | pickups                                                            | —                                     | —                                                                                     |
| `/api/projects/[id]`                            | GET, PATCH, DELETE       | GET: all ; PATCH: P ; DELETE: P                                                                                            | no                                 | projects                                                           | —                                     | —                                                                                     |
| `/api/projects/[id]/send-to-calendar`           | POST                     | POST: all                                                                                                                  | no                                 | projects                                                           | —                                     | —                                                                                     |
| `/api/projects/[id]/tasks/[taskId]`             | PATCH, DELETE            | PATCH: P ; DELETE: P                                                                                                       | no                                 | projects                                                           | —                                     | —                                                                                     |
| `/api/projects/[id]/tasks`                      | GET, POST                | GET: all ; POST: all                                                                                                       | no                                 | projects                                                           | —                                     | —                                                                                     |
| `/api/projects`                                 | GET, POST                | GET: all ; POST: all                                                                                                       | no                                 | projects                                                           | —                                     | —                                                                                     |
| `/api/recipes/[id]`                             | GET, PATCH, DELETE       | GET: all ; PATCH: P+T (O-7) ; DELETE: P (O-7)                                                                              | no                                 | meals                                                              | —                                     | canonical: Ingredient, Recipe, RecipeIngredient; **legacy: MealPlanEntry**            |
| `/api/recipes`                                  | GET, POST                | GET: all ; POST: P+T (O-7)                                                                                                 | no                                 | meals                                                              | —                                     | canonical: Ingredient, Recipe, RecipeIngredient                                       |
| `/api/rewards/approve`                          | POST                     | POST: P                                                                                                                    | no                                 | rewards                                                            | —                                     | —                                                                                     |
| `/api/rewards/claim`                            | POST                     | POST: all                                                                                                                  | no                                 | rewards                                                            | —                                     | —                                                                                     |
| `/api/rewards`                                  | GET, POST, PATCH         | GET: all ; POST: P ; PATCH: P                                                                                              | no                                 | rewards                                                            | —                                     | —                                                                                     |
| `/api/sick-days/[id]`                           | PATCH, DELETE            | PATCH: P (kid: own 403, sibling 404) ; DELETE: P (kid: own 403, sibling 404)                                               | no                                 | sick-days                                                          | —                                     | —                                                                                     |
| `/api/search`                                   | GET                      | GET: all, by type (P every type; teen/child lists, list items and inventory only) — hand-checked (F-3)                     | refused                            | per type: family, calendar, chores, lists, meals, notes, inventory | —                                     | canonical: List, ListItem, Recipe (and InventoryItem, PinnedNote, Event, Chore, User) |
| `/api/sick-days`                                | GET, POST                | GET: P; teen/child own (`person_id = self`) ; POST: P; teen/child own (report self only)                                   | no                                 | sick-days                                                          | —                                     | —                                                                                     |
| `/api/upload`                                   | POST                     | POST: all                                                                                                                  | no                                 | —                                                                  | —                                     | —                                                                                     |
| `/api/users/preferences`                        | GET, PATCH               | GET: all (own) ; PATCH: all (own; strict body) — hand-checked (#286)                                                       | refused                            | —                                                                  | —                                     | —                                                                                     |
| `/api/users/elevation-pin`                      | PUT, DELETE              | PUT: P (requires current password) ; DELETE: P                                                                             | no                                 | —                                                                  | SHARED_DEVICE_ENABLED                 | —                                                                                     |
| `/api/users/deletion`                           | GET                      | GET: all                                                                                                                   | no                                 | —                                                                  | —                                     | —                                                                                     |
| `/api/users/export`                             | GET                      | GET: all                                                                                                                   | no                                 | —                                                                  | —                                     | canonical: FamilyMeal, List, Recipe; **legacy: MealPlan, ShoppingList**               |
| `/api/users`                                    | GET, PATCH, DELETE       | GET: all ; PATCH: all ; DELETE: all, password + `DELETE`, not the only parent (D-3)                                        | refused (DELETE)                   | gamification (fields hidden)                                       | —                                     | —                                                                                     |
| `/api/wishlist/[id]`                            | PATCH, DELETE            | PATCH: requester or P ; DELETE: requester or P                                                                             | no                                 | wishlist                                                           | —                                     | —                                                                                     |
| `/api/wishlist/[id]/status`                     | PATCH                    | PATCH: P                                                                                                                   | no                                 | wishlist                                                           | —                                     | —                                                                                     |
| `/api/wishlist`                                 | GET, POST                | GET: all ; POST: all                                                                                                       | no                                 | wishlist                                                           | —                                     | —                                                                                     |

### Recipe curation additive source candidate (#460, 2026-10-18)

- `/api/recipes/collections` GET (all personal recipe-reading roles), POST
  create/rename/delete (parent/teen), private/no-store, meals gate.
- `/api/recipes/[id]/curation` GET/PATCH, same role boundaries; current User and
  household locking plus revision-bound favorite/membership update.
- Canonical `RecipeCollection`, `RecipeCollectionEntry` and additive Recipe
  source/favorite/revision fields. Composite household FKs, export and family
  erasure inventory included. No shared-device API or separate AI recipe store.
- Source candidate only: additive migration/generation and all QA deferred.


### Prepared recipe history additive source candidate (#460, 2026-10-19)

- `/api/meals/bulk/[id]/recipe` GET: current verified personal parent/teen,
  household/session generation and meals checks, private/no-store. Paired
  identities refused by the existing authentication boundary.
- Nullable MealBatch recipe_snapshot/recipe_snapshot_at capture canonical
  recipe details at first prep completion, in the same receipt transaction.
  Explicit no-record state for legacy sessions; no current-content backfill.
- Full evidence is fetched only on demand and included in household export;
  prep lists contain only timestamp metadata. Existing batch/family erasure
  covers it. No new shared-device route, provider call or offline action.
- Source candidate only; additive migration/generation and all QA deferred.


### Ordinary meal create confirmation source candidate (#460, 2026-10-19)

- `/api/meals/create` GET/POST: current personal ordinary meal authorization,
  User/household/session/meals locks; paired sessions refused; private/no-store.
  GET returns current user/family context only. POST bounds JSON to 8 KiB and
  30 requests/minute/user, requires strict v1 envelope and Idempotency-Key.
- Canonical FamilyMeal and compact receipt commit together; actor, recipe and
  cook remain household-bound. Confirmation renews authority and existence;
  deleted meals never recreate on replay. Old `/api/meals` POST stays legacy.
- Saved recipe intent links seed existing editors only after explicit review;
  no new model, provider, offline action, shared-device API or media retention.
- Source only; integrated QA and release compatibility remain unverified.


### Recipe preview review contract candidate (#460, 2026-10-19)

- Existing `/api/recipes/preview` remains personal parent/teen and meals-gated.
  Request accepts only public HTTPS URL shape, stream-bounded to 8 KiB; outbound
  transport still pins public DNS and bounds redirects/bytes/time. All responses
  are private/no-store. No schema or write action is introduced.
- Shared response schema adds optional typed extraction-review issues; old
  previews remain readable with explicit unavailable-limit-report copy. The
  client refuses malformed/future metadata and bounds waiting/unmount behavior.
- Raw extracted ingredients/directions remain review text. Over-limit combined
  drafts are retained for explicit shortening; missing servings are not guessed.
- Source candidate only; consolidated QA and release proof remain deferred.


### Reviewed inventory intake source candidate (#125, 2026-10-19)

- `/api/inventory/intake` GET/POST: current personal parent/teen, inventory
  feature and session generation; explicit paired refusal; private/no-store.
  GET returns original actor/family context only. POST bounds JSON to 8 KiB,
  60 requests/minute/user and requires known v1 plus Idempotency-Key.
- Canonical InventoryItem + compact receipt commit together under User/household/
  receipt locks; current replay checks owned existence. Deleted rows do not
  recreate, and abandoned expired intent cannot silently become a new create.
- Photo review uses this path and immutable row recovery, not legacy create.
  Legacy manual item form/POST and broader capture remain separate unfinished
  work. No new model, queue action, provider, media store or shared-device API.
- Source only: full capture matrix in `docs/product/FOOD_CAPTURE.md`; integrated
  QA/native/compatibility evidence and normal release gates remain deferred.

### Barcode recognition extension (#125, 2026-10-19; source only)

- `/api/inventory/products` GET: current personal parent/teen inventory authority,
  same-family barcode metadata, private/no-store; paired sessions refused. Public
  lookup needs explicit `lookup=1` and disabled-by-default server reuse/contact/
  enable gates, fixed-host bounds and globally spaced DB reservations.
- Intake v1 gains an optional strict product envelope; old servers fail closed.
  Optional remembered correction, stock snapshot and receipt commit atomically;
  stale changed revision refuses before stock. No fallback to legacy create.
- FoodProduct owns recognition by `(family_id, barcode)`; it is not stock. Export
  parent/teen library, household deletion and personal stock metadata are wired.
  Shared Use soon selects unchanged minimal fields. Additive schema/migration is
  authored only; no client generation, migration or QA has run.

### Manual inventory create intake (#125, 2026-10-19; source only)

- Personal Add item uses dedicated intake v1 and immutable uncertain-save ownership
  with original actor/family; no legacy POST fallback. Standalone context waiting
  is bounded. Edit/adjustment/delete contracts are unchanged.
- Source tests and EN/ES state are updated; consolidated QA remains deferred.

### Food-document suggestion extension (#125, 2026-10-19; source only)

- `/api/inventory/scan` optional explicit package/receipt mode uses known
  `herewoven.food-photo.v1`, original actor/family, personal parent authority and
  separate disabled document-processing gate. Legacy fridge shape remains.
- Multipart bytes/time and provider JSON bytes are bounded. Post-read personal
  authority/role/feature checks renew access before suggestions are returned.
- Output keeps printed label/date evidence transient. Receipt dates/storage are
  stripped, package weight is not stock, and dates require explicit apply/edit.
  One-item document review starts unselected. No media store or new provider.
- Intake optional strict label package_size snapshots reuse InventoryItem and
  its atomic receipt; no barcode/product row is invented. Old strict servers
  refuse unknown extensions; no legacy fallback or new offline action advertised.
- Tests/EN-ES source only, not QA or provider/native acceptance evidence.

### Versioned personal stock changes (#125, 2026-10-19; source only)

- `/api/inventory/change` POST: strict inventory-change.v1, original actor/family,
  issued-at, key required, 8-KiB stream bound and 60/minute/person; paired refusal
  and private/no-store for every response. No native/offline action advertised.
- Fresh User/household/receipt/item locks cover stock, canonical adjustment and
  compact pointer receipt in one transaction. Consume/discard require the reviewed
  item version. Undo checks the version left by the adjustment; stale work refuses.
- Replay/current confirmation rechecks owned history and stock, never recreates
  deleted rows or exposes cached quantities as current. Client owns exact unknown
  intent through later access refusal; explicit no-effect results permit refresh.
- Canonical adjustment primitives now accept the caller's transaction; old route
  wrappers retain compatibility. Their legacy auth/receipt contracts and edit/
  removal paths are not upgraded by the new endpoint. QA remains deferred.

### Stock edit/remove extension (#125, 2026-10-19; source only)

- inventory-change.v1 adds strict edit/remove with reviewed item versions; compact
  item/kind receipts, no fabricated adjustment history or deletion Undo.
- All change confirmation also requires matching completed actor/family/action/
  request-hash proof. Remove confirms historical deletion even after stock/history
  cascade; absent/mismatched proof stays unknown. Edit still checks current owned
  existence and never reapplies cached fields.
- `inventory-edit.ts` provides canonical transaction primitives for new changes
  and old PATCH/DELETE. New writes include receipt/current-authority boundaries;
  old client-context/replay contracts remain explicitly legacy. Failed legacy
  delete completion-row update now rolls back the deletion.
- Personal editor uses the existing recovery owner and a collapsed readable edit
  summary; source tests/EN-ES only. Consolidated QA and native acceptance deferred.

### Cooking presence evidence (#125, 2026-10-19; source only)

- Cook and recipe-grocery review add optional link/name provenance and explicit
  presence-only semantics. Zero stock is excluded before cooking/use-soon caps;
  unknown positive availability never implies enough-for-recipe amounts.
- Owned recipes with foreign ingredient links are skipped whole with incomplete
  disclosure. Personal cook JSON is bounded/validated; old presence replies retain
  an explicit unknown-details fallback. No new stock write or provider action.
- Personal Today counts use the same eligibility and omit inconsistent ownership;
  shared DTOs/selects retain their existing minimal field boundary. QA deferred.

## Cooking-stock handoff source — 2026-10-20

Recipe and prep dish links open an Inventory sheet with scoped canonical
recipe/captured-history ingredient context. GET `/api/inventory/cooking-review`
is private current parent/teen authority, bounded and household-owned. Explicit
lot selection opens the existing amount-used editor and stock/recovery/Undo
write path. No auto allocation, conversion, separate stock model or atomic
recipe-consumption ledger. Source tests authored/unrun; acceptance deferred.
See `../architecture/COOKING_STOCK_REVIEW.md`.

## Grocery review read recovery — 2026-10-24 (source only)

Latest bounded source work adds a 15-second fetch-plus-body deadline to the
read-only recipe-to-grocery preview (#134). Dismissal, replacement and unmount
cancel the current read; a generation guard keeps late replies from replacing
newer review state. Transport bridges ignoring abort still settle locally.
Failures use the existing localized review error; retry is close/reopen, with
no automatic replay or write. Canonical schema/recipe matching, household
endpoint, reviewed payload, add key and Undo path are unchanged. Regression
source covers header/body stalls, dismissal, pre-cancel and unsuccessful reads;
it is authored but unrun. Response size is not bounded by this change.
No QA/test/check/build/browser/API/database/native/provider/release ran.
Original #134/#460 runtime, role/isolation and device acceptance remain open.

## Recipe picker search and explicit pages — 2026-10-24 (source only)

Latest bounded source work replaces the meal recipe picker's eager traversal
of up to10,000 recipes with canonical full-library search and explicit24-row
replacement pages (#460/#134). Search resets continuation; debounce, cancellation,
fetch/body deadline and generation ownership bound pending reads. Current choice
is pinned while browsing/searching; free-text meals and inline canonical create
remain. Response validation rejects malformed/duplicate/oversized rows or invalid
continuation; retry repeats the same page without replaying a save. EN/ES controls
are typed. The existing offset API can shift under concurrent edits; this is not
snapshot/keyset pagination, byte-bounded transport or backend index evidence.
Regression source is authored/adapted but unrun. No QA/test/check/build/browser/
CI/API/database/native/provider/push/merge/deploy ran. Full #460/#134 acceptance
remains open.

## Shared bounded recipe read transport — 2026-10-24 (source only)

Latest bounded source work reuses shared runOwnedForeground and bounded JSON
decoding for recipe picker, grocery review, saved-recipe reuse and prepared-recipe
history reads (#460/#134). This replaces two duplicated deadline implementations;
reuse/history now settle ignored-abort header/body stalls at their existing10s
limit, picker/review retain15s. One1MiB response limit streams where supported;
JSON-only bridges are checked after allocation, not pre-allocation protection.
Canonical endpoint/schema/ID matching, stored history, selection and explicit
retry remain; no write/provider/reimport or current-recipe history fallback.
Regression source is authored/adapted but unrun. No QA/test/check/build/browser/
CI/API/database/native/provider/push/merge/deploy ran. Original runtime/isolation/
responsive/native and complete recipe acceptance remain open.

## Dormant mixed-capacity engine — 2026-10-24 (source only)

Latest bounded source work adds a dormant seeded capacity workload model and
mixed-load engine (#137). Fixed stages, eight-domain weights, small-stage skew
refusal, sentinel exclusion, per-worker serialization, bounded callbacks/scenarios,
warmup separation, fail-closed adoption and content-free report source are authored.
No CLI/adapters/dataset are silently substituted: canonical fixture builder,
all-domain route adapters, provider/process isolation, resource sampler and outcome
reconciler remain unfinished. Worker counts are not measured active sessions;
request counts/bytes are adapter reports, not transport proof. Regression source
is authored but unrun. No QA/test/check/build/browser/CI/API/database/load/provider/
push/merge/deploy ran. #137 clean-environment reproducibility/capacity/drill and
all original runtime/production acceptance remain open.

## Partial capacity dataset constructor — 2026-10-24 (source only)

Latest bounded source work adds a partial pure capacity dataset constructor
(#137) using existing canonical fixture row factories. Supported household/account,
event, list/item, recipe/ingredient/line and family-meal rows emit in deterministic
batches<=200, with dedicated fabricated IDs, declared UTC clock,20% tied sort-key
cases and two sentinels. The versioned manifest explicitly remains incomplete;
profile/device, stock ledger, routine/prep history and other dimensions are named
unsupported rather than fabricated. Counts are construction expectations, not
seeded observations. No writer/seed/reset/CLI or production path is connected.
Regression source is authored but unrun. No QA/test/check/build/browser/CI/API/
database/fixture/load/provider/push/merge/deploy ran. #137 complete adoption,
canonical adapters, reconciliation/resource sampling and all original acceptance
remain open.

## Dormant unlink definition payload bound — 2026-10-24 (source only)

Latest bounded source work bounds the dormant routine unlink reader's definition
payload (#557). It locks/sizes all candidate metadata first, then refuses per-root
JSON above64KiB or aggregate JSON above4MiB before transferring definitions.
Invalid ownership/size metadata and a missing/replaced/duplicated second inventory
hold the whole preparation without partial rewrites. Existing1,000-root cap,
unknown-definition refusal and caller-owned lifecycle/owner-proof requirements
remain. This bounds serialized transfer, not PostgreSQL scan/serialization,
object overhead, lock duration or query plans. No unlink writer/endpoint/UI or
account activation is connected. Regression source authored/adapted but unrun.
No QA/test/check/build/browser/CI/API/database/native/provider/push/merge/deploy
ran. Full unlink/provenance/domain/credit/Undo and original acceptance remain open.

## Complete bounded ICS assembly — 2026-10-24 (source only)

Latest bounded source work replaces the2,000-event ICS refusal with complete
snapshot assembly (#124/#134). Token/household resolution and projected200-row
(start_time,id) keyset reads share one30-second RepeatableRead transaction.
Successful output is assembled only after complete traversal; explicit10,000-event
and16MiB wire limits retain whole-feed503/no-store refusal. Stable UID/timestamps,
UTF-8 folding, range/recurrence and successful cache behavior remain. Wider legacy
DB rows still allocate before the wire budget; total DB/JS memory, query plans,
snapshot/concurrency and provider behavior are unmeasured. Regression source for
2,400/exact-limit equal-date traversal, count/byte refusal and transaction options
is authored/adapted but unrun; fake transactions prove no PG isolation. No QA/test/
check/build/browser/CI/API/database/provider/push/merge/deploy ran. Original calendar/
role/isolation/native and all release acceptance remain open.

## Stored recurrence feed boundary — 2026-10-24 (source only)

Latest bounded source work adds a stored-recurrence feed guard (#124). Structural
checks plus the existing lockedical.js parser refuse malformed/ambiguous/unsupported
rules without expansion or normalization into a different interpretation. Supported
rule order/values retain existing uppercase/prefix treatment. A bad rule holds the
whole feed with503/no-store and a content-minimal code; no skipped series, successful
prefix, one-off replacement, storage rewrite or input-schema change. Parent-facing
rule repair and exhaustive cross-part/DST/provider semantics remain separate.
Official parser source was read; no parser was executed. Regression source authored
but unrun. No QA/test/check/build/browser/CI/API/database/provider/push/merge/deploy
ran. Original calendar/isolation/native and all release acceptance remain open.

## Parent recurrence repair discovery — 2026-10-24 (source only)

Latest bounded source work connects private parent recurrence-repair discovery
(#124/#499). A lazy Settings EN/ES overlay reads100-event groups through a new
personal-parent API, with paired-device refusal, current-family scope header,
family-bound cursors, no-store and minimal affected-event DTOs. No token/raw rule
leaves the server. The shared foreground/body bounds, generation/cancel ownership,
exact-cursor retry and stale-household reload preserve current context. Existing
local editor/source-calendar links retain mutation/read-only authority; no repair,
provider or token action happens automatically. Group results do not verify the
full feed/capacity/provider state, and concurrent groups are not a snapshot.
Regression and device-inventory source authored/adapted but unrun. No QA/test/
check/build/browser/CI/API/database/provider/push/merge/deploy ran. Canonical repair,
role/isolation/rendered/native and original acceptance remain open.

## Explicit repeat removal and locked event PATCH — 2026-10-24 (source only)

Latest bounded source work adds explicit parent repeat-rule removal to the
canonical event editor (#124). Ordinary edits omit recurrence; removal is a
reviewed draft choice with pre-save cancellation and exact saved-rule precondition.
Canonical PATCH now uses user/household/event locks and renews current parent,
session, ownership, source/range and rule before one scoped update. Changed rules
hold the entire metadata save; the EN/ES form retains its draft. Subscription
read-only policy remains; optional precondition preserves legacy client bodies.
No replacement schedule, generated-row deletion, post-save Undo, automatic retry,
offline action or provider dispatch is introduced. This is not full event-version
concurrency or an idempotent receipt. Regression source authored but unrun; fake
transactions prove no PG locks/rollback. No QA/test/check/build/browser/CI/API/
database/provider/push/merge/deploy ran. Broader repeat editing and original calendar/
isolation/native/release acceptance remain open.

## Event create/replay lifecycle authority — 2026-10-24 (source only)

Latest bounded source work shares current User/household/session/known-role
calendar authority across create, completed-create replay and edit (#134/#124).
Normal creation now renews lifecycle authority before event/activity effects or
private receipt reads, and normal keyed replay has the same renewal as AI-backed
recovery. Parent/teen/child create and parent-only edit policy, key/hash/receipt
semantics and optional beta counting remain. AI first effects retain source/lease
verification; completed replay renews ownership without requiring fresh source.
Outer idempotency claim/refusal ledger writes can precede the effect check. No new
permissions, provider/offline action or activation. Regression/integration source
authored/adapted but unrun; fake transactions prove no PG concurrency/rollback.
No QA/test/check/build/browser/CI/API/database/provider/push/merge/deploy ran.
Original isolation/calendar/native/release acceptance remains open.

## Personal item/capture lifecycle renewal — 2026-10-24 (source only)

Latest bounded source work renews personal grocery item/capture authority
(#134/#135). Current user/household/role/session/feature and explicit destination
checks now cover normal/strict-grocery first effects and completed replay. Capture
checks its receipt before default resolution, retaining parent/teen permission;
ordinary existing-list adds still permit parent/teen/child. New-default item failure
throws for transaction rollback. Canonical item/ingredient/section writes, queue
owner/body/key/hash/expiry and separate device auth remain. No resolver or second
item is run for completed capture recovery; explicit deleted/type-changed targets
refuse. List/note container creates already had renewal and were left unchanged.
Regression/route/integration source authored/adapted but unrun; no PG rollback or
concurrency result is claimed. No QA/test/check/build/browser/CI/API/database/
provider/push/merge/deploy ran. Original isolation/offline/device/release acceptance
remains open.

## Note mutation lifecycle authority — 2026-10-24 (source only)

Latest bounded source work connects note edit/delete to one locked canonical
mutation (#134/#136). The existing list-container/note base authority is extracted
and reused, preserving create/replay policy. Notes renew current role/session/
household and stored feature permission, then lock/re-read the owned note/creator
before a scoped mutation. Parent-any/teen-child-own edit and parent-only delete,
body/color normalization, request/success DTOs and device refusal remain. Missing/
foreign locked targets share404. No new version/Undo/receipt/queue/AI permission
or activation; this is not complete content-conflict resolution. Regression and
existing two-household route source authored/adapted but unrun; no PG locking or
rollback result claimed. No QA/test/check/build/browser/CI/API/database/provider/
push/merge/deploy ran. Original isolation/offline/device/release acceptance remains
open.
