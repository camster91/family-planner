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
