# Routine stack editor v1 contract

**Status:** implementation plan only; no runtime, schema, API, role-policy, database, build, or browser changes are included in this worktree.

**Base:** `a8195ba330341695922734de20ca225e57921fd8` (`codex/routine-stack-editor-spec-20261011`)

**Product request:** let a household build and control a stack of several chores for any age, while children and teens keep a safe completion-focused view of only their own work.

## Problem and scope

The current product can display a stack when several `Chore` rows happen to share a normalized routine label and step numbers. The create and edit routes still create or patch one row at a time. A parent therefore cannot maintain a stack as one draft, move steps without manually renumbering them, add an existing chore to a stack, or recover from a partial save.

V1 is a parent-managed editor for an existing occurrence stack. One durable stack may contain steps assigned to different household members, including an adult, teen and child. It uses the existing `Chore` rows and fields:

- `Chore.id` is the stable identity of a step.
- `routine` remains the display/legacy-group label and compatibility field, normalized with the existing helper; it is never the durable stack identity.
- `routine_order` remains the persisted order, contiguous from 1 through the stack size.
- `assigned_to`, `assigned_member_id`, `due_date`, `frequency`, `weekly_days`, `recurrence_id`, `is_template`, `status`, history and verification fields remain canonical.
- `icon` remains optional and valid for adults, teens and children; a picture does not make a routine child-only.

The editor may add an existing unstacked chore, create a new chore step, remove a step from the stack, and reorder steps. “Remove” means clearing the stack membership/grouping fields from the existing chore; it never deletes a chore or its history. A newly drafted step is not persisted until the complete save commits.

The stack is one cross-member object, not one stack per member. Each step has its own canonical assignee, so one stack can represent an adult step followed by a teen step and a child step without implying shared completion or shared private details. The current member/date/label grouping remains a read-compatible legacy presentation for rows that have no durable stack identity; it is not the identity of a new or migrated stack.

The editor supports two explicit targets:

1. **This occurrence:** reorder or unstack only the selected date’s rows. This is the safe default and never changes a recurring template.
2. **This series’ future occurrences:** a parent may opt in after reviewing a plain-language schedule summary. The implementation must validate every participating template/occurrence and preserve completed, verified, started, check-pending and otherwise historical rows. A schedule change or removal never silently marks a skipped step complete.

Pause/resume, automatic anchors, timers, streaks, notifications, drag-only ordering, and a new Routine/RoutineStep table are outside v1. Schedule-aware collapse is allowed only for a durable stack identity plus occurrence date; label-only legacy groups remain a follow-up until an explicit migration.

## Canonical identity and grouping

The existing presentation grouping is not sufficient as a mutation identity. A routine label is user-editable, two unrelated routines may share a name, and a member can own several steps in one stack or belong to several stacks. The editor must carry stable IDs throughout the draft:

- **Stack identity:** a future additive `routine_stack_id` (or an equivalent durable stack record ID) identifies one cross-member stack for its lifetime. It is scoped to `family_id`, never derived from a label, member name or date, and never accepted as authorization by itself.
- **Occurrence identity:** `{ familyId, stackId, occurrenceDate }` selects one authorized dated occurrence. It may include a canonical series/occurrence revision, but it never uses `memberSubject` as the stack identity.
- **Step identity:** `choreId` plus the durable stack step identity. Every existing step in the draft retains its ID, including completed and verified steps; `assigned_member_id` is the per-step owner.
- **Series identity:** each step’s canonical `recurrence_id` and template row. A set of rows with the same label is not automatically one series or one stack.
- **Display order:** `routine_order` after normalization. Duplicate or missing order values are repaired only as part of an explicit parent save, never by a read.

The additive identity/model proposal is recorded here for a later implementation and migration; this planning change does not add a schema. The model must provide a durable stack identity, display label, schedule/lifecycle state, version/fingerprint, per-step membership/order/assignee, and the relationship to each canonical chore/template. Existing `Chore` rows remain the completion, verification, recurrence and history records. A compact stack read may carry a unique member dictionary plus per-step member IDs rather than repeating names, while the child/teen read model omits other members' details.

Legacy rows with no stack identity are not silently merged. An explicit parent migration can select the exact chore IDs, show every selected assignee/date/series, and assign them to one new stack. A normalized-label/date collision, duplicate order, missing series, or mixed incompatible schedule is ambiguous: present the candidates separately and require an explicit selection or leave them as legacy groups. Never create a durable identity on a read, infer membership from matching labels, or use a name/email match to migrate ownership. Migration is additive and reversible at the presentation level; it does not delete rows, rewrite history, or activate a profile.

For Week/All collapse, a durable `stackId + occurrenceDate` is the grouping key. Legacy unstacked recurring rows continue to use the existing household-scoped `recurrence_id` collapse rule. Today remains actionable by occurrence. A stack name is display copy only and never a privacy boundary.

The server must re-read all IDs inside the write transaction and require `family_id` to match the authenticated parent’s family. A missing or foreign ID has the same generic 404 shape as the existing chore contract. The client must never submit a member name, routine label, title, or date as a substitute for a step ID.

For “future occurrences,” the server must operate from the validated set of step templates/series IDs, not from a title search. If a row has no series, is a legacy one-off, has been detached, or no longer belongs to the selected stack, the operation returns a conflict and leaves every row unchanged. Existing recurring generation continues to copy `routine`, `routine_order` and `icon` from each template; a later additive stack implementation must carry the validated stack/step identity from the template to generated copies explicitly, never infer a new shared recurrence or stack ID from labels.

A household can deliberately have multiple stacks, and each stack may span members. A shared routine label never implies shared completion, shared ownership, or permission to see another member’s private details.

The parent read uses the canonical household member projection, not a second routine-specific person model. Its compact member DTO is `{ id, displayName, role, subjectState }`, where `subjectState` distinguishes eligible active subjects from archived/dormant or sticky-erased references. It never includes email, login, token, private notes or a replacement-account hint. `member_subject_erased` is sticky in this projection: an erased subject is not made eligible by later account/profile changes, and the write-side `eligibleChoreAssigneeInTx` check is stricter than the historical read fallback.

### Assignment source and first-stack entry

The current account-backed selector and the routine subject projection expose different ID spaces. `GET /api/family/members` returns household `User` records and its `members[].id` is an account user ID. `GET /api/chores/stacks` returns `members[].id` from `HouseholdMember`, while each step carries both the legacy `assigned_to` account ID and the canonical `assigned_member_id` subject ID. The editor must keep these values in separate typed fields and must never pass a routine `members[].id` as `assigned_to`, join by name/email, or synthesize an account for a profile-only child.

The first editor entry must be reachable without an existing stack. A parent occurrence candidate read should return the exact family-scoped chore IDs for the selected date (including unstacked rows), their full schedule/series and dual-assignment fields needed for an explicit draft, and the existing stack identity when present. The implementation may reuse the authorized `/api/chores?from=...&to=...` read if its projection is kept bounded; otherwise add a parent-only candidate mode beside the stack read. It must not infer a stack from a normalized label. A blank first draft saves with `stack_id: null` and `expected_fingerprint: ""`; adding an existing row submits its stable `chore_id` plus the row's locked recurrence and assignment identity; a new or reassigned step submits the selected account user ID from `/api/family/members` as `assigned_to` and lets the transaction resolve `assigned_member_id`.

The server remains authoritative for every assignment. The current coordinator re-reads the account and household mappings under its transaction locks and writes the dual fields together; a supplied `assigned_member_id` is only an equality check, never a client-created mapping. An account with no canonical mapping may remain a legacy-only assignment where the existing compatibility contract permits it, but a dormant or profile-only subject is not made assignable by this editor. Supporting profile-only assignment requires the separately reviewed member/account-link activation contract; it must not be implemented by guessing an ID or creating a login. Add focused coverage for first-stack creation, existing-row selection, reassignment, account/member ID mixups, archived/erased/dormant subjects, and a second-household account.

The parent-only `GET /api/chores/stacks/candidates?occurrence_date=YYYY-MM-DD` catalog is the first-stack entry point. It is bounded and explicitly paged with `hasMore`/`nextCursor`; it returns only current-date, unstacked, non-template rows plus `{ accountId, name, role }` options from the household's account-backed users. It excludes archived, erased, dormant, malformed dual-identity and foreign rows. The account option's `accountId` is the legacy `assigned_to` value; the routine subject `members[].id` is a separate `HouseholdMember` ID and must never be substituted for it. A blank first draft still saves with `stack_id: null` and an empty expected fingerprint. The catalog is read-only and does not infer a stack or expose mapping details.

## Mutation contract for the future implementation

The implementation should introduce one narrow stack-mutation coordinator behind the existing person-session and chore authorization rules. This document does not add that route. It defines the contract so a later code change does not compose several independent `PATCH /api/chores` calls in the browser.

### Request shape

The coordinator receives:

- target scope: `occurrence` or explicit `future-series`;
- the selected `{ familyId, stackId, occurrenceDate }` and the ordered list of existing `choreId`s;
- staged new steps using the same title, description, assignee, date, frequency, weekday, difficulty, icon and routine validation already used by chore create;
- `remove` IDs that are being unstacked, never IDs to delete;
- an expected snapshot fingerprint covering each submitted row’s ID, family, assignee/member subject, due date, recurrence/template identity, routine, order, status and relevant schedule fields;
- an `Idempotency-Key` header for retries.

The server normalizes the display routine name and assigns `routine_order = 1..n` from the submitted order. It rejects empty stacks unless the operation is an explicit unstack action. It rejects duplicate IDs, duplicate steps, foreign assignees, invalid weekday/frequency combinations, more than 99 steps, and new-step data that fails the existing chore schemas. The request carries an explicit assignee for every step; there is no stack-level member shortcut that can accidentally assign all steps to one person.

### Transaction and conflict rules

The complete operation runs in one household-locked database transaction:

1. Authenticate the person session and require the existing parent management capability before reading mutation details. This plan does not activate a new role or route.
2. Read the family, stack identity and all existing step IDs under the family predicate. Do not reveal whether a foreign ID exists.
3. Compare the expected fingerprint with the locked current rows. If any title, assignment, date, routine/order, series identity, status/history-sensitive field or schedule changed, return `409 ROUTINE_STACK_CONFLICT` with a retryable semantic error and no writes.
4. Resolve each submitted assignee through the canonical `eligibleChoreAssigneeInTx`-style subject check while the transaction holds the relevant family/member rows. The subject must belong to this family, be active and assignable for a new step, and not be permanently erased, archived, detached or a dormant/unactivated profile. Preserve `assigned_member_id` and sticky `member_subject_erased`; never relink an archived/erased subject to a replacement account, and never activate a profile as a side effect of selecting it.
5. Create staged new chores and update existing stack membership/order/assignee fields as one transaction. For a current-occurrence edit, do not touch templates or other dates. For a future-series edit, lock and validate every participating template before applying the documented series rules.
6. Clear routine fields for removed existing steps without changing title, assignment, status, completion, verification, points, photos, or history.
7. Write the action's idempotency receipt in the same domain transaction as the stack changes, then return a compact committed summary and fresh snapshot fingerprint. The serialized success/replay response is strictly under 8 KiB (8,192 UTF-8 bytes) even for 99 steps: it contains stack identity/version, count, step IDs/order/assignee IDs and a compact canonical member dictionary, not repeated descriptions, notes, private metadata or unbounded draft text. The full authorized read follows separately when needed.

The in-domain receipt is scoped to the authenticated user, family, action and request hash, and stores only the bounded semantic outcome needed for replay. It must not become a second routine model or retain draft descriptions, private notes, member emails or credentials. Receipt lookup repeats authentication, family, capability and stack predicates before replay; a well-formed key can never disclose a foreign stack.

A repeated key with the same request fingerprint replays the committed response and reuses the same rows; it never creates a second stack, step or receipt. The same key with a changed request is `422 IDEMPOTENCY_KEY_REUSED`; an overlapping first attempt is `409 IDEMPOTENCY_IN_PROGRESS`. The in-domain receipt and replay must be private/no-store. A transaction or response failure leaves no partial new rows and no partial order changes. A fault after commit but before the HTTP response must be replayable by the same key with the deterministic original response; tests must cover transaction rollback, response-loss replay, concurrent same-key requests, changed payload, and a 99-step response-size boundary.

**Idempotency implementation constraint:** the future coordinator must not wrap its write in the generic `withIdempotency` flow from `src/lib/idempotency.ts`. That helper stores the effect receipt after the domain transaction and may take over an abandoned record, which can rerun a non-convergent stack write after a lost response. The coordinator must instead lock and re-read its `IdempotencyRecord` inside the same transaction as the stack/chore changes, following the transaction-locked patterns in `src/lib/person-event-create.ts` and `src/lib/person-list-item-create.ts`. Build the compact response first and enforce `Buffer.byteLength(JSON.stringify(body), 'utf8') <= 8192`; do not use the generic helper's character-count cap or its oversized `{ success: true }` fallback, because either can lose the deterministic replay body required here.

The canonical assignment remains dual-field compatible throughout this transaction. Every new or changed step writes the existing required legacy `assigned_to` user ID and the nullable canonical `assigned_member_id` together, using `eligibleChoreAssigneeInTx`/`canonicalChoreAssigneeInTx` from `src/lib/chore-member-subject.ts`. The stack identity never replaces the legacy user field, and a profile/member ID is never accepted without the corresponding current same-household account mapping.

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
- Removing a future recurring step requires an explicit parent scope choice. For each locked participating template, only eligible future **pending** rows are unstacked: clear their stack membership/order while retaining the canonical recurrence/series fields, due date, assignee and independent future-series behavior. Do not delete or recreate those rows. Historical, started, check-pending, completed and verified rows retain their stack identity and all history, so the past remains truthful. Existing series pruning/expansion rules remain the only authority for future copies after the template's stack membership is updated.
- If a member is archived, detached, dormant/unactivated or permanently erased, the editor cannot assign a new step to that subject. Existing rows retain their canonical tombstone/reference semantics and are shown with the existing safe fallback; no account is relinked by matching a name or email. A sticky erased subject stays erased in every member DTO and cannot be made eligible by a later profile/account change.
- Old rows with `routine = null`, legacy one-off recurrence or missing series identity remain valid unstacked chores. The editor may stage them into a stack by stable ID, but a read never migrates them.
- Old web/Android clients continue sending the current create/PATCH bodies and continue seeing the existing nullable fields. The new editor is additive and can be rolled back without rewriting stored dates, history or generated rows.

The future-series state policy is explicit: a removed pending occurrence becomes an independent occurrence of its original recurrence series, while rows that already carry work or history stay attached to the old stack for historical display. A later generated occurrence follows the updated template policy. No scope choice silently changes completion, verification, points, photos, assignee identity, or recurrence anchors.

## UI contract across ages and devices

### Parent editor

On phone and portrait tablet, open the editor as the existing rounded sheet/form surface. Keep the selected routine summary, member, date and scope choice visible without a long page. On desktop and fridge-sized landscape, use a large adaptive panel with the same semantic structure, not a second data path.

Each step row shows title, its own selected assignee, schedule/date context and status. Use visible 44x44 Move up, Move down, Remove and Edit controls; drag can be an enhancement but is never the only ordering input. “Add existing chore” and “Create step” stay in the mounted draft so a parent can build several steps without leaving the editor. The per-step assignee control must use the canonical household roster and make adult/teen/child ownership visible before save. Show a clear schedule summary before any future-series choice.

Use the existing focus and sheet primitives:

- initial focus lands on the routine name/first step heading;
- keyboard and Android Back close the sheet only when no save is pending;
- pending save blocks Escape, outside click and dismissal, with an accessible busy label;
- successful save returns focus to the surviving routine opener; if that opener was removed, focus the routine heading or stable Add control;
- conflict and network error retain all unsaved step titles/order/notes and expose a 44px Retry plus an explicit Reload current routine action;
- no open/reload action performs a mutation automatically.

The editor must support long titles, descriptions, member names and translated strings without horizontal scroll or clipped controls. Native `<details>`/short form sections may be used inside the sheet, but the entire stack must remain understandable when all steps are expanded.

### Child and teen surfaces

No child or teen gains access to `/dashboard/chores` or the parent editor in this slice. Their existing Today/KidRoutines surface remains completion-focused and scoped to their own assigned rows, including completion, Undo and parent verification/rejection states. A parent’s cross-member stack save may change what a child or teen sees after the normal refresh, but it must not expose other household members, private notes, family-wide Routines controls, or management actions.

The future child/teen DTO is an own-step projection: it may include the durable stack ID, safe routine display label, own step order/count/status and the minimum progress needed for the existing completion view, but only steps assigned to the authenticated subject. It must not reuse the broad parent family GET, return sibling step titles/notes/assignees, or use a stack ID as a bypass. Direct same-family sibling access must be denied for another member's step, and a second household must receive the same generic denial for both parent and child/teen attempts. These are API/read-model boundaries, not a new role grant; current route policy remains unchanged until a separately approved role-policy change.

If a future product decision adds an all-age read-only week view, it must be a separate role-policy change with its own route, API selection and two-household tests. This plan does not activate that route.

### Localization and privacy

Add a typed EN/ES dictionary for editor labels, statuses, scope choices, per-step assignee labels, conflict/retry text, accessibility names and schedule summaries. Keep chore titles, descriptions, member names, verification notes, photo metadata and other user-authored values unchanged. Dates and weekdays use the existing locale-aware formatter. No routine label or status may be used as a privacy boundary. Short forms and stack disclosures must work in both locales at phone, portrait tablet, fridge landscape and desktop widths; collapsing a group uses the actual durable stack/occurrence identity, never a normalized label or member name.

## Implementation packages for a later code slice

The following package boundaries are intentionally recorded here without editing them in this planning change:

1. **Contract/transaction helper:** a pure routine-stack draft/normalization/fingerprint module plus a server transaction coordinator that reuses chore schemas, household locks, recurring-series helpers, idempotency and family predicates. Define the additive stack/step identity, legacy-label migration preview, ambiguous-candidate refusal, explicit per-step ownership, and future-series pending-row policy before any schema work. Keep the in-domain receipt atomic with the write and enforce the compact `<8 KiB` response for 99 steps.
2. **Parent route and sheet:** a parent-gated Routines entry point and a kept-mounted editor using the existing `ChoreFormSection`, Dialog/FormSheet, focus restoration and 44px tokens. The route must render the same canonical `RoutineStacks` result after commit.
3. **Role-safe read models:** preserve the current parent family read and child/teen assigned-to self read. Add an own-step DTO for child/teen projections rather than reusing the broad family query used by Kid Home. Resolve assignees with the canonical in-transaction eligibility check, keep sticky-erased subjects erased, and test same-family siblings plus two-household negatives.
4. **Typed copy:** editor and stack status keys in the existing EN/ES route dictionary; user-authored values remain data.
5. **Legacy migration and grouping:** an explicit parent-only selection/preview that creates durable identity for selected legacy chore IDs, never merges ambiguous labels, and proves rollback leaves legacy rows/history intact. Group collapse tests must use real stack IDs and dated occurrences, with the existing recurrence-ID fallback only for rows still unstacked.
6. **Verification:** focused transaction/isolation/idempotency tests, including deterministic same-key row reuse, post-commit response-loss replay, transaction rollback, receipt size at 99 steps and `<8 KiB`, future pending unstack/history preservation, member eligibility/tombstone cases, and mounted sheet tests for draft retention and focus. Then guarded EN/ES phone/portrait/fridge/desktop rendered coverage.

## Bounded first implementation design (not runtime work in this plan)

The first code slice should establish one current-occurrence coordinator behind a dormant parent-only route. It must prove the durable identity and atomic retry contract before adding future-series editing or the full sheet. The slice is additive and must leave legacy grouping/readers and old clients working.

1. **Schema and migration:** add an additive `RoutineStack` identity record to `prisma/schema.prisma` with `family_id`, display label, monotonic version/fingerprint, creator and timestamps; add nullable `Chore.routine_stack_id` with a household-scoped foreign key/index. Keep `Chore` as the step record and keep `routine`, `routine_order`, `due_date`, `recurrence_id`, `assigned_to` and `assigned_member_id` authoritative. Mirror the expand-only DDL in a new `database/migration-routine-stacks.sql` and the ordered/idempotent section of `scripts/migrate.js`. Do not backfill or merge label-only rows; generated recurrence copies remain unchanged until an explicit identity-propagation step is separately reviewed.
2. **Pure contract and transaction:** add a small `src/lib/routine-stack.ts` for draft normalization, stable fingerprint input and the compact response projection. Add a route-owned transaction function (for example `src/lib/routine-stack-mutation.ts`) used by `src/app/api/chores/stacks/route.ts`: authenticate and parent-gate before details, lock the family/stack/step rows, lock and re-read the idempotency record, validate the dual assignment fields with `src/lib/chore-member-subject.ts`, then create/update/unstack existing `Chore` rows and write the receipt before commit. The first route supports only one selected occurrence; future-series and migration-preview branches return an explicit bounded unsupported response until separately implemented.
3. **Compatibility and rollback:** return only stack/version, step IDs/order, assignee IDs and a compact member dictionary from the mutation. Read the full authorized parent projection separately. Leave `RoutineStacks`, existing create/PATCH routes, recurrence generation and old nullable-field clients untouched; no read path assigns a stack identity. Gate the route/editor behind the existing feature/config mechanism and make removal of the new route/schema reader safe for legacy rows.
4. **Focused proof before UI:** add pure tests in `src/lib/__tests__/routine-stack.test.ts` for normalization, duplicate/99-step limits, stable fingerprints, UTF-8 byte sizing and user-authored data exclusion. Add route tests in `src/app/api/chores/stacks/__tests__/route.test.ts` for parent/teen/child/device roles, same-family sibling and second-household denial, feature-off, stale fingerprint, foreign IDs, canonical/legacy dual assignment and draft-safe errors. Add a guarded integration suite beside it for transaction rollback, same-key concurrency, post-commit response-loss replay, changed payload, exact row reuse and future member/archive/erasure refusal. No browser or rendered acceptance belongs to this first slice; the existing six-size matrix follows after the coordinator and parent sheet exist.

## Acceptance matrix for implementation

A later implementation is ready for independent review only when all of these are demonstrated against one exact source/build identity:

| Area | Required evidence |
| --- | --- |
| Parent success | Parent creates one three-step cross-member stack with adult, teen and child per-step assignees, reorders it, adds an existing chore and saves once; durable stack identity, returned order and each canonical assignee are contiguous/authoritative. |
| Existing data | Completed, verified, check-pending and photo/history fields remain attached to the same chore IDs after current-occurrence reorder. |
| Current vs future | Current edit leaves templates/future rows unchanged; explicit future edit changes only eligible pending rows, unstacking removed pending rows while retaining their independent series, and preserves started/history rows. |
| Retry/conflict | Lost response replays by the same idempotency key with deterministic row reuse and the same compact response; stale fingerprint returns 409 with no partial write; retry retains the draft; same-key changed payload returns 422; a 99-step response stays below 8 KiB. |
| Isolation | Child/teen/device cannot open or mutate the editor; the child/teen own-step DTO never broadens into a family read; foreign step/member/family IDs return generic denial; same-family sibling and a second household cannot observe the target. |
| Eligibility and erasure | Every new or reassigned step passes the in-transaction canonical assignee check; archived/dormant/erased subjects cannot receive new work, sticky erased identity remains in DTOs, and no profile activates or relinks as a side effect. |
| Child/teen continuity | Existing own Today/KidRoutines completion and Undo still work after a parent reorder; no family-wide rows or sibling details appear. |
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
