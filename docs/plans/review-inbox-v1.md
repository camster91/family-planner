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

