# Personal notification snooze — #463

The existing personal inbox offers 15 minutes, 1 hour, 3 hours or 24 hours per notification. Snooze persists in nullable Notification.snoozed_until, sets unread, and hides future snoozes from default GET and All/Unread. The inbox opts into both sets, with a separate Snoozed tab showing return timestamps and Show now. Expired snoozes return unread; the mounted inbox rechecks every 30 seconds and on focus. No scheduler, duplicate notification, email or push delivery is created.

PATCH /api/notifications/snooze atomically targets id plus authenticated user_id. Only fixed durations or null (clear) are accepted. Repeat clears are safe; re-snoozing deliberately starts a new delay. Pending row controls prevent duplicate UI sends; errors preserve the row. An uncertain transport outcome remains recoverable by reloading the server inbox. Read/delete and delayed deletion Undo remain canonical.

Migration adds a nullable timestamp idempotently. Retain the column on rollback; existing clients default to active notifications. Shared fridge/device surfaces do not gain notification access. Return timestamps use device-local display. No production migration or delivery claim.

## Source reconciliation — 2026-10-20

Original #463 criteria were mapped to current source without running QA:

- `src/app/api/notifications/snooze/route.ts`: strict fixed durations/null, atomic
  `id + user_id` update and unread state; another user's row is unavailable.
- `src/app/api/notifications/route.ts`: default GET excludes future snoozes;
  personal inbox opts into both sets. Existing read cap is 50 latest rows, not a
  promise of full-history paging or an account-wide unread total.
- `src/app/dashboard/notifications/page.tsx`: EN/ES duration controls, active
  All/Unread and separate Snoozed view, local return timestamp/Show now, 30-second
  and focus expiry recomputation, locked pending controls, retained delete/Undo.
- `prisma/schema.prisma` and `scripts/migrate.js`: nullable timestamp and additive
  idempotent column statement; no migration was run in this pass.
- Existing snooze/snooze-list/mounted source tests and paired-device route
  refusal inventory are present. None was executed or counted as accepted.

No missing original feature slice was identified in this source mapping. Later
consolidated QA must still exercise actual persistence across sessions/devices,
expiry boundary/clock changes, direct foreign-row negatives, uncertain reload,
read/delete/Undo interleavings and role/device/localized layout. No new scheduler,
push/email delivery, production mutation or activation is implied.
