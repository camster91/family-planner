# Recurrence lifecycle slice (#560, canonical issue #536)

Status: implementation scope for this branch, 2026-10-12.

Canonical delivery issue: #536. This source slice follows the existing
recurrence lifecycle gap tracked under #128/#499 and the accepted compact
recurrence work in #450/#451; it does not reopen or redefine those records.
The source audit is `work/560-recurrence-lifecycle-audit.md`.

This slice separates two user actions while keeping the existing recurrence
engine and schema:

- **Delete this occurrence** deletes only the requested one-off or generated
  row.
- **Stop repeating** remains the parent-only Edit → Once flow. It keeps the
  template/current-day/past/started/completed/verified history and removes only
  future pending copies.

An active self-anchored repeating template must never be removed by the legacy
`DELETE /api/chores { choreId }` operation. After the existing family and
parent-or-assignee authorization checks, the route returns a stable 409 with a
machine-readable code directing the caller to Stop repeating. A stopped
self-anchored row with sibling history is also retained and returns the same
conflict; a self-anchored row without siblings may be deleted as an ordinary
row. Generated copies remain individually deletable.

DELETE is performed in one transaction. It locks the actor user before the
household lock (the repository lock-order invariant), then re-reads the
actor's current family/role and the target's family/assignee/recurrence state
under lock before authorizing or writing. Foreign-household and non-assignee
responses remain unchanged. The request body remains `{ choreId }` for
installed clients.

UI acceptance:

- Every occurrence-level destructive action is labelled as deleting one
  occurrence.
- Parent views expose an explicit Stop repeating entry for active repeating
  rows. It opens the existing rounded edit form with an explicit Once
  selection/draft; it does not mutate automatically. The parent still submits
  the existing PATCH flow to stop.
- Non-parent users do not receive a Stop repeating action.
- Existing disclosure rows remain mutation-free at the series level.
- English and Spanish labels and the stable conflict error are typed and
  accessible; pending/error/recovery state follows existing form/menu
  behavior.

Compatibility and non-goals:

- Weekly weekday recurrence, monthly original-day anchoring/clamping, rotation,
  history retention, and legacy one-off behavior are unchanged.
- No schema, migration, provider, profile, permission, silent bulk-delete,
  row-reparenting, or new series-delete operation is introduced.
- Add focused unit/API coverage for occurrence delete, active/stopped anchor
  conflicts, no-write behavior, stale actor/cross-family checks, lock ordering,
  stop retention, and the explicit UI journey. PostgreSQL race and browser
  acceptance remain separate gates owned by the parent.
