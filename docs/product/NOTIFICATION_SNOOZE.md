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

## Bounded inbox transport — 2026-10-24 (#134/#141, local source)

The initial inbox and explicit older-page reads now use `notification-read-client`
with the existing `runOwnedForeground` and `readBoundedJsonResponse`:15 seconds
across fetch/body,512KiB stream limit, replacement/unmount cancellation and retained
generation/cursor guards. An abort-ignoring bridge still releases the caller;
JSON-only bridge size checks occur after allocation. Non-success bodies are not
parsed/displayed; existing localized retry state handles them. Existing50-row
DTO validation/cursor semantics, row actions/delete Undo and user/device policies
are retained. No new notification channel, provider, scheduler or delivery claim.
Source cases cover legacy/paged shapes, ignored-abort waits/cancellation, declared
and JSON-only oversize replies and invalid/duplicate cursors. All unrun; browser,
WebView/lifecycle, wire-size adequacy and full original acceptance stay open.

## Existing destination discovery and remaining object links — 2026-10-24 (#141)

The inbox now renders an EN/ES Open link for the existing canonical summary sender's
`action_url: /dashboard/today`. `notificationDestination` maps that exact stored
value to a fixed internal href. Other strings, absolute/protocol-relative/script
URLs, query/hash variants, private/unknown paths and non-string legacy values are
inactive. They do not make the entire inbox invalid. A44px link with title-specific
accessible text preserves ordinary navigation; rendering it does not mark read,
send a mutation or open automatically. No new sender or write path is introduced.

This is current-source destination discovery, not complete object deep linking.
`Notification` currently stores `user_id` and optional `action_url`, without an
original household/object identity contract. Next object-link work must:

1. Bind newly generated object links to their original household and a typed
   canonical object identifier at notification creation. Never infer household
   from the recipient's current membership or parse arbitrary old text/URLs.
2. Resolve only the authenticated recipient's notification. Recheck current
   original-household membership, role, feature and canonical record visibility;
   shared-device sessions remain excluded. Private row data never enters a URL.
3. Open a canonical task/occurrence action view for parent/teen/child policies;
   the general chore board is not an exact-object destination. Reuse existing
   completion/verification/version rules, without triggering a mutation on GET.
4. Keep deleted, hidden, foreign, moved-household or inaccessible targets on a
   localized unavailable view with safe inbox/current-workspace recovery. Never
   recreate a task, manufacture a new assignment or expose its historical content.
5. Retain old clients/legacy rows and current retention/delete/snooze/Undo policies.
   Native cold/warm/already-open routing and lifecycle proof remain later QA.

The pure destination rejection and mounted link-presence cases are authored only.
No API/DB/provider/browser/native/test/build/release execution occurred. #141 stays
open; no delivery/deduplication/token/deep-link acceptance is inferred.
