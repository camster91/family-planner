# Routine stack editor UI slice

This checkout adds the first parent-facing current-occurrence editor on top of
the reviewed routine stack read/write contract.

## Included

- `/dashboard/chores/routines` is the direct parent route.
- `/dashboard/chores/routines?...` also opens as an intercepted rounded form
  sheet from the Chores Routines view.
- A parent can name a routine, add eligible unstacked chores from the selected
  date, create a one-time step, assign each step independently, reorder steps,
  and unstack an existing step without deleting its chore or history.
- Save sends one occurrence draft with the server family ID, opaque snapshot
  fingerprint, and one reused `Idempotency-Key`. Conflict and network errors
  leave the draft in place for retry.

## Deliberate limits

The UI does not edit recurring templates or future occurrences. New steps are
one-time chores for the selected date. The server remains authoritative for
parent authorization, household scope, member-subject eligibility, conflict
detection, durable stack identity, and atomic persistence. Child and teen
views remain completion-focused and do not receive this editor entrypoint.

Rendered six-size and database acceptance remain release-owner gates; this
slice is covered by focused component tests and source checks only.

## Routine editor bounded request recovery — 2026-10-25

#450/#135 source: the current-occurrence editor now wraps candidate/read/paging
requests in a15second foreground deadline and4MiB response budget; explicit save
replies have45seconds/64KiB (canonical compact write receipts remain8KiB). Shared
abort racing and streamed bounded JSON decoding replace direct unbounded fetch/
response.json. Caller read aborts remain connected; component lifetime abort now
also covers paging/saves. Unmount retires the caller even if a native bridge
ignores AbortSignal. Valid status/code parsing and X-Member-Protocol2, same-origin
credentials and no-store behavior are retained.

Timeout/network/abort/oversize/malformed JSON cannot confirm a write or turn an
uncertain save into a definitive rejection. The existing unknown-save state
retains immutable serialized bytes and key, locks draft edits, and offers only
a deliberate same-packet Retry; no request is retried automatically. A late
underlying success cannot navigate or refresh after its caller timed out. Initial
load failure uses existing EN/ES retry copy. A deadline does not prove server
cancellation/rollback; JSON-only bridges retain only post-decode size checks,
not preallocation protection. Parsing CPU is not preemptible. Persisted restart/
process-death journals and cross-scope response ownership remain separate work.

Stalled initial load/late data, stalled save/late success/exact deliberate retry
and oversized declared reply before decoding source cases are authored UNRUN.
No QA/tests/checks/build/browser/CI/API/DB/provider/push/merge/deploy ran. Existing
browser/native/role/idempotency/history and original #450/#135 acceptance remain.

## Routine candidate paging ownership and retained draft — 2026-10-25

#450/#135 source: candidate paging has a synchronous in-flight guard and catalog
load generation. Date, stack, family or explicit reload replacement retires and
aborts an old page; unmount does likewise. Old finally callbacks cannot release
a newer catalog's paging state. A response must match the selected occurrence
and every returned chore date, contain unique IDs without overlaps with accepted
choices, and give a consistent hasMore/cursor pair. Returning the requested or a
previously consumed cursor is refused. Invalid pages never partially append,
replace roster options or consume the cursor. No automatic paging/retry occurs.

Paging errors now appear inline beside the existing44px Load more chores control,
using existing typed EN/ES load feedback. They preserve the current draft and
loaded choices; the previous shared loadError path hid the whole editor behind
initial-load recovery. Retrying requests exactly the failed cursor. Initial
load/unsupported-editor recovery remains separate. Stale catalog retirement is
not a complete server-issued actor/session response-binding protocol; that wider
owner/native acceptance remains open. No permission or recurring-history change.

Wrong-day, duplicate-ID, looping/inconsistent-cursor retained-draft/exact retry
and late old-day page retirement cases are authored UNRUN. No QA/tests/checks/
build/browser/CI/API/DB/provider/push/merge/deploy ran. #450/#135 remain open.

## Uncertain routine retry refusal is sticky — 2026-10-25

#450/#135 source: submitPacket captures whether it is retrying an existing unknown
packet before entering pending. Any failed retry retains unknown state and that
exact serialized body/key, including401/403, validation errors, explicit identity/
snapshot conflict, protocol-unavailable and key-reused responses. These describe
only the later attempt; they cannot establish that an earlier lost response had
no effect. A different packet cannot replace an unknown packet. Only a valid
confirmed success takes the normal committed path. No retry is automatic.

First-attempt known refusal semantics are unchanged: a true initial protocol or
validation refusal remains editable; initial explicit conflict keeps its review
path. Unknown retries continue using existing EN/ES recovery/locked draft and
Retry save, rather than minting a new key or exposing Reload as absence evidence.
Mounted memory remains the existing retention boundary, not a persisted journal,
receipt-expiry resolution or complete reauthentication/navigation UX.

Six later-refusal paths followed by exact third-attempt success are authored as
UNRUN source cases. No QA/tests/checks/build/browser/CI/API/DB/provider/push/merge/
deploy ran. Full #450/#135 unknown-outcome/native/role acceptance remains open.

## Routine original-issue retry window — 2026-10-25

#450/#135 source: every new mounted save packet freezes a canonical ISO issue
time alongside its original serialized bytes/key. The client checks it before
initial/retry dispatch and sends X-Herewoven-Routine-Issued-At unchanged. A24hour
window (also capped at one quarter of canonical7day receipt retention) and5minute
future-clock tolerance refuse stale/rolled-back-clock attempts. Expiry never
refreshes the issue time/key or dispatches a new write. Existing unknown state,
locked draft and EN/ES review guidance remain; canonical saved-state inspection
and full recovery/reauthentication UX are still separate work.

The current HTTP route validates supplied issue time before body decoding and
passes it internally to the canonical writer. After lifecycle/actual User locks
and current parent/session checks, the writer rechecks real current time before
any receipt lookup/expiry deletion/create or effects. WINDOW_CLOSED409 is an
explicit review hold even on the first response; a prior uncertain outcome is
not disproved. Existing absent-header legacy/internal callers remain compatible,
and old servers may ignore this additive header; the new mounted client still
applies its local guard. This is a request-age precondition, not a signed/server-
issued timestamp, immutable receipt/source proof or arbitrary caller deduplication
guarantee. No schema, retention, provider, scheduler or feature flag changes.

Pure boundary/canonical-time/future-clock cases, route refusal before decoding,
writer refusal before receipts and aged mounted draft/no second dispatch cases
are authored UNRUN. No QA/tests/checks/build/browser/CI/API/DB/provider/push/merge/
deploy ran. Receipt expiry, native restart, old-client, actual clock/lock races and
full #450/#135 acceptance remain open.

## Read-only original routine receipt inspection — 2026-10-25

#450/#135 source: unknown/aged mounted routine saves now offer a44px Check saved
status action using existing EN/ES typed recovery. It privately posts the same
original serialized draft and idempotency key to POST /api/chores/stacks/receipt;
this route only reads and never submits the mutation, creates/deletes/expires a
receipt, expands recurrence or recreates chores. Missing/old servers retain
uncertainty with no save fallback. Response/transport bounds and lifetime abort
apply; catalog generation/packet ownership prevents a retired inspection from
refreshing/navigating a replacement editor. Checking itself does not refresh the
packet time or release the unknown draft.

The server requires a current real parent, chores access, valid original key and
bounded2MiB body, then normalizes/hashes the same canonical draft/action as the
writer. Under User/household advisory locks and actual User FOR SHARE it renews
family/parent/session, reads only that person's scope/key, and requires exact
family/user/action/hash, unexpired complete200 receipt and shared strict compact
body validation within8KiB. The5second/max-wait5second transaction performs no
receipt/domain writes. The response contains only confirmed stack ID or unknown;
old member names, step content and stored receipt JSON are not disclosed.

A valid original committed receipt can confirm after the24hour send window but
before receipt expiry; the UI then follows its existing successful refresh/close
path. Missing/expired/incomplete/malformed/mismatched receipts and request failure
remain unknown. No absence proof, automatic fresh key, current-stack existence,
Undo or rollback is inferred. Full original-actor/session UI ownership, erasure/
restore semantics, persistent restart recovery and manual restart after expired
receipt remain separate work. No existing retention/schema/flags change.

Reader exact/missing/expired/foreign/hash/incomplete/malformed cases, role/body
route guards and mounted confirmed/unknown inspection-without-resave cases are
authored UNRUN. No QA/tests/checks/build/browser/CI/API/DB/provider/push/merge/deploy
ran. Original #450/#135/#136 acceptance remains open.
