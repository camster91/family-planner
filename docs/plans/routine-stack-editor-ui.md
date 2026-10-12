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
