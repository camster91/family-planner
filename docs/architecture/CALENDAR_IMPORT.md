# Calendar import (read-only ICS subscriptions)

Status: implemented for #232 (scope approved from the #124 calendar-sync contract). Covers **read-only** import of public/private ICS feed links. Two-way sync, CalDAV and OAuth calendar providers are out of scope.

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
