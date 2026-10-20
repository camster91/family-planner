# Schedule conflict review — #123 implementation contract

Approved workflow: detect authorized conflicts, explain constraints, offer
alternative times and editable preparation/travel buffers, preview before an
explicit change, preserve original events until confirmation. This contract
covers the whole required journey; the pure planner is only its first source
layer. No provider or AI is required to use it.

## Meaning and scope

- The existing Event table, calendar range APIs, event forms and source badges
  remain canonical. Do not create parallel proposals-as-events or buffer events.
- Event currently has no attendance model. A time overlap is a possible schedule
  conflict, never proof that two events require the same person. Do not infer
  attendance from creator, household membership, title, location or a profile.
- Preparation, travel before and travel after are separate editable minute
  amounts. Zero means no buffer requested, not zero actual travel. No geocoding,
  route estimate, external location sharing or learned travel claim is implied.
- Compare all authorized calendar sources, regardless of the visible source
  filter. Show local/connected/subscribed provenance and incomplete coverage.
  A source refresh failure, cap or unexpanded recurrence is an explicit unknown.
- Work in actual instants, with a named IANA display zone. Explicit search
  windows determine allowed time; never assume work hours, school hours or sleep.
  Original event duration is preserved, including seconds, across DST changes.
- Proposals change one canonical concrete event only. Do not silently move a
  recurrence series or invent occurrences. Repeating/unsupported targets hold
  until an explicit occurrence/series scope is implemented through #124's
  canonical recurrence contract; broader recurrence acceptance stays open.

## Full journey / remaining vertical implementation

1. Read current personal actor/session/household/role and current calendar data
   under the existing locks and authorization boundary. Refuse paired devices;
   selected profiles do not authenticate. Shared fridge defaults expose no new
   personal review context. Read permission does not grant reschedule permission.
2. Provide a bounded, minimal, current snapshot of canonical event identity,
   title, times, origin, concrete/repeating state and server-issued source/version
   tokens. No descriptions, addresses, credentials, attendee guesses or provider
   secrets. Parents alone may apply; teen/child reads follow canonical calendar
   access. Revalidate source editability and rollout gates at confirmation.
3. Bind the snapshot to the actor/household, query range/zone, complete versus
   truncated/recurrence coverage, and sorted exact event epochs. Query the padded
   boundary needed by all allowed buffers, including events crossing a range.
   A source filter must not conceal blockers. Persist no unsupported availability
   claim. Validate duplicate IDs, invalid times and unknown fields as failures.
4. A short EN/ES conflict sheet shows selected event, possible overlaps and their
   actual intersections, editable buffer chips/disclosure and explicit search
   windows. Preserve the draft on network/conflict errors. Show three closest
   openings, reasons and coverage unknowns; partial knowledge never means free.
   Reuse the existing rounded form dialog, focus/Back conventions and canonical
   event details. No public design-approval claim is made by this source contract.
5. A separate preview shows exact original/new times, duration and zone/offset,
   preparation/travel amounts, which constraints were compared, source and any
   unknowns. No mutation on open/read/search/voice/locale/focus. Partial coverage
   and unsupported targets hold apply; changing any input invalidates selection.
6. Confirm through a canonical event reschedule service, not a second event
   store or provider bypass. Lock actor then household, related identity/source
   rows before events in stable order, and renew current role/token/family.
   Bind original user/family/source generation+epoch/snapshot/range/preferences,
   issuedAt and exact proposed instants. Guard the whole compared range against
   phantom inserts/deletes, not only the selected event row. The current source
   uses immutable per-insertion/material Event versions plus one atomic SQL
   comparison-and-update statement after the selected target is locked. Its
   bounded current-source set and the time effect share a statement snapshot.
   No family-wide version row is locked by legacy Event triggers: multi-event
   updates/cascades must not acquire collection-then-another-Event locks.
   Merely comparing updated_at, taking Event row locks or trusting an earlier
   list query is insufficient. A later independent event change can introduce
   a new conflict after that validation point; never claim permanent availability.
   Recompute live constraints; stale,
   missing/foreign/changed sources or new overlapping records hold unchanged.
   Ordinary legacy event writers must participate in source invalidation: an
   updated-at/content hash alone cannot close away-and-back or delete/recreate.
   Author an additive immutable generation/monotonic material epoch migration,
   trigger/compatibility/lifecycle source before activating the guarded writer.
7. An atomic minimal receipt and exact owned journal protect repeated confirm,
   timeout, crash and abandoned-key takeover. Original body/key survive unknown
   results. Inspection/retry/forget are explicit; receipt proof is separate from
   fresh current event state. Close-before-stage completion must not send late.
   No autonomous calendar/provider write, message or external invitation.
8. Refresh canonical calendar/weekly review after a confirmed effect. The view
   may explain another unresolved constraint; do not label a week conflict-free
   from one successful move. Rollback hides new controls/writes while preserving
   canonical events, owned pending work inspection and lifecycle cleanup.

## Algorithm source contract

`src/lib/calendar-planning/conflict-review.ts` uses strict validated trusted
snapshots and actor-bound review requests. It compares half-open buffered
intervals, keeps exact event duration, merges overlapping requested windows and
busy intervals, and derives candidate gap boundaries/nearest grid points without
minute-by-minute scans. Candidates are deduplicated and ranked by distance from
the original start, then time, with a fixed maximum of three. Buffer-only versus
actual-event overlaps are separate explanations. A snapshot token is binding
metadata, never a client-created authorization credential. The server must build
it from fresh canonical source epochs, not trust supplied events or canMove.

Source caps are explicit (500 events, 16 search windows, 100 explicit other-event
buffer overrides, eight blocker previews and three alternatives). Whole range
is at most 45 actual days, matching the existing calendar read ceiling. Each
buffer is 0–240 integer minutes. The algorithm has no I/O, side effects, fallback
household data, provider context or clock hidden behind Date.now(). Incomplete
coverage can return provisional timing options, but never an applicable move.

## Required later acceptance (not yet run)

Source cases and later exact-candidate checks must cover zero-duration/invalid/
duplicate records; adjacency versus overlap; nested/dense/midnight/ongoing events;
prep/travel-only constraints; several windows; exact duration/seconds; DST gaps,
folds and offsets; unknown/capped/failed sources; recurrence uncertainty; source
filter independence; parent/teen/child/device/foreign-household negatives;
concurrent edit/insert/delete/recreate/away-and-back; double confirm, unknown and
mismatched acknowledgements, immutable retries, storage divergence/retirement,
close/Back/process death; EN/ES, long text, focus/a11y and all device sizes.

Current source status: contract and strict pure planning layer only. Canonical
snapshot/epoch schema and lifecycle, authenticated API/apply/receipt/recovery,
EN/ES controls/discovery and weekly integration remain required code. All QA,
DDL/schema/client/DB/API/provider/browser/native/CI/release and activation are
unverified and deferred. Do not close #123 or replace the full workflow with an
advisory-only link. Continue the full vertical implementation next.


## Canonical source epochs and atomic comparison source — 2026-10-20

`database/migration-zzzzzzz-schedule-review.sql` and additive Event Prisma fields
now author an immutable per-insertion UUID and monotonic material epoch. A
BEFORE UPDATE trigger covers existing local/provider/project/legacy writers,
including title/instructions/location/times/recurrence/source/identity/family
changes and away/back changes. Delete/recreate gets a new default generation;
updates cannot replace it or lower the epoch. Saturation holds new review use
while ordinary domain edits remain possible. Technical updated_at-only edits
do not invent material changes. There is no extra schedule/consent store or
family-version row. Event's existing canonical cascades/export/lifecycle remain
authoritative; no untracked identity, location or checklist JSON is introduced.
Additional range-end and partial recurrence/invalid-interval indexes are source
only; partial indexes are intentionally SQL-owned.

`schedule-source.ts` probes required NOT NULL columns and the enabled row-level
BEFORE UPDATE trigger/function. Scoped target locks return only technical source
metadata. The common comparison predicate includes the target, every authorized
source in a buffer-padded range, all stored recurring roots and invalid legacy
intervals; absence of usable timing data is not free time. A single-statement
minimal comparison read returns 501 rows to signal the 500-row cap without
silently claiming complete coverage. Fingerprints bind original owner/role/token
version/range/IANA zone/coverage and sorted event source tokens, excluding titles,
notes, addresses and provider secrets. The strict query/command now carries its
original range and zone so an eventual apply service can reconstruct scope
rather than guessing from a fingerprint.

`applyComparedScheduleMoveInTx` is the internal effect primitive, not an endpoint
or independently authorized writer. The selected Event must be locked first.
One SQL statement materializes at most 501 current source identities/epochs and
compares the entire set against the exact previously rebuilt complete set, then
updates canonical Event times only if unchanged. Selected generation/epoch,
current family, concrete/non-ICS source and original duration are guarded again
on the actual UPDATE. UTC casts are explicit. Zero affected rows are a conflict;
returned identity/time/protocol bounds must match before caller receipt commit.
An insertion/deletion/edit/recreation committed before that statement snapshot
cannot slip through an earlier list read. Changes ordered after that validation
point may introduce a later conflict; this source does not promise a permanently
clear schedule or prohibit independent calendar edits.

This avoids a shared collection row in legacy Event triggers, which could invert
locks during multi-event updates/deletes. Comparison rows use plain MVCC reads;
no late blocker Event/identity/source locks. Family and actor/household authority
locks must precede target locking. The future service must rebuild and authorize
the complete candidate, enforce readiness/age/owned exact intent, and commit the
minimal idempotency receipt in the SAME transaction. Calling this helper outside
that service contract is prohibited; it is currently referenced only by authored
source cases. No API or UI can invoke it yet.

Unit and disposable-DB case source is authored for source-family/generation/epoch
binding, sorted snapshot binding, invalid/padded scope bounds, atomic no-effect
refusal, actual trigger continuity, technical edit distinction, immutable UUID,
recreated IDs, inserted/deleted/away-back blockers, foreign scope and saturation.
Integration sources require the existing fixture guard plus an explicitly allowed
disposable DB with migrations already installed; they do not install migrations.
All cases remain unrun. Real concurrency/DDL/trigger/atomic-receipt correctness,
client compatibility and the complete journey still require later QA.

Next required code is the authenticated canonical snapshot/apply service, current
source-status/coverage projection, minimal receipt and owned recovery; then EN/ES
short controls, discovery and weekly integration. No new readiness switch was
activated, no generated client/DDL/SQL/DB command ran, no fixture/live/provider
mutation occurred and no push/merge/deploy happened. This is source progress,
not completion of the approved conflict workflow or the repository goal.
