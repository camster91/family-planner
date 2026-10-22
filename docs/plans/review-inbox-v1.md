# One review inbox — #123 execution contract

Status: initial parent read source authored 2026-10-21, unrun and undeployed.
This plan continues approved scope; it is not evidence that all review types work.

## Canonical authority

The inbox discovers work and opens the existing domain review. Chore owns checks;
Event/Preparation owns timing decisions; Capture owns extracted normalized drafts;
Recipe owns import/duplicate/favorite/collection decisions; each domain owns its
exact request journal, receipt and current source validation. Do not copy pending
write bodies into a second queue or treat an old receipt as current record state.
No autonomous calendar write, purchase, deletion, external message or bulk approval.

Parent checks and changed preparation currently use current household-scoped raw
reads and exact IDs. Parent role renews in each query; device sessions are refused
by getServerUser. No private inbox rows enter device/shared DTOs. Prep gate/schema
absence is paused. Reads are bounded (21 raw candidates, 20-window projection,
five visible rows); filtered-empty windows retain continuation. No false all-clear.

## Remaining implementation

1. Define strict adapter envelopes for extracted notices, calendar proposals,
   recipe/capture drafts and existing owned pending requests. Each must state
   domain, source identity/version, current owner/household generation, created/
   evaluated time, confidence or explicit unknown, visible safe summary, editable
   canonical fields and exact supported review location. IDs must be verified
   against current authorized domain records; do not resolve by display names.
2. Existing capture proposals are currently in their domain flow; add deliberate
   owner-scoped draft persistence only with bounded content/retention, erasure,
   logout/household retirement, storage-error recovery and normal form fallback.
   Preserve drafts on provider/parser/read/save failures. Do not persist prompts,
   photos, credentials or provider raw output as inbox metadata.
3. Owned saved requests require a read adapter that cooperates with existing
   journal leases/retirement. Never initialize/reconcile competing journals just
   to show a count, inspect another owner's namespace, drop unknown requests,
   resend on inbox mount, or introduce a second receipt authority.
4. Review handoff must preserve the exact edited draft/request, let the original
   domain reread/revalidate current sources and confirm an exact preview. Keep
   source-deleted, expired, unsupported, paused and unknown proof distinct.
5. Parent sees authorized household reviews; teen/child readers require explicit
   per-domain own/allowed projections. Email-free profiles remain subjects.
   Shared-device review needs its narrower paired-session contract and approved
   safe fields; it must never reuse the parent inbox response.
6. Add source/confidence/unknown and short decision screens, source-level filters,
   Back/focus restoration, draft protection and EN/ES states. Reconcile modal
   ownership with preparation/schedule/responsibility before overlay adapters.
7. Connect privacy-safe fixed-vocabulary telemetry; no household text, raw IDs,
   tokens, prompts, notes or credential-bearing errors. Keep action/proof/state
   outcomes distinct, including user dismissal versus confirmed canonical save.

## Deferred acceptance

After all implementation, verify real two-household isolation, role/device/source
retirement, source changes while open, exact recovery/duplicate replay, provider
failure, inaccessible storage and owner-switch drafts. Verify rendered EN/ES,
keyboard/screen-reader/Back, five-row windows, mobile/tablet/desktop, offline and
native lifecycle. Authored mock cases are not PostgreSQL/UX acceptance. Existing
release/rollback and deployment gates still apply; no activation from this plan.


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


## Next owned-draft lifecycle slice

Before persisting capture/recipe forms, bind a bounded full editable document to
current person/session-generation/household/feature authority and explicit source/
confidence/unknowns/evaluated-time/expiry. Retain all edited ingredient lines,
partial numeric strings and original source context without prompts/photos/raw
provider output. Do not silently shorten a restored form to make it valid.

Separate editable local documents from immutable submitted intents. Freeze and
durably stage the exact original canonical request key/body before sending; a
restored or edited form must never create a fresh request after an unknown prior
result. Keep unknown, expired, refused, duplicate-source and current-record-deleted
states distinct. Canonical receipt inspection/current record checks must precede
retiring the exact submitted document. A local draft is not proof of failure or
success. Add an explicit duplicate-risk review only where the domain permits it.

Reuse existing owned storage CAS/lease/retirement/uncertain-write recovery rather
than a parallel inbox queue. Add bounded retention/erasure/logout/household/gate
rollback and full Back/link/programmatic navigation protection, including failure
to flush. The current in-memory host and recipe handoff are not that persistence
or its acceptance evidence. QA remains after the source implementation.


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



## Draft discovery and recipe recovery entry — 2026-10-21 source checkpoint

- `readSavedReviewRequests` now supports recipe/capture documents via the same
  `readOwnedRequestSnapshot` lease and strict owned journal, with current parent
  role/identity/domain/adoption checks before projection. One shared domain match
  helper is used by both journal and inbox. Unknown, paused and expired entries
  are not removed or converted into retry approvals. No journal initialize,
  receipt read, provider request, content copy or store write occurs in discovery.
- Rows distinguish editable work from submitted/unknown work; projection includes
  only fixed kind, phase, update time and allowlisted original recovery URL. The
  five-row device check remains explicit and clears on identity/overlay changes.
- `/dashboard/meals/review` is a direct parent/teen personal recovery entry into
  the existing recipe editor. No import is needed. A recovery-only empty result
  stays an empty review; pre-adoption does not claim stores were checked or start
  a new draft. Existing paused controls remain authoritative. Route/server identity
  and client renewal agree; child/paired/fridge surfaces receive no draft host.
- Meals exploration links to that original recovery route. EN/ES labels cover
  editable/submitted distinction, direct entry and unadopted recovery.
- Discovered canonical-domain defect: text `kind: task` was being confirmed via
  calendar event create. It is now held for a parent to review in the canonical
  chore form, opened separately so the preview stays in the original tab. The
  availability endpoint supplies current role for that link; unknown/teen roles
  do not receive it. Existing event/grocery confirmations are unchanged.

Still required source: connect CaptureBox to the owned editable/frozen lifecycle;
keep historical owned recovery reachable when provider extraction is disabled;
retain legacy exact envelopes in their original recovery flow without duplicate
migration; preserve stable per-row keys through whole-batch freeze and uncertain
partial outcomes. Task handoff must use canonical parent-only chore creation,
retain unknown assignment/points/schedule for explicit review, and never convert
a task to an event or promote a profile into an actor. The current manual link is
not that integrated workflow. Capture's inbox read adapter is not proof its owned
host is complete. Finish full programmatic/host exits, what-changed timeline,
role/routine links and grounded AI scope before the consolidated QA pass.

Authored read-only adapter cases cover private-field exclusion, paused/expired
editing, submitted/unknown state, foreign body/current role/adoption refusal; task
UI cases prevent event submission for parent/teen. All unrun. Source/formatting
only; no checks, execution, activation, issue closure or release evidence.


## Owned capture host — 2026-10-22 source checkpoint

`CaptureDraftBoundary` now owns the capture lane of the existing review-document
journal. The original reader runs in extraction-only mode after adoption; it does
not initialize/write the old envelope store or submit canonical records. Full
allowlisted fields and fixed provenance/unknown markers become an editable local
document. Original input/photo/provider bytes never enter it. Explicit replacement
review and source epochs keep failed/empty/stale reads from replacing prior work.
Manual event/grocery rows and saved review remain available without an AI provider.

Capture review fields preserve partial strings and stable client IDs, validate
source instants without natural-language parsing/calendar rollover/DST-gap repair,
and keep user notes/source list context for review. Grocery confirmation names the
household grocery destination; no arbitrary list name becomes a record identifier.
Tasks are retained for parent-only canonical chore review, never submitted as
calendar events. Event/grocery rows and frozen request cardinality/action kinds
are bound in the strict document contract. Every remaining row across every page
is frozen before the first submit; request keys/bodies never change after unknown
or partial success. Both editable and frozen windows show five rows at a time.

Retries inspect the original receipt before transport, and a single-request proof
read now renews the same journal lease after a successful response. Stored batch
content is not filtered down to failed rows. Explicit completion requires fresh
committed/current evidence for every request. A separate acknowledgement can finish
known removed items while keeping them deleted; opaque/expired/absent/pending
results cannot be dismissed as successes or silently rekeyed. Parent host refresh
also follows recovered committed proof, not just a newly observed 2xx response.

Earlier envelopes remain in an explicit legacy recovery-only pane. That mode can
initialize/read their original store when extraction is unconfigured, hides new
prompt/photo inputs, and keeps the original receipt controls; it does not copy or
merge those requests into the owned journal. Before adoption the existing legacy
form remains independent of browser owned-storage support. Existing unit cases now
name the legacy path, alongside new owned capture cases; no test run is claimed.

Original person/session/family/role and exact storage baseline remain authoritative
through focus, visibility, storage and open/closed host changes. Closed sheets and
hidden inbox categories do not intercept another screen's dashboard navigation.
Transient source input is kept only in its screen and warns on leaving. Camera/file
picker return renews ownership before a provider read can proceed; late proposals
cannot stage after a newer source epoch. These mechanisms still need deferred
rendered/physical-device acceptance. No source-only claim establishes Back, focus,
privacy, timeout, no-loss or visual correctness in a live browser/device.

Source still required: integrated task-to-chore handoff with explicit assignment/
points/schedule review, full programmatic/host exits and cancellable foreground
reads; broader role/routine/inbox timeline/AI scope. Finish those before running
consolidated QA. All new helper/storage/UI cases remain unrun; no flags, DB/schema,
provider activation, push/merge/deploy or issue state changed.


## Captured chore review — 2026-10-22 source checkpoint

The earlier manual handoff is replaced with the existing chore editor in a nested
sheet inside owned capture. Parent choice is explicit; no source name becomes an
account/profile identifier, and no inferred schedule/points/description is imported.
Full partial editor fields live on the existing capture row, excluding raw photos
or prompts. A deliberately reviewed canonical body is invalidated by later edits.
The editor makes no chore write; batch confirmation freezes all original rows and
keys before any event/chore/grocery effect. Account/profile chore actions go through
the bound dispatcher and existing canonical endpoint, never the event endpoint.

Account creation now has an atomic compact receipt alongside the canonical chore
and recurrence expansion. Current parent/session/household and assignee/rotation
membership renew in the locked transaction. A completed takeover returns the
original pointer without another create or notice. Legacy no-key creates and
ordinary hydrated responses remain separate from bound review responses. Profile
creation preserves the existing strict protocol-2 and private capability gates;
bound review opts into compact receipts and current token-generation validation.
The new state-only receipt route checks current parent authority before looking
up an original same-user/family/action/hash key. Missing, pending, expired,
committed-present, removed/erased and opaque states remain distinct. It never
replays a mutation or returns cached chore contents. The owned store's existing
receipt-first retry/finish protocol now handles both chore actions too.

Source cases are authored but unrun, including a guarded disposable-Postgres suite
for lost response/takeover/rollback and authority changes. Formatting is not QA.
No runtime, privacy, visual, device or release acceptance is claimed. No flags,
provider, database, CI, push/merge/deploy or issue status was changed. Next work
remains the full navigation/foreground cancellation contract and the remaining
role/routine history/inbox timeline/grounded-AI implementation before consolidated QA.


## Owned draft navigation and read cancellation — 2026-10-22 source checkpoint

Capture and recipe use a shared in-memory exit barrier with no copied document
content. Active editors all prepare before any history sentinel releases. Each
preparation renews original identity/storage and flushes the latest reviewed
fields; changed work/owner or a failed save refuses navigation. A registered
owner disappearing/changing during preparation, a failed release and concurrent
requests also refuse. Approved synchronous host navigation reuses the same commit
instead of recursively preparing. Existing Back/unload and dashboard anchor
interception remain; local close and app-owned programmatic routes now use the
same barrier. Hidden capture hosts are inactive. Owner-retired views can leave
after private fields are cleared without adopting another person's store.

The 27 current non-session route-changing callers use the draft-aware router.
Command palette and assistant close only after accepted navigation; overlay
providers reset pending navigation refs on refusal. Calendar view/date state
waits for the accepted URL change. Refresh-only methods keep existing behavior;
explicit sign-out keeps its canonical privacy cleanup and raw-router exception.
Future route-changing code must use the wrapper or the owned controller's
already-prepared commit; it must not invent a browser-history monkey patch.

Source reads (not canonical effects) now have foreground cancellation, full-job
45-second deadlines covering image decoding, 256 KiB response bounds and stale
reply suppression. Stop controls stay outside disabled owned fields. Blur/hidden
host/close/unmount cancels reads; original reviewed rows and typed phrases remain.
Metadata availability reads are separately bounded at15 seconds and discard stale
responses. The shared bounded request utility honors external signals even when
native fetch ignores them; cancellation means unknown, never proof of noncommit.
Server/provider execution deadlines and cost are separate from client cancellation.

Transport/barrier and mounted no-loss/late-source cases are authored, all unrun.
Only source inspection/editing and selected-file formatting. No runtime checks,
activation, provider, database, native, CI, push/merge/deploy or issue closure.
Consolidated QA must inspect actual host/Back/failed-flush/retirement/rapid-input/
focus/native-bridge/process-loss paths and the known/unknown batch-refusal UX;
source mechanisms do not establish those acceptance claims. Remaining role,
routine provenance/history, authorized timeline and grounded-AI scope stays open.
