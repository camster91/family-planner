# Recurring chore lifecycle source reconciliation

Issue #536, related #449/#450/#451/#499. Source inventory updated 2026-10-20.
This maps authored code to the original requirements. It is not evidence that
local, hosted, rendered, Postgres or device acceptance has passed.

| Original requirement | Current source | Deferred acceptance |
| --- | --- | --- |
| Ordinary/generated occurrence DELETE removes only that row with existing parent-or-assignee authority/request shape | `src/app/api/chores/route.ts` DELETE re-reads actor and chore in the transaction, then deletes the exact chore ID | `src/app/api/chores/__tests__/delete-lifecycle.test.ts`; `src/lib/__tests__/recurring-series.integration.test.ts` |
| Active self-anchor refuses with stable 409 directing Stop repeating | DELETE detects self-anchor + template + daily/weekly/monthly frequency and returns `RECURRING_SERIES_REQUIRES_STOP` before deleting | Existing route and Postgres anchor cases |
| Stopped self-anchor with sibling history stays; lone stopped anchor may be deleted | DELETE queries same-household sibling before exact deletion and returns `RECURRING_ANCHOR_RETAINS_HISTORY` when found | Existing stopped-anchor/history and lone-anchor source cases |
| Parent Stop enters rounded edit form with a deliberate Once draft and explicit Save | `ChoresContent.tsx` parent menu links to edit with `stop=1`; `EditChoreForm.tsx` drafts Once and shows stop hint; ordinary submit persists it | `e2e/chore-series-lifecycle.spec.ts`; actual six-viewport routes and keyboard/touch/Back remain deferred |
| Lock order and fresh authorization protect DELETE and stopping | DELETE and PATCH take actor-user then household lock. Under lock they re-read current session generation/role/membership. A revoked generation yields 401 with no chore mutation; legacy tokens without tv retain canonical generation-zero behavior | Authored fake/real held-lock revocation cases for DELETE and stop PATCH, plus existing stale-role/isolation/expansion-lock cases |
| Typed EN/ES, accessible controls and recovery | `src/i18n/chore-forms.ts`, existing ActionSheet/form/Dialog navigation and request recovery | Existing responsive journey source; full locale, focus, pending, offline and responsive execution deferred |
| Preserve cadence/history, scheduled-profile contracts and rollback | `recurringChores.ts` canonical frequency edit prunes untouched future rows; scheduled definitions refuse legacy writes via `routine-schedule-legacy.ts`; profile subjects retain separate canonical guards | Full recurrence/profile/scheduled-routine integration and installed-client rollback checks deferred |

## Remaining source and release boundaries

The original #536 source criteria are mapped to implementation; no broader
future-routine lifecycle or profile acceptance is claimed. The late-session gap
identified during reconciliation is now source-fixed for ordinary edits, explicit
stop and occurrence deletion. Parent-only fields, assignee permissions, anchor
409 codes, request bodies and the UI Stop/Save contract are preserved. Route mock
fixtures now supply the full current actor state required by locked checks and
set up their own actor lookup instead of inheriting another suite's handler.
PATCH additionally renews selected-assignee membership and current subject
profile/erasure guards under the household lock, and canonical frequency editing
uses current root/cadence/weekdays read under that lock. It cannot silently treat
a newly created repeating anchor as the pre-wait plain chore and ignore Stop.
Authored changed-subject/assignee cases refuse all edit writes; a real held-lock
source case starts a series while Stop waits and asserts the stopped anchor,
retained completed history and pruned untouched future copy. These remain unrun.

No migration or data rewrite, copy reparenting/promotion, bulk history deletion,
provider/permission/scheduler change or activation. UI rollback may remove Stop
entry points while keeping server anchor and session guards. Do not restore
orphan-producing DELETE behavior as rollback. QA, CI, push, merge and deployment
remain deferred until the full integrated implementation candidate is ready.
