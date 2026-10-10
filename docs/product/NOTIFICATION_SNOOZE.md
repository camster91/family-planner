# Personal notification snooze — #463

The existing personal inbox offers 15 minutes, 1 hour, 3 hours or 24 hours per notification. Snooze persists in nullable Notification.snoozed_until, sets unread, and hides future snoozes from default GET and All/Unread. The inbox opts into both sets, with a separate Snoozed tab showing return timestamps and Show now. Expired snoozes return unread; the mounted inbox rechecks every 30 seconds and on focus. No scheduler, duplicate notification, email or push delivery is created.

PATCH /api/notifications/snooze atomically targets id plus authenticated user_id. Only fixed durations or null (clear) are accepted. Repeat clears are safe; re-snoozing deliberately starts a new delay. Pending row controls prevent duplicate UI sends; errors preserve the row. An uncertain transport outcome remains recoverable by reloading the server inbox. Read/delete and delayed deletion Undo remain canonical.

Migration adds a nullable timestamp idempotently. Retain the column on rollback; existing clients default to active notifications. Shared fridge/device surfaces do not gain notification access. Return timestamps use device-local display. No production migration or delivery claim.
