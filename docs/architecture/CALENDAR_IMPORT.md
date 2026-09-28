# Calendar import (read-only ICS subscriptions)

Status: implemented for #232 (scope approved from the #124 calendar-sync contract). Covers **read-only** import of public/private ICS feed links. CalDAV is out of scope. Two-way Google/Outlook sync over OAuth is a separate feature (#264): [`CALENDAR_SYNC.md`](CALENDAR_SYNC.md).

## Summary

A parent pastes an `https://` or `webcal://` calendar link in **Settings → Subscribed calendars**. The server fetches it (guarded), expands it within a bounded window and stores each occurrence as an `Event` tagged with its source. Imported events show on the family calendar with a "From <name>" badge and cannot be edited or deleted in the app. Removing the subscription removes its events.

| Piece                 | Location                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Schema                | `prisma/schema.prisma` (`CalendarSubscription`, `Event.source_*`) and `scripts/migrate.js` (same objects, idempotent) |
| Guarded fetch         | `src/lib/calendar-import/fetch.ts`                                                                                    |
| Parse + expand        | `src/lib/calendar-import/parse.ts`, `timezone.ts`                                                                     |
| Reconcile / refresh   | `src/lib/calendar-import/sync.ts`                                                                                     |
| API                   | `src/app/api/calendar/subscriptions/**`                                                                               |
| Read-only enforcement | `src/app/api/events/route.ts` (PATCH/DELETE -> 409 `EVENT_READ_ONLY`)                                                 |
| UI                    | `src/app/dashboard/settings/CalendarSubscriptionsSection.tsx`, `src/app/dashboard/calendar/**`                        |

Parser library: **ical.js** (Mozilla, MPL-2.0, pure JS, zero runtime dependencies, maintained; used by Thunderbird). It supports RRULE, RDATE, EXDATE and RECURRENCE-ID overrides. `node-ical` was not chosen because it pulls in `rrule`, `moment-timezone` and more. We never register feed VTIMEZONEs in ical.js's process-global `TimezoneService`, so one feed cannot change how another is read.

## Data model (expand-only)

`CalendarSubscription`: `id, family_id, name, url_enc, color?, last_fetched_at?, last_status ('pending'|'ok'|'error'), last_error?, etag?, last_modified?, created_by, created_at, updated_at`. FKs cascade from `Family` and the creating `User`.

`Event` gains three nullable columns: `source_subscription_id` (FK -> `CalendarSubscription`, `ON DELETE CASCADE`), `source_uid`, `source_occurrence_start`. Local events keep all three `NULL`. Old clients ignore the new fields; no existing column changes meaning. Rollback: the app code can be reverted without touching the columns; imported rows then look like ordinary events until the subscription rows are deleted.

## Source identity and idempotency

An imported occurrence is identified by **(subscription, iCalendar UID, original occurrence start)**:

- non-recurring event: DTSTART instant;
- recurring instance: the instance's RECURRENCE-ID instant (for generated instances, the generated start). An override that moves an instance keeps the identity of the slot it replaces, so moving it updates the same row.

`UNIQUE (source_subscription_id, source_uid, source_occurrence_start)` (Postgres treats `NULL`s as distinct, so local events never collide). Reconcile loads the subscription's rows, creates missing keys with `createMany(skipDuplicates)`, updates rows whose title/description/location/start/end changed, and deletes stale keys. Importing the same feed twice produces the same rows and zero writes the second time. Events without a UID are skipped because they have no stable identity.

## Recurrence and window

Occurrences are expanded in the window **now − 30 days to now + 180 days**. Only occurrences overlapping the window are stored. Guards: at most 3,000 occurrences per feed and 25,000 iterations per series (unbounded `FREQ=DAILY` from years ago still reaches the window; `FREQ=SECONDLY` abuse cannot spin). When a cap is hit the sync still succeeds and `last_error` says some events were skipped. `STATUS:CANCELLED` events or instances are not imported. An override whose master is missing is imported as a single event. `RANGE=THISANDFUTURE` is not supported and is treated as a single-instance override.

## Time zones and DST

Every wall-clock value is converted to a UTC instant in `timezone.ts` using the runtime IANA database (Intl), so recurrences keep their wall-clock time across DST changes. For example, a 09:00 Sunday class in Toronto is 14:00Z before 8 March 2026 and 13:00Z after it.

- `Z` times are UTC.
- A `TZID` time uses the IANA zone. Mozilla-prefixed (`/mozilla.org/.../America/Toronto`) and common Windows names (`Eastern Standard Time`) are mapped. An unknown TZID uses the feed's own VTIMEZONE block, parsed locally.
- Floating times (no zone) and unresolvable zones use the household zone. Households have no stored zone yet, so this is `America/Toronto` (`DEFAULT_FAMILY_TIMEZONE`).
- All-day (`VALUE=DATE`) events are stored as household-local midnight to the next local midnight (DTEND is exclusive). The Event model has no all-day flag yet, so the calendar shows a 12:00 AM start. This is a known follow-up.
- RFC 5545 rules: a non-existent local time (spring-forward gap) is read with the offset before the gap. An ambiguous time (fall-back) is the first occurrence.

## Conflicts and deletion

- Imported events are **read-only**. `PATCH`/`DELETE /api/events` returns `409 { code: "EVENT_READ_ONLY" }` after the household check, so a foreign ID still answers 403/404. The calendar list shows a "From <name>" text badge (colour is decorative only) and no edit link. The edit page shows a read-only notice.
- The feed is the source of truth. Local copies are overwritten on change, and there is no merge.
- An occurrence that disappears from the feed (event removed, EXDATE added, instance cancelled) is deleted **if its start is inside the window**. Older imported rows are kept as history.
- A feed that parses but is empty removes the subscription's in-window events. A feed that **fails** (network, HTTP, SSRF refusal, invalid ICS) changes no events. Only the status is updated.
- Local events are never selected, updated or deleted by the sync. Every statement is scoped by `family_id` and `source_subscription_id`.

## Revocation

Revocation means removing the subscription (parents only): `DELETE /api/calendar/subscriptions/[id]` deletes the subscription's events and then the subscription in one transaction. The FK cascade also guarantees this. Removing a household cascades everything. The URL cannot be edited. To change it, remove the subscription and add it again.

## Refresh and outage state

- No scheduler (AGENTS.md). Refresh happens in two ways:
  1. `POST /api/calendar/subscriptions/[id]/refresh`, available to parents and teens (children get 403). It is rate-limited to 6 per 10 minutes per subscription and returns counts, never content.
  2. On dashboard load, `after()` runs `refreshStaleSubscriptions(familyId)` once the response has been sent, so rendering never waits. A subscription is stale when `last_fetched_at` is older than 15 minutes. A DB-backed `checkRateLimit('calsub-auto:<id>', 1, 15 min)` window acts as a cross-replica lease against stampedes, and an in-process map shares concurrent refreshes of the same subscription.
- Conditional requests: stored `ETag`/`Last-Modified` are sent as `If-None-Match`/`If-Modified-Since`. `304` records a successful check without touching events.
- Outage state: `last_status = 'error'` with a short fixed-vocabulary `last_error` such as "Feed took too long to respond" or "Feed could not be downloaded (HTTP 404)". Previously imported events stay visible. Settings shows the problem text next to the subscription.

## Fetch safety (SSRF)

- Only `https://` is fetched. `webcal://`/`webcals://` are rewritten to `https://`. Credentials in the URL are rejected.
- `checkProviderUrlShape` + `assertPublicProviderUrl` (`src/lib/outbound-url.ts`) run on save and **again before every request hop**. They reject loopback, RFC 1918, CGNAT, link-local/metadata (169.254.169.254), ULA and multicast addresses, including hostnames that resolve to them.
- `redirect: 'manual'`, with at most 3 redirects. Each `Location` is resolved and re-validated, and a downgrade to http is refused.
- 10 s total timeout (AbortController). The 2 MB body cap is checked against `Content-Length` and enforced while streaming.
- Residual risk: DNS is resolved separately from the connection, so a hostile DNS server could rebind between check and connect. This is the same as the existing AI-provider guard. Pinning the resolved address in a custom agent is a possible hardening step.

## Secrets, privacy and logging

- Private feed links are bearer secrets. The URL is encrypted at rest with `secret-box` (AES-256-GCM) and is **never** returned by the API after saving. Parents see a host-only hint (`calendar.google.com/…`). Teens and children never see it.
- Logs contain only the subscription id and a fixed error code (`[calendar-import] refresh failed { subscriptionId, code }`). URLs, response bodies, titles and descriptions are never logged, and route handlers do not log error objects that could echo a URL. Tests assert this.
- Imported event text is capped (title 200, description 1,000, location 200 chars) and control characters are stripped.

## Authorization matrix

| Action                       | Parent              | Teen          | Child | Other household |
| ---------------------------- | ------------------- | ------------- | ----- | --------------- |
| List subscriptions           | yes (with URL hint) | yes (no hint) | 403   | not visible     |
| Add / rename / remove        | yes                 | 403           | 403   | 404             |
| Refresh                      | yes                 | yes           | 403   | 404             |
| See imported events          | yes                 | yes           | yes   | never           |
| Edit / delete imported event | 409                 | 403           | 403   | 403/404         |

Limits: 10 subscriptions per household, and creation is rate-limited to 10 per hour per household.

## Tests

- `src/lib/calendar-import/__tests__/parse.test.ts`: simple, all-day, weekly + EXDATE + RECURRENCE-ID override, Toronto DST March/November, gap/ambiguous resolution, VTIMEZONE-only TZID, floating time, window and caps, cancelled and no-UID events, malformed input.
- `fetch.test.ts`: webcal rewrite, SSRF refusals, per-hop redirect validation, redirect limit, size limit (declared and streamed), timeout, HTTP/network errors without URL.
- `sync.test.ts`: import-twice idempotency, removal from feed, override update, local and foreign events untouched, malformed feed leaves events and records the error, 304, content-free logs, cross-family no-op, stale refresh lease.
- `sync.integration.test.ts`: opt-in (`RUN_DB_INTEGRATION=1`) real-Postgres check of the unique key, idempotency and removal.
- `src/app/api/calendar/subscriptions/__tests__/isolation.test.ts` and `src/app/api/events/__tests__/imported.test.ts`: two-household CRUD/refresh isolation, role gates, URL never echoed, 409 on imported events, no cross-household source names.

E2E is not included. The public-URL guard deliberately refuses a local fixture HTTP server, so UI behaviour is covered at route level instead.

## Review-first import from text, photo or PDF (#270)

A separate, optional feature next to the ICS subscriptions above: a parent or teen pastes the text of a school email or
flyer, or chooses a photo or PDF of it; a model suggests events; the person reviews and edits them and only then adds
them as ordinary events. **Off until configured**: without `EVENT_IMPORT_ANTHROPIC_API_KEY` the route is `404
EVENT_IMPORT_DISABLED` and the calendar hides "Import from text or photo". Enabling it (key, spend cap, privacy):
[`docs/runbooks/EVENT_IMPORT.md`](../runbooks/EVENT_IMPORT.md). Code: `src/lib/event-import.ts` (server),
`src/lib/event-import-client.ts` (page helpers), `src/app/api/calendar/import-suggestions/**`,
`src/app/dashboard/calendar/ImportEventsDialog.tsx`.

### Flow

1. **Suggest** — `POST /api/calendar/import-suggestions` (contract in `API_CONTRACTS.md`). JSON `{ text }` (≤ 20,000
   characters) or `multipart/form-data` with one `file`: JPEG, PNG or WebP photo ≤ 8 MB, or PDF ≤ 10 MB (≤ 20 visible
   pages), typed by magic bytes, never the declared MIME. The page downscales photos to 1568 px before upload. Returns
   at most 30 suggestions `{ title, start, end, allDay, location, notes, confidence }` plus `unreadable`, `dropped`
   and `timeZone`. **Writes nothing.**
2. **Review** — editable cards (title, date, all day or start/end time, last day for multi-day all-day events,
   location, notes), one checkbox each. Suggestions below 0.5 confidence start unticked; confidence is shown in words
   ("Likely", "Check this", "Unsure"), never colour alone. A refusal, an "unreadable" answer or no usable date shows
   "We couldn't find any dates in this. Try a clearer photo or paste the text."
3. **Add** — "Add N events" validates every ticked card first, then creates them one at a time with the existing
   `POST /api/events` (notes become the description). That route takes no `Idempotency-Key`, so a card that was added
   leaves the list at once: retrying after a partial failure sends only the cards still there and cannot duplicate.
   Adding needs no provider, so it works like any manual event (including two-way sync push, #264).
4. **Undo** — the toast "Added N events" offers Undo for 10 minutes. `POST /api/calendar/import-suggestions/undo
   { eventIds }` deletes only events of the caller's household, **created by the caller**, at most 10 minutes old,
   and never subscription or provider-imported events (403 `UNDO_NOT_ALLOWED` for any other member's event, 409
   `UNDO_WINDOW_EXPIRED` after the window, all or nothing). Unknown and other-household ids are skipped identically,
   so a repeated undo answers `{ removedCount: 0 }`. This is the only way a teen can delete an event, and only their
   own just-created ones (the same O-5 rule as the grocery undo). The activity entry "X added … to the calendar"
   stays. Undo is not behind the provider kill switch (it never calls the provider).

### Dates and time zones

- Households have no stored time zone yet (`DEFAULT_FAMILY_TIMEZONE`, America/Toronto, is the product default used
  by ICS imports), and the calendar shows and creates events in the viewer's device zone. The page therefore sends
  its IANA zone (`timeZone`); the server uses it when it is a valid zone name and otherwise falls back to the
  household default. When households gain a stored zone, `resolveImportTimeZone` switches to it.
- The model returns wall-clock values (`date`, `start_time`, `end_date`, `end_time`, `all_day`). Relative dates ("next
  Friday") are resolved by the model against the `today` the page sends (`YYYY-MM-DD`, bounded like the inventory's:
  a real day within one day of the server's UTC date, else 400 `INVALID_TODAY`); the prompt carries today's weekday.
- The server re-checks everything: real calendar dates only; within 366 days before and 3 × 366 days after today;
  `HH:MM` 24-hour times; a missing start time makes the event all day; an end before the start is dropped; a
  multi-day span is at most 31 days. Timed suggestions are returned as ISO 8601 with the zone's offset
  (`2026-10-09T15:30:00-04:00`), resolved with the same DST rules as ICS imports (RFC 5545: gap → later offset,
  overlap → first occurrence). All-day suggestions are `YYYY-MM-DD` (and the last day, inclusive).
- Stored like the manual form: all day is 00:00 on the first day to 23:59 on the last day in that zone; a timed event
  without an end has `end_time = start_time`; an end at or before the start on the card is read as the next day.

### Provider, safety and privacy

- Anthropic Messages API only, fixed host `https://api.anthropic.com/v1/messages`, raw `fetch` with `redirect:
  'manual'` and a 45 s timeout. Model from `EVENT_IMPORT_MODEL` (default `claude-sonnet-5`, anything that is not a
  model id falls back). Structured output (`output_config.format` JSON schema) with low effort; images are `image`
  blocks and PDFs base64 `document` blocks (`media_type: application/pdf`), placed before the instruction text.
  Pasted text is fenced between markers and the system prompt says source text is data, never instructions. Nothing
  about the provider is configurable per household or per request; the per-family OpenAI-compatible capture settings
  (`src/lib/capture.ts`) are **not** reused.
- Its own key (`EVENT_IMPORT_ANTHROPIC_API_KEY`), deliberately not the fridge scan's
  `INVENTORY_SCAN_ANTHROPIC_API_KEY` (#265): each feature can live in its own Anthropic workspace with its own spend
  limit, and can be revoked or switched off without touching the other.
- Output is untrusted: zod-validated, cleaned (NFC, control/bidi characters and angle brackets removed, whitespace
  collapsed, title/location ≤ 200 and notes ≤ 1,000 characters, titles need a letter), de-duplicated by title and
  start, sorted and capped at 30, and rendered only as React text or input values.
- Nothing is stored: the text or file stays in memory for one request, is never written to disk, the database or
  logs, and provider error bodies are discarded unread. Logs (`event.import`, `event.import.failed`,
  `event.import.error`, `event.import.undo`) carry the user id, input kind and size, counts, duration and upstream
  status only.
- Limits: 10 per person and 20 per household per hour, plus `EVENT_IMPORT_DAILY_LIMIT` (default 30, `0` pauses)
  per household per UTC day. Validation runs before the limits, so a wrong file does not use quota.

### Roles

| Action | Parent | Teen | Child | Shared device | Other household |
| --- | --- | --- | --- | --- | --- |
| Suggest | yes | yes | 403 `EVENT_IMPORT_FORBIDDEN` | 403 `DEVICE_WRITE_NOT_ALLOWED` | n/a (reads no rows) |
| Add | `POST /api/events` rules (all roles may create) | same | same | same | session household only |
| Undo | own events ≤ 10 min | own events ≤ 10 min | 403 | 403 | skipped like a missing id |

The page `/dashboard/calendar` is parent-only in the UI today (kid allowlist), so only parents see the button; the
API allows teens so a teen surface can be added later without an API change.

### Email forwarding (dormant design, not implemented)

Goal: a parent forwards a school email to a household address and finds pending suggestions to review, without
copying and pasting. Nothing below exists in code; it needs Cameron's decisions on the mail provider, DNS and cost.

1. **Address.** One inbound address per household, e.g. `h-<random 20+ chars>@in.<app domain>`, stored hashed on
   `Family` (like the feed token) and rotatable by a parent. No address is guessable from the household id. The
   domain's MX points at an inbound-mail provider (for example Postmark, SendGrid Inbound Parse, Mailgun Routes or
   AWS SES receiving), chosen by Cameron.
2. **Webhook.** The provider posts parsed mail to `POST /api/inbound/email/<provider>`; the route verifies the
   provider's signature or basic-auth secret (server env), rejects anything over a size cap, resolves the household
   from the recipient address, and accepts mail only from addresses of that household's parents (verified account
   emails), else drops it silently (no bounce, to avoid address probing). It is rate-limited per household and
   counted against `EVENT_IMPORT_DAILY_LIMIT`.
3. **Same pipeline.** The text body (HTML stripped) and at most one PDF or image attachment go through
   `suggestEvents` unchanged, with the household zone and the server's today.
4. **Pending suggestions.** Unlike the interactive flow, suggestions must be kept until reviewed: a new
   `PendingEventSuggestion` table (household, source "email", received at, sender user, the cleaned suggestion
   fields, status pending/added/dismissed, expires after 14 days). The raw email and attachments are never stored.
   Parents see "N suggested events from email" on the calendar and review them with the same cards; "Add" uses
   `POST /api/events` and marks the rows added; expired rows are deleted when the list is next read (no cron).
5. **Off until configured**, like the rest: without the inbound secret and domain the route is 404 and no address is
   shown. Privacy page and runbook must describe the stored pending suggestions before it is enabled.
