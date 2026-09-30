# Calendar sync (two-way Google and Outlook)

Status: implemented for #264, **dormant until configured**. Nothing runs, no route answers and no UI appears unless
the operator sets the environment described in [`docs/runbooks/CALENDAR_SYNC.md`](../runbooks/CALENDAR_SYNC.md).
Read-only ICS subscriptions (#232) are separate and unchanged: [`CALENDAR_IMPORT.md`](CALENDAR_IMPORT.md).

## Summary

A parent connects **their own** Google Calendar or Outlook / Microsoft 365 account in **Settings → Connected
calendars**, chooses one of their writable calendars, and events flow both ways:

- provider events appear on the family calendar as normal, editable `Event` rows;
- local edits and deletes of those events are written back to the provider;
- optionally (per connection, off by default) new family events are also added to the provider calendar.

| Piece | Location |
| --- | --- |
| Schema | `prisma/schema.prisma` (`CalendarConnection`, `CalendarEventLink`, `CalendarOAuthState`, `Event.source_connection_id`, `Event.updated_at`) and the same objects in `scripts/migrate.js` (idempotent, additive) |
| Kill switch / config | `src/lib/calendar-sync/config.ts` |
| Token encryption | `src/lib/calendar-sync/token-crypto.ts` |
| OAuth state + PKCE | `src/lib/calendar-sync/oauth.ts` |
| Outbound HTTP guard | `src/lib/calendar-sync/http.ts` |
| Provider adapters | `src/lib/calendar-sync/google.ts`, `microsoft.ts` (interface in `types.ts`) |
| Sync engine | `src/lib/calendar-sync/sync.ts` |
| API | `src/app/api/calendar/connections/**`, `src/app/api/calendar/sync-connections/**` |
| UI | `src/app/dashboard/settings/CalendarSyncSection.tsx`; opportunistic sync in `src/app/dashboard/calendar/page.tsx` |
| Tests | `src/lib/calendar-sync/__tests__/**`, `src/app/api/calendar/connections/__tests__/routes.test.ts`, `src/app/dashboard/settings/__tests__/calendar-sync-section.test.tsx`, `src/app/api/__tests__/device-route-allowlist.test.ts`, opt-in `sync.integration.test.ts` |

## Kill switch

A provider is available only when **all** of these are set and valid (`getProviderConfig`):

- `CALENDAR_TOKEN_KEY` — base64 of exactly 32 bytes;
- `APP_URL` (or the existing `NEXT_PUBLIC_APP_URL`) — `https://…`, or `http://localhost` for development;
- Google: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`;
- Microsoft: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` and `MICROSOFT_TENANT`.

With no provider available, every `/api/calendar/connections/**` and `/api/calendar/sync-connections/**` handler
answers `404` before authentication (whoever calls), the settings page does not mount the section, and the calendar
page does not start opportunistic syncs. One provider can be on while the other is off; the off provider's routes
are `404`. Removing the variables later turns everything off again; stored rows stay (see the runbook for cleanup).

## Data model (expand-only)

- `CalendarConnection`: `id, family_id, user_id` (connecting member), `provider` (`google`|`microsoft`),
  `calendar_id?, calendar_name?`, `access_token_enc?, refresh_token_enc?, token_expires_at?`, `sync_cursor?`
  (Google `nextSyncToken` / Graph `@odata.deltaLink`), `push_mode` (`linked` default | `all`), `status`
  (`pending`|`ok`|`error`|`reauth_required`), `last_synced_at?`, `last_error?` (fixed vocabulary),
  `conflicts_count`, `last_conflict_at?`, `generation` (bumped on calendar change and re-connect), timestamps. `UNIQUE (family_id, user_id, provider)`: one connection per
  member per provider. FKs cascade from `Family` and `User`.
- `CalendarEventLink`: `id, family_id, connection_id, event_id?, external_id, external_etag?, external_updated_at?,
  synced_hash?, all_day, synced_at?`. `UNIQUE (connection_id, external_id)` makes imports idempotent;
  `UNIQUE (connection_id, event_id)` keeps one link per local event per connection. `event_id` is
  `ON DELETE SET NULL`: deleting a local event leaves a **tombstone** link that the next sync turns into a provider
  delete. A link table (instead of more `Event` columns) lets one local event be linked to several connections.
- `CalendarOAuthState`: `state_hash` (unique, SHA-256 of the state), `family_id, user_id, provider`,
  `code_verifier_enc`, `expires_at`, `used_at?`.
- `Event.source_connection_id?` (FK, cascade): set on events first imported from a connection, null otherwise.
  `Event.updated_at` (`@updatedAt`, default now) is the local last-writer-wins timestamp.

Old clients ignore the new columns; no existing column changes meaning. Rollback: revert the app code; the new
tables and columns stay unused. Contract step (dropping them) would need its own approval.

## Roles

Parent-only. Teens and children get `403 PARENT_REQUIRED` on every route (and never see the settings page); a
paired shared device is not a person session and gets `401` (route-allowlist test). Decision: connecting an
external account moves household data into a personal account and stores long-lived credentials, which is the kind
of account control `AGENTS.md` keeps with parents. Within the household:

| Action | Connecting parent | Other parent |
| --- | --- | --- |
| See the connection (provider, chosen calendar name, status, owner name) | yes | yes |
| Connect own account (start / callback) | yes | yes (their own) |
| List the account's calendars, choose calendar, change push mode | yes | **no (403)**: it is the other member's personal account |
| Sync now | yes | yes |
| Disconnect | yes | yes (household control over what appears on the family calendar) |

A connection in another household is `404` on every per-connection route, identical to a missing id.

## OAuth

Authorization code + PKCE (S256) + single-use `state`:

1. `POST /api/calendar/connections/[provider]/start` (POST, so the global CSRF header check applies) creates
   256 bits of state, stores only its SHA-256 with the member, household, provider, 10-minute expiry and the
   encrypted PKCE verifier, and returns `{ authorize_url }` for the browser to navigate to.
2. The provider redirects to `GET /api/calendar/connections/[provider]/callback`. It is a GET (CSRF middleware does
   not apply); the state is the CSRF defence. The callback requires the same signed-in parent, consumes the state
   atomically (`updateMany … used_at = NULL`), and refuses unknown, used, expired, other-member,
   other-household and other-provider states. Any matching state is burnt even when refused.
3. The code is exchanged with the verifier; tokens are encrypted and stored; the browser is sent to
   `/dashboard/settings?calendar_sync=<outcome>#calendar-sync` with `Referrer-Policy: no-referrer`.

The redirect URI is always `${APP_URL}/api/calendar/connections/<provider>/callback`, built from configuration and
never from request headers. Scopes are minimal:

- Google: `https://www.googleapis.com/auth/calendar.events` and
  `https://www.googleapis.com/auth/calendar.calendarlist.readonly` (to let the member choose a calendar),
  `access_type=offline`, `prompt=consent`.
- Microsoft: `offline_access Calendars.ReadWrite` (delegated).

Re-connecting the same provider updates the existing connection (new tokens, cursor reset, new generation; links
keep it idempotent). A missing refresh token on first connect is treated as a failed exchange. The household limit
(6) and one-connection-per-member-per-provider are enforced when the callback **commits**, inside a transaction
under a per-household advisory lock (`src/lib/calendar-sync/connections.ts`); the check in `start` is only an early
refusal. A callback over the limit revokes the fresh grant (best effort) and redirects with `calendar_sync=limit`.
`GET /api/calendar/connections` is not truncated.

## Token encryption

`token-crypto.ts`: AES-256-GCM with the key from `CALENDAR_TOKEN_KEY` (not derived from `JWT_SECRET`, so rotating
sessions does not break connections and a leaked JWT secret does not unlock provider tokens). Format
`ct1.<kid>.<iv>.<tag>.<ciphertext>`; `kid` is a key fingerprint so `CALENDAR_TOKEN_KEY_PREVIOUS` can still decrypt
during a rotation. Additional authenticated data binds each value to its purpose and household
(`access:<familyId>`, `refresh:<familyId>`, `pkce:<familyId>`), so a ciphertext copied to another row or household
does not decrypt. Tokens are never returned by the API, never logged, and never sent to the browser or the
Capacitor bundle.

## Provider adapters and HTTP safety

`CalendarProviderAdapter` (`listCalendars`, `pull`, `create`, `update`, `remove`) and `OAuthClient`
(`authorizeUrl`, `exchangeCode`, `refresh`, `revoke`) are the only provider-specific code; `fetch` is injected.
`providerFetch` only reaches `oauth2.googleapis.com`, `www.googleapis.com`, `login.microsoftonline.com` and
`graph.microsoft.com` over https on the default port, never follows redirects (`redirect: 'manual'`), times out
after 15 s, and caps bodies at 5 MB. Graph `@odata.nextLink` / `@odata.deltaLink` values (and the stored cursor) are
re-validated to be `https://graph.microsoft.com/v1.0/…` before use, so a tampered cursor cannot point the server
anywhere else. (Browser-only: `accounts.google.com` for the consent page.)

Rate limits: `429` and `503` are retried up to 3 times, honouring `Retry-After` (seconds or HTTP date) or
exponential backoff; a `Retry-After` above 20 s is not waited out inside a request — the run ends with
`status = error`, "The calendar provider is busy…", and the next run retries.

- Google: `events.list` with `singleEvents=true&showDeleted=true`, `timeMin/timeMax` = sync window on a full
  listing and `syncToken` afterwards, paging via `nextPageToken` (max 50 pages). `410` = cursor expired.
  Creates use a deterministic event id (SHA-256 of connection + local event) so a retried create returns `409`
  and is resolved to the existing event. `extendedProperties.private` carries a marker (connection id, local event
  id). All-day events use `date`.
- Microsoft: `GET /me/calendars/{id}/calendarView/delta?startDateTime&endDateTime` with
  `Prefer: outlook.timezone="UTC", outlook.body-content-type="text", odata.maxpagesize=100`, following
  `@odata.nextLink` to `@odata.deltaLink`. `410` = delta state expired. `@removed` or `isCancelled` = deleted.
  Creates send `transactionId = fp.<connectionId>.<eventId>` (Graph's idempotent-create key, also the marker).
  Microsoft has no per-app revocation endpoint for delegated consent; disconnect deletes our copy of the tokens and
  the runbook tells the member how to remove consent.

## Sync semantics

A run (`syncConnection`) is: refresh the access token if it expires within 60 s → pull → apply → save cursor →
push. A `401` from the provider forces one refresh and retry; `invalid_grant` sets `status = reauth_required`,
clears the access token and shows "Reconnect".

**Window.** The same window as ICS import: now − 30 days to now + 180 days (`importWindow`). Full listings are
limited to it; incremental changes are applied whenever they arrive, except new events that ended before the window.

**Pull / apply** (per provider event, keyed by `(connection, external id)`):

| Remote | Local link | Result |
| --- | --- | --- |
| new | none | create `Event` (`source_connection_id`, `created_by` = connecting member, type `other`) + link, in one transaction |
| new, carries our marker | none | re-link to that local event (a crash between provider create and link write never duplicates) |
| changed (etag differs) | local unchanged | overwrite local fields; update link |
| changed | local changed too | **conflict**: last writer wins — provider `updated` vs local `Event.updated_at`; remote newer → overwrite local; local newer → keep local and push it |
| same etag | any | no-op |
| deleted | linked | delete the local event and link (remote delete wins; counted as a conflict if the local row had unsynced edits) |
| changed | tombstone (deleted locally) | local delete wins (counted as a conflict); pushed below |

"Local changed" = SHA-256 of `(title, description, location, start, end)` differs from the link's `synced_hash`.
On a full listing (first run, re-connect, calendar change, or after `410`) linked events inside the window that the
provider no longer returns are deleted locally (mark and sweep).

**Push** (at most 100 provider writes per run; the rest continue next run):

1. tombstone links → provider delete (already gone is fine) → delete link;
2. linked events whose hash changed → provider update; if the provider event is gone, an event imported from it
   is deleted locally, a local-origin event just loses its link;
3. `push_mode = 'all'` only: household events with no link to this connection, not from an ICS subscription, not
   imported from any connection, not project tasks, starting from yesterday to the end of the window → provider
   create + link.

**Push mode decision.** Default `linked`: only events that came from the connected calendar are written back.
Pushing every family event into a personal account shares household data outside the app, so it is an explicit
per-connection opt-in by the connecting member ("Also add new family calendar events to this calendar"). A per-event
"send to my calendar" mark was not added (no UI for it yet); `all` covers the common case.

**Conflict records** are content-minimal: `conflicts_count` and `last_conflict_at` on the connection, and a log line
with ids and a fixed code only. No titles, times or provider bodies are stored or logged.

**Stale runs.** A run records the connection's `generation` when it starts. Every write that creates rows or
saves run state (imported event + link, re-linked marker, pushed link, cursor, final status) happens in a
transaction that first locks the connection row with a no-op `UPDATE … WHERE generation = <start>`. `changeCalendar`
(and a re-connect) bumps the generation under the same row lock before clearing the old calendar's events and links.
So a run racing a calendar switch either committed before it (and its rows are then cleared) or finds the new
generation and stops with `status: "superseded"` without writing the old calendar's cursor, rows or status.

**Push candidates** exclude events already linked to the connection in the query itself
(`sync_links: { none: { connection_id } }`), limited to the run's remaining budget, so households with more
eligible events than one run can push make progress on every run.

**Idempotency.** Unique link keys + etag comparison + deterministic provider creates mean re-running a sync (or two
concurrent runs) creates no duplicate rows; a concurrent loser's transaction rolls back on `P2002`. One run per
connection per process at a time (`syncConnectionExclusive`).

**Recurring events** are synced per instance (Google `singleEvents`, Graph `calendarView`); editing one instance
edits that occurrence only. The local `recurrence` field is not synced. **All-day** events are stored as
household-local midnight to midnight (`America/Toronto` until households have a zone, as for ICS) and are written
back as all-day while their times stay on local midnights.

## Triggers (no scheduler)

- `POST /api/calendar/sync-connections/[id]/sync` ("Sync now", any parent), rate-limited to 6 per 10 minutes per
  connection.
- Opportunistic: when `/dashboard/calendar` renders, `after()` runs `refreshStaleConnections(familyId)` for ready
  connections not synced in the last **5 minutes**, with a DB-backed `checkRateLimit('calsync-auto:<id>', 1, 5 min)`
  lease against stampedes across tabs and replicas. Connections in `reauth_required` are skipped.

No cron job or scheduled workflow is added (AGENTS.md). Consequence: a provider change appears after the next
calendar page load or Sync now; local edits are pushed at the same moments.

## Disconnect

`DELETE /api/calendar/sync-connections/[id]`: revoke at the provider (Google `oauth2.googleapis.com/revoke`, best
effort, failures ignored; Microsoft has no endpoint), then in one transaction delete the links, the events imported
from that connection, and the connection (with its encrypted tokens). Local-origin events that were pushed stay on
the family calendar and their copies stay in the member's calendar. Changing the chosen calendar similarly removes
the old calendar's imported events and links and resets the cursor.

## Privacy and logging

- Responses never include tokens, cursors, provider ids of tokens, or provider error bodies. `last_error` is one of
  a fixed set of messages.
- Logs: `[calendar-sync] …` with connection id / provider and a fixed code only.
- Calendar names of a member's account are visible only to that member (calendar list) and, once chosen, the chosen
  calendar's name to the household's parents.
- The shared tablet never sees connection data; imported events follow the existing event rules (device reads title
  and times only).

## Known limits / follow-ups

- Not verified against live Google/Microsoft endpoints (no OAuth apps registered yet). Endpoint shapes follow the
  public docs; verify with the runbook's checklist before enabling.
- Whether Google returns `nextSyncToken` for a listing that used `timeMin/timeMax` is provider behaviour; if it does
  not, every run is a (bounded, idempotent) full listing.
- Graph `calendarView/delta` on a non-default calendar should be verified during setup.
- Household time zone is still the product default.
- `Event.recurrence` rules created locally are pushed as a single event, not as a series.
