# Routine stack editor v1 contract

**Status:** implementation plan only; no runtime, schema, API, role-policy, database, build, or browser changes are included in this worktree.

**Base:** `a8195ba330341695922734de20ca225e57921fd8` (`codex/routine-stack-editor-spec-20261011`)

**Product request:** let a household build and control a stack of several chores for any age, while children and teens keep a safe completion-focused view of only their own work.

## Problem and scope

The current product can display a stack when several `Chore` rows happen to share a normalized routine label and step numbers. The create and edit routes still create or patch one row at a time. A parent therefore cannot maintain a stack as one draft, move steps without manually renumbering them, add an existing chore to a stack, or recover from a partial save.

V1 is a parent-managed editor for an existing occurrence stack. It uses the existing `Chore` rows and fields:

- `Chore.id` is the stable identity of a step.
- `routine` remains the display/group label and is normalized with the existing helper.
- `routine_order` remains the persisted order, contiguous from 1 through the stack size.
- `assigned_to`, `assigned_member_id`, `due_date`, `frequency`, `weekly_days`, `recurrence_id`, `is_template`, `status`, history and verification fields remain canonical.
- `icon` remains optional and valid for adults, teens and children; a picture does not make a routine child-only.

The editor may add an existing unstacked chore, create a new chore step, remove a step from the stack, and reorder steps. “Remove” means clearing `routine` and `routine_order` from the existing chore; it never deletes a chore or its history. A newly drafted step is not persisted until the complete save commits.

V1 keeps one stack tied to one selected household member, while allowing that member to be an adult, teen or child. This matches the current member/date grouping and avoids pretending that a mutable routine label is a durable cross-member identity. A later shared routine can give individual steps different owners only after a durable stack identity and an explicit disclosure policy exist; it is not inferred by matching labels.

The editor supports two explicit targets:

1. **This occurrence:** reorder or unstack only the selected date’s rows. This is the safe default and never changes a recurring template.
2. **This series’ future occurrences:** a parent may opt in after reviewing a plain-language schedule summary. The implementation must validate every participating template/occurrence and preserve completed, verified, started, check-pending and otherwise historical rows. A schedule change or removal never silently marks a skipped step complete.

Pause/resume, automatic anchors, timers, streaks, notifications, drag-only ordering, and a new Routine/RoutineStep table are outside v1. Schedule-aware collapse of repeated stacks remains a follow-up until a safe durable identity exists.

## Canonical identity and grouping

The existing presentation grouping is not sufficient as a mutation identity. A routine label is user-editable and two unrelated routines may share a name. The editor must carry stable IDs throughout the draft:

- **Occurrence stack key:** `{ familyId, memberSubject, normalizedRoutine, dueDate }`, where `memberSubject` is the current canonical assignee/member identity used by the authorized chore row. The key is used only to select/display an occurrence, never to authorize a write.
- **Step identity:** `choreId`. Every existing step in the draft must retain its ID, including completed and verified steps.
- **Series identity:** each step’s canonical `recurrence_id` and its template row. A set of rows with the same label is not automatically one series.
- **Display order:** `routine_order` after normalization. Duplicate or missing order values are repaired only as part of an explicit parent save, never by a read.

The server must re-read all IDs inside the write transaction and require `family_id` to match the authenticated parent’s family. A missing or foreign ID has the same generic 404 shape as the existing chore contract. The client must never submit a member name, routine label, title, or date as a substitute for a step ID.

For “future occurrences,” the server must operate from the validated set of step templates/series IDs, not from a title search. If a row has no series, is a legacy one-off, has been detached, or no longer belongs to the selected stack, the operation returns a conflict and leaves every row unchanged. Existing recurring generation continues to copy `routine`, `routine_order` and `icon` from each template; v1 does not infer a new shared recurrence ID.

A parent can assign separate routines to separate household members. A shared routine label never implies shared completion, shared ownership, or permission to see another member’s private details.

## Mutation contract for the future implementation

The implementation should introduce one narrow stack-mutation coordinator behind the existing person-session and chore authorization rules. This document does not add that route. It defines the contract so a later code change does not compose several independent `PATCH /api/chores` calls in the browser.

### Request shape

The coordinator receives:

- target scope: `occurrence` or explicit `future-series`;
- the selected occurrence key and the ordered list of existing `choreId`s;
- staged new steps using the same title, description, assignee, date, frequency, weekday, difficulty, icon and routine validation already used by chore create;
- `remove` IDs that are being unstacked, never IDs to delete;
- an expected snapshot fingerprint covering each submitted row’s ID, family, assignee/member subject, due date, recurrence/template identity, routine, order, status and relevant schedule fields;
- an `Idempotency-Key` header for retries.

The server normalizes the routine name and assigns `routine_order = 1..n` from the submitted order. It rejects empty stacks unless the operation is an explicit unstack action. It rejects duplicate IDs, duplicate steps, foreign assignees, invalid weekday/frequency combinations, more than 99 steps, and new-step data that fails the existing chore schemas.

### Transaction and conflict rules

The complete operation runs in one household-locked database transaction:

1. Authenticate the person session and require the parent role before reading mutation details.
2. Read the family and all existing step IDs under the family predicate. Do not reveal whether a foreign ID exists.
3. Compare the expected fingerprint with the locked current rows. If any title, assignment, date, routine/order, series identity, status/history-sensitive field or schedule changed, return `409 ROUTINE_STACK_CONFLICT` with a retryable semantic error and no writes.
4. Validate each new assignee belongs to the same family and is not an erased/detached subject. Preserve `assigned_member_id` and `member_subject_erased`; never relink an archived profile to a replacement account.
5. Create staged new chores and update existing routine/order fields as one transaction. For a current-occurrence edit, do not touch templates or other dates. For a future-series edit, lock and validate every participating template before applying the documented series rules.
6. Clear routine fields for removed existing steps without changing title, assignment, status, completion, verification, points, photos, or history.
7. Return the committed authorized stack and a fresh snapshot fingerprint.

A repeated key with the same request fingerprint replays the committed response. The same key with a changed request is `422 IDEMPOTENCY_KEY_REUSED`; an overlapping first attempt is `409 IDEMPOTENCY_IN_PROGRESS`. The response and replay must be private/no-store. A transaction or response failure leaves no partial new rows and no partial order changes.

The coordinator must not change completion state. Verify/reject, complete, undo, points, photos and notifications continue through their existing single-purpose routes. Chore DELETE remains a separate explicit action with its current parent/assignee authority; the editor never calls DELETE.

### Error and recovery semantics

Use the repository’s existing error envelope and role/isolation conventions:

- `401` unauthenticated; `403` non-parent, device write, or an unavailable capability;
- `404` missing or foreign stack/step with no cross-household oracle;
- `400` invalid order, schedule, member, or staged step data;
- `409 ROUTINE_STACK_CONFLICT` for a stale fingerprint, detached step, changed series, or a concurrent save;
- `409 IDEMPOTENCY_IN_PROGRESS` for an overlapping retry;
- `422 IDEMPOTENCY_KEY_REUSED` for changed payload under a completed key;
- retryable `500` for an unexpected server failure without exposing raw database/provider text.

The sheet keeps the draft and selected scope after a retryable failure. “Reload current routine” is a separate, explicit action that replaces the draft after a parent sees the conflict summary. It must not silently discard a drafted new step. The UI shows the committed result only after the transaction response, then restores focus to the surviving opener or the routine heading.

## Recurrence, archive, delete and history rules

- The existing recurrence expander remains authoritative for daily, selected-weekday weekly, and monthly chores. V1 does not change date calculation, monthly clamping, rotation, or the `(recurrence_id, due_date)` uniqueness guard.
- Reordering a current occurrence changes only its occurrence metadata. Reordering a series changes future pending occurrences according to the existing series-edit rules and preserves started, completed, verified and check-pending history.
- A completed or verified step may be moved; its status and verification history stay attached to its `choreId`.
- Removing a step from a current stack clears only routine grouping fields. It does not archive, delete, reopen, or recreate the chore.
- Removing a future recurring step requires an explicit parent scope choice. It must not delete historical rows or silently remove a child’s recorded work. Existing series pruning rules remain the only authority for future pending copies.
- If a member is archived or permanently erased, the editor cannot reassign a step to that subject. Existing rows retain their tombstone/reference semantics and are shown with the existing safe fallback; no account is relinked by matching a name or email.
- Old rows with `routine = null`, legacy one-off recurrence or missing series identity remain valid unstacked chores. The editor may stage them into a stack by stable ID, but a read never migrates them.
- Old web/Android clients continue sending the current create/PATCH bodies and continue seeing the existing nullable fields. The new editor is additive and can be rolled back without rewriting stored dates, history or generated rows.

## UI contract across ages and devices

### Parent editor

On phone and portrait tablet, open the editor as the existing rounded sheet/form surface. Keep the selected routine summary, member, date and scope choice visible without a long page. On desktop and fridge-sized landscape, use a large adaptive panel with the same semantic structure, not a second data path.

Each step row shows title, the selected member, schedule/date context and status. Use visible 44x44 Move up, Move down, Remove and Edit controls; drag can be an enhancement but is never the only ordering input. “Add existing chore” and “Create step” stay in the mounted draft so a parent can build several steps without leaving the editor. Show a clear schedule summary before any future-series choice.

Use the existing focus and sheet primitives:

- initial focus lands on the routine name/first step heading;
- keyboard and Android Back close the sheet only when no save is pending;
- pending save blocks Escape, outside click and dismissal, with an accessible busy label;
- successful save returns focus to the surviving routine opener; if that opener was removed, focus the routine heading or stable Add control;
- conflict and network error retain all unsaved step titles/order/notes and expose a 44px Retry plus an explicit Reload current routine action;
- no open/reload action performs a mutation automatically.

The editor must support long titles, descriptions, member names and translated strings without horizontal scroll or clipped controls. Native `<details>`/short form sections may be used inside the sheet, but the entire stack must remain understandable when all steps are expanded.

### Child and teen surfaces

No child or teen gains access to `/dashboard/chores` or the parent editor in this slice. Their existing Today/KidRoutines surface remains completion-focused and scoped to their own assigned rows, including completion, Undo and parent verification/rejection states. A parent’s stack save may change what the child sees after the normal refresh, but it must not expose other household members, private notes, family-wide Routines controls, or management actions.

If a future product decision adds an all-age read-only week view, it must be a separate role-policy change with its own route, API selection and two-household tests. This plan does not activate that route.

### Localization and privacy

Add a typed EN/ES dictionary for editor labels, statuses, scope choices, conflict/retry text, accessibility names and schedule summaries. Keep chore titles, descriptions, member names, verification notes, photo metadata and other user-authored values unchanged. Dates and weekdays use the existing locale-aware formatter. No routine label or status may be used as a privacy boundary.

## Implementation packages for a later code slice

The following package boundaries are intentionally recorded here without editing them in this planning change:

1. **Contract/transaction helper:** a pure routine-stack draft/normalization/fingerprint module plus a server transaction coordinator that reuses chore schemas, household locks, recurring-series helpers, idempotency and family predicates.
2. **Parent route and sheet:** a parent-gated Routines entry point and a kept-mounted editor using the existing `ChoreFormSection`, Dialog/FormSheet, focus restoration and 44px tokens. The route must render the same canonical `RoutineStacks` result after commit.
3. **Role-safe read models:** preserve the current parent family read and child/teen assigned-to self read. Do not broaden the family query used by Kid Home.
4. **Typed copy:** editor and stack status keys in the existing EN/ES route dictionary; user-authored values remain data.
5. **Verification:** focused transaction/isolation/idempotency tests, mounted sheet tests for draft retention and focus, then guarded EN/ES phone/portrait/fridge/desktop rendered coverage.

## Acceptance matrix for implementation

A later implementation is ready for independent review only when all of these are demonstrated against one exact source/build identity:

| Area | Required evidence |
| --- | --- |
| Parent success | Parent creates a three-step adult/teen/child-assigned stack, reorders it, adds an existing chore and saves once; returned order is contiguous and canonical. |
| Existing data | Completed, verified, check-pending and photo/history fields remain attached to the same chore IDs after current-occurrence reorder. |
| Current vs future | Current edit leaves templates/future rows unchanged; explicit future edit changes only eligible pending rows and preserves started/history rows. |
| Retry/conflict | Lost response replays by the same idempotency key; stale fingerprint returns 409 with no partial write; retry retains the draft. |
| Isolation | Child/teen/device cannot open or mutate the editor; foreign step/member/family IDs return generic denial; a second household cannot observe the target. |
| Child/teen continuity | Existing own Today/KidRoutines completion and Undo still work after a parent reorder; no family-wide rows appear. |
| Reflow and input | EN and ES at 390x844, 430x932, 800x1280, 1280x800, 1366x768 and 1920x1200 have no horizontal overflow, 44px primary targets, visible focus, usable keyboard/Android Back, and safe pending dismissal. |
| Localization | Static editor/status/ARIA copy changes with locale; titles, descriptions, names, notes and IDs remain exact user data. |
| Rollback | Removing the editor leaves existing create/edit, RoutineStacks, recurring generation and old client request/response behavior intact. |

## References and deliberate limits

- `docs/product/ROUTINE_STACKS.md` — current grouping, role boundaries, planned builder, recurrence/history requirements.
- `docs/product/CHORES.md` — parent checks, picture routines, weekly days and child Today behavior.
- `docs/architecture/API_CONTRACTS.md` — current chore create/PATCH/complete/verify/undo, recurrence and idempotency conventions.
- `docs/architecture/AUTHORIZATION.md` and `docs/ROLE_AND_ISOLATION_MATRIX.md` — family ownership and role policy.
- `src/lib/routine-icons.ts`, `src/lib/validations.ts`, `src/lib/recurringChores.ts`, `src/app/api/chores/route.ts`, `prisma/schema.prisma` — executable current model and constraints.

This document is a design/contract reference. It does not claim that a builder, a new coordinator route, all-age navigation, rendered responsive behavior, or database conflict handling exists in the current source.
