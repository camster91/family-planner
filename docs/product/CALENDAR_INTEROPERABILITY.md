# Calendar interoperability source and acceptance map

2026-10-20, #124/#109/#128; current source re-read, not provider or rendered QA.
Existing implemented ICS (#232) and gated OAuth sync (#264) are preserved.
Discovery, current-provider configuration/permission, household beta evidence and
acceptance remain separate. No account/provider call, credential read/change,
sync, calendar write, migration, scheduler or activation occurred in this pass.

## Local native-D1 acceptance — 2026-11-03

The current application parser and subscription writer were exercised together
in disposable workerd/D1 with fabricated feeds and no external provider access.
Both Toronto transitions (March 8 and November 1, 2026) preserve a weekly 09:00
wall time, the expected UTC offsets and one-hour duration. Repeated imports keep
all three row identities. Moving the middle occurrence to another day retains
its original recurrence identity; cancelling the last deletes only that row.
Replaying those exceptions makes no further changes, and cancelling the master
removes the two remaining instances. Unrelated manual events, historical rows and
another household's events remain intact.

The same native fixture passed conditional 304 handling, malformed/truncated-feed
preservation, atomic status/write rollback, access revocation during fetch, source
replacement refusal and a 600-occurrence import with bounded D1 values. The
subscription fixture also passed the concurrent ten-source limit, encrypted URL
projection, teen URL privacy, foreign-household concealment and imported-only
atomic removal. These checks are executable with:

```sh
node scripts/cloudflare/read-smoke.mjs --only=calendar-sync,calendar-subscriptions
```

Five focused parser/sync/HTTP/provider-adapter Jest suites also passed (126 tests).
Provider responses in those tests are simulated. Logs are retained as
`calendar-interop-*` in the sibling `artifacts/connected-family-features-20261103/`.
This supersedes historical unrun wording only for the cases actually exercised;
it does not establish live Google/Microsoft grants, Apple calendar behavior,
physical-device/offline UI, household discovery, feed-export capacity or full
#124 acceptance. No production integration or credentials changed.

## Unverified feed-format follow-through — 2026-10-24

The existing read-only household ICS export now folds text and long RRULE
lines by UTF-8 byte count without dividing Unicode code points. Prior conservative
ASCII widths remain. Bare CR joins CRLF/LF normalization in escaped text, retaining
literal text rather than creating extra content lines. Token/family resolution,
UIDs, timestamps, supported recurrence spelling, date range and cache headers are unchanged.
Multibyte/emoji, newline-escaping and ASCII-boundary cases are authored/unrun.
No provider access, sync, QA/build/browser/API/database or release ran.

The export now assembles a complete feed with200-row `(start_time,id)` keyset
reads inside one30-second RepeatableRead transaction, including token/household
resolution. The former2,000-event refusal is replaced by explicit10,000-event
and16MiB assembled-wire limits. One-row lookahead detects the count boundary.
No successful ICS bytes are returned until all pages and the final END marker
are assembled. Overflow still returns503/no-store with
`CALENDAR_FEED_TOO_LARGE`; supported feeds retain the successful format/cache
contract and stable UID/timestamps. Only feed fields are selected. This does not
prove database/JS peak memory, serialization cost, concurrency/snapshot behavior,
query plans or provider handling; unusually wide legacy DB rows can still incur
read allocation before the output budget is enforced. Subscription
imports refuse capped parse results before reconciliation and retain existing
events plus last-complete ETag/Last-Modified. These changes are authored/unrun.
Export above the new count/byte limits remains unavailable. Identified malformed series now
refuse the whole parse before reconciliation; concatenated calendar documents
also refuse instead of silently reading the first. Existing cancellation/no-UID
rules remain. The parser normalizes library errors and rejects invalid coverage
options. These source changes and their regression cases are unrun. Overlong UIDs now refuse instead of truncating matching identity; duplicate
master UIDs and duplicate resolved override identities also refuse before writes.
Boundary/ambiguity/sync-preservation regression source is authored/unrun. Broader
semantic/format validation, historical partial-import recovery, query/native/
provider/error behavior and all original #124 acceptance remain open.

## Stored recurrence export guard — 2026-10-24, source only

`calendar-feed-rule.ts` validates stored recurrence at the feed boundary before
emission. It uses the already lockedical.js2.2.1 parser without expanding any
occurrences, plus explicit structural checks for missing/duplicated/unknown keys,
non-positive/unsafe count or interval, conflicting count/until, unsupported zero
day/week/position values and extra content lines. Rules above8,192 characters
are unsupported. Parsed UNTIL values must preserve their supplied basic-ICAL
representation; normalized replacements are not silently adopted. Supported rules
keep supplied key order/explicit values, with the existing uppercase/prefix
normalization. No `Recur.toString()` reconstruction that could omit parts.

A malformed/ambiguous/unsupported stored rule refuses the entire feed with
503/private-no-store `CALENDAR_FEED_INVALID_RULE`. No successful prefix, skipped
series or one-off substitution is returned. Error text contains no stored rule,
event identifier or token; stored data, event input schemas and identity are
unchanged. Parent-facing read-only identification is now authored below; canonical
repair and its acceptance remain separate. This is a
bounded parser/structure guard, not exhaustive cross-part recurrence semantics,
Toronto/DST/provider acceptance or validation of every legacy rule format.

Reference inspected (read only):
[ical.js2.2.1 recurrence parser](https://github.com/kewisch/ical.js/blob/v2.2.1/lib/ical/recur.js).
Its parser permits unknown parts and normalizes some interval values, so a parse
alone is not the feed acceptance decision. Regression source is authored/unrun;
no parser execution, QA, application/provider/database call or release ran.

## Parent recurrence recovery — 2026-10-24, source only

Settings → family → Calendar feed now has a lazy EN/ES “Review repeating events”
overlay. It fetches only on a tap, uses the shared bounded foreground/JSON helper,
and replaces each100-event diagnostic group rather than appending an ever-growing
screen. Retry repeats the exact cursor; close/replacement/unmount cancels and
invalidates ownership. A changed server-provided household scope remounts/clears
the component. A stale expected-household response requires reloading Settings.

`GET /api/calendar/feed/review` uses personal authentication/current parent role,
including central paired-device refusal, and an explicit expected-household
header. The header is a stale-context check, never authority. The current session
supplies the actual household. An absent/malformed header refuses400; mismatch
refuses409 before event reads. Opaque canonical cursors bind to that household;
repeated/malformed/foreign cursors refuse. The endpoint selects101 candidate rows
for100-row keyset groups, always private/no-store. Only affected event IDs, titles
and local/connected/subscribed kind leave the server—never raw recurrence text,
feed tokens, description, locations or provider credentials. No write method.

Each group reports only its inspected count and unsupported rules. A clear group
is not a complete feed check, count/byte capacity proof, provider/revocation test
or snapshot of all roots. Concurrent edits can change later groups. Unusually
wide legacy rule/title fields may still allocate during the DB read. Unsupported
legacy DTO shapes fail the read instead of being presented as a clear result.

Local events link to the existing `/dashboard/calendar/edit?id=...` editor;
connected/subscribed events link to their Settings source controls and retain
read-only ownership. There is no automatic rule replacement, deletion, save,
provider call, connection activation or token rotation. Existing editor/source
availability and repair semantics still require their original acceptance.

Parent/role/household/cursor/minimal-DTO, changed-scope late response, EN/ES and
canonical-link regression sources are authored/unrun. Device route inventory
also records the new personal-only read. No API, browser, test, DB, provider or
release execution occurred. Full #124/#139 acceptance remains open.

## Explicit repeat-rule removal — 2026-10-24, source only

The existing personal parent event editor now exposes a collapsed repeat-rule
section only for a stored local repeating event. Ordinary title/time/location/
notes saves continue to omit recurrence, preserving custom and unsupported rules.
“Stop repeating” is an explicit draft choice with a warning; “Keep the saved
repeat rule” cancels it before save. Saving removal sets recurrence to null and
includes the exact originally read rule as `expected_recurrence`. Separate events,
completed history and imported source records are not deleted or rewritten.
The choice does not create a replacement daily/weekly/monthly rule or claim an
in-app recurrence planner. Legacy rules above8,192 characters remain held for
support review; other metadata edits preserve them.

Canonical PATCH now delegates to `person-event-update.ts`. It locks the current
User then household, renews token generation/current parent membership and
household existence, locks the owned event, then re-reads source/range/rule before
one scoped update. Subscription read-only and existing connected-event edit policy
remain. The merged date-range check uses the locked current bounds. A stale
reviewed rule returns409 `EVENT_RECURRENCE_CHANGED` before **any** metadata change.
The EN/ES form retains its draft and asks the parent to reopen/review the event.
The precondition is not persisted or used as authority.

The review precondition is additive and optional for installed-client compatibility;
when supplied it is accepted only with recurrence:null. Legacy PATCH bodies retain
their absolute-field behavior. This is not whole-event optimistic concurrency or
an idempotent receipt. Lost removal responses require canonical reinspection;
retry can conflict once the original clear already committed. There is no automatic
retry/replacement, post-save Undo, provider dispatch, new offline action or data
migration. Read-only sources still use their original calendar controls.

Authority/stale-rule/source/range unit cases and EN/ES preservation/removal/cancel/
conflict UI cases are authored/unrun. Fake transactions establish no actual PG
locking/rollback, cross-household concurrency or native/rendered acceptance. No
API, DB, test, build, browser, provider or deployment was executed. Broader rule
editing, complete semantic validation and all original #124 criteria remain open.

## Event creation and completed-response authority — 2026-10-24, source only

`person-event-authority.ts` now supplies the shared User-then-household lock and
fresh session-generation/membership/known-role/household-existence check for
creation, completed-create replay and editing. Existing role policy remains:
parent/teen/child may create via the canonical API; only parents edit. UI role
allowlists are unchanged. Unknown roles and changed household/session refuse.

Normal and assistant-backed creation both renew authority inside the transaction
before event/activity effects or an in-transaction private receipt read. The API
also supplies a replay guard for **all** completed keyed responses, including
normal captures without assistant proof. An actor who left the original family
cannot recover its old private event response through a request authenticated
before the membership change. Input hash/key/expiry, canonical event/activity and
receipt writes, and opt-in post-commit beta counting remain unchanged. An outer
idempotency claim/refusal record can still be created before the effect check;
this is not a promise of zero ledger writes on an authority refusal.

Assistant ownership authorization is retained; uncommitted effects still verify
current source/lease. Completed replay renews ownership without re-verifying an
expired or changed source, preserving recovery of an already committed event.
No proof, old name or client family value supplies current household authority.
No new create/edit permission, feature activation, provider dispatch, scheduler,
offline action, migration or separate event store is added.

Regression source includes all three allowed create roles, changed household/
session/unknown role, absent household, normal replay refusal, assistant replay
without second source verification, and no repeated event/activity/beta effects.
Existing opt-in assistant integration source is adapted to the new actor/replay
contract; nothing was run. Fake transactions do not prove real lock ordering,
concurrency, rollback or lifecycle/native acceptance. Full #124/#134/#136 gates
remain open.

## Product modes and actual ownership

| Mode | Current source behavior | Explicit limit |
| --- | --- | --- |
| In-app | Canonical Event records and existing personal/calendar UI | A stored recurrence rule is not a full series/exception editor. Do not promise arbitrary recurring-series editing |
| Read-only ICS subscription | Canonical CalendarSubscription + source-tagged Event occurrences; parent adds/removes, teen may refresh, authorized family members read events | Feed-link subscription, not CalDAV, OAuth or two-way editing. Apple calendar interoperability is through an available ICS link; no Apple OAuth/native-device calendar access is implemented |
| Google/Microsoft two-way | CalendarConnection + CalendarEventLink + encrypted token/OAuth state; parent-owned account controls, household sync/disconnect | Dormant unless current source configuration validates. Existing source does not prove OAuth setup/provider verification, runtime activation or real-account acceptance |
| Reviewed text/image/manual import | Existing import-suggestions review/commit/Undo | Creates reviewed local events, not a persistent provider sync or permission to connect an account |

Source filters distinguish local, connected and subscribed events. Subscribed
rows remain read-only. Connected rows use normal Event editing with provider
sync rules, not the ICS read-only rule. Do not infer two-way access because an
ICS feed URL came from Google/Apple/Microsoft. No new top-level nav or parallel
calendar store is introduced.

## Required contract mapped to current source

| #124 contract / acceptance | Source / authored coverage | Later evidence still required |
| --- | --- | --- |
| Stable external identity and repeated-sync duplicate prevention | CalendarSubscription + source UID/occurrence unique key; CalendarEventLink per connection/external ID and event link. `calendar-import/sync.ts`, `calendar-sync/sync.ts`; their sync unit/integration files. Google deterministic create ID and Microsoft transaction marker are in source adapters | Disposable DB repeat/concurrent/lost-response/full-resync cases, then approved provider sandbox behavior; no exact-head pass claimed |
| Recurrence, exceptions and deletion | `calendar-import/parse.ts`, `timezone.ts`: RRULE/RDATE/EXDATE/RECURRENCE-ID expansion inside bounded windows; parse test source includes weekly override/EXDATE, floating and VTIMEZONE-only dates. Google singleEvents/showDeleted and Microsoft calendarView/delta adapters consume provider occurrences. Tombstones/full-window sweep in sync engine | Current fixtures plus cancelled/overridden occurrences, truncated feed/window, cursor expiration, provider deletion vs locally edited record, per-occurrence edit/delete. No whole-series UI write claim |
| Toronto/DST and date correctness | Existing timezone helpers and authored March gap/November fold, wall-time, all-day and floating fixtures. `CALENDAR_IMPORT.md` / `CALENDAR_SYNC.md` preserve source-defined conversions; calendar planner uses exact instants and DST agenda fallback | Execute current fixtures, EN/ES device display and cross-midnight/all-day range journeys. Source household-zone fallback is America/Toronto, not a newly implemented family timezone preference |
| Conflicts and deletion policy | Sync engine tracks content hashes/provider update stamps, timestamps and tombstone links; conflict counters use minimal metadata. Existing spec defines remote/local changed conflicts, remote deletes and local tombstones. Source connection generation prevents stale reconnect/calendar-selection runs from applying | Concurrent edit/delete/reconnect/unlink fixtures and actual provider conflict behavior. Timestamp last-writer policy is a policy, not guaranteed conflict-free merging |
| Revoked credentials, reconnect, outage and rate limit | Encrypted tokens, one-use/expiry/PKCE OAuth state, guarded outbound requests and fixed error vocabulary in calendar-sync modules. OAuthGrantError/401-refresh/cursor-expired paths; Settings reconnect/status controls | Revoked/partial-scope/missing-calendar/provider-busy fixture and approved account checks. Source code/config presence is not proof that current provider credentials work |
| Family/role/device isolation | Parent sync ownership and account-owner-only calendar selection; household-scoped lookups, subscription role matrix and paired-device refusal. Existing routes/isolation/allowlist/integration tests | Current exact-head two-household direct API, role downgrade/member removal, reconnect generation and token revocation cases. Never use a shared-device capability to grant personal account control |
| Clear UI source/status | CalendarPlanner source filters/badges and read-only details, compact connections entry, CalendarSubscriptionsSection and CalendarSyncSection status/owner/last-sync/reconnect UI | Authenticated complete phone/tablet/desktop journeys including long names, no provider, unavailable source, focus/Back, errors and localized dates. No rendered proof claimed here |
| Disable / remove / rollback | Configuration kill switch makes OAuth routes/UI unavailable while rows remain. Source subscription/connection cleanup scopes imported/link data; local-origin events retain the defined unlink policy. Additive schema retained on app rollback | Disposable disable/disconnect/re-enable/reconnect fixtures and retained local manual-event proof. Provider-side consent withdrawal is separate from deleting local token copies |

The exact mechanisms, limits and case policies stay in
`../architecture/CALENDAR_IMPORT.md` and `../architecture/CALENDAR_SYNC.md`, with
operational setup in `../runbooks/CALENDAR_SYNC.md`. Provider setup instructions
are an operator runbook, not verified current portal behavior. Before using
that runbook for real credentials, inspect the chosen provider's current official
requirements and obtain the existing activation authority.

## Mobile, native and offline boundary

Responsive clients use the same Event/source models. OAuth start/callback,
connection selection, feed fetch/refresh, sync and provider writes require a
connection; they are not new offline queue actions. No background calendar
permission, native Apple/Android calendar-store bridge or device-side credential
store is added. Existing personal/shared-device capability boundaries stand.

Supported page-triggered stale refresh and explicit Sync now are event-driven,
not a guarantee of instant/push/continuous background sync. Source code uses
rate limiting against stampedes; no new cron/webhook/scheduler is approved.
Offline/stale UI must label last-known data and preserve local drafts under the
existing calendar/offline contract, never claim a provider accepted a change.
Later QA must cover reconnect/callback return, lock/unmount, revoked session,
app restart and native Back on actual target hardware; a web source map does
not establish native acceptance.

## Evidence-driven rollout still required

#124's original discovery gate remains: record which calendars real consenting
households use and whether read-only link, one-way import, manual capture or
two-way sync solves their need. Do not enable new provider access because source
exists or introduce an additional provider before evidence. #109/#107/#108
external household requirements remain open.

Codex owns current source/contract mapping, isolated fixture preparation and
later consolidated QA. Cameron owns target-account/provider permission and
credentials, environment/production activation and real-household research.
#369 remains OAuth application/account setup; it is not a code blocker that
justifies inventing credentials. No paid provider, production integration or
external calendar write is authorized by this reconciliation.

## People on events (source authored; default-off, not activated)

An event can name who it is for. `EventParticipant` holds one row per person:
a household account (`user_id`) or a standalone email-free profile
(`member_id`), never both. A profile that is mapped or linked to an account is
represented by that account, as on the Today board.

- **Switch:** `FAMILY_EVENT_PEOPLE_READY=1`. Off, `POST`/`PATCH /api/events`
  refuse a `participants` list with `409 EVENT_PEOPLE_UNSUPPORTED` before any
  write, reads return `participants: []`, `GET /api/events/people` answers
  `{ supported: false }`, and the forms do not load the picker.
- **Write contract:** `participants` is an absolute list of `{ kind, id }`
  (`account` or `profile`), at most 12, each person once. Create stores it with
  the event in one transaction/batch. `PATCH` replaces it; omitting the field
  leaves it unchanged; `[]` clears it. A person outside the household, an
  archived profile or an unknown id refuses the whole request with
  `400 EVENT_PEOPLE_INVALID` and changes nothing. Editing stays parent-only.
- **Read contract:** events carry `participants: [{ kind, id, name, color }]`
  in household order (accounts, then profiles, by creation), limited to people
  who are in the household now. Colour is the person's Today-board colour.
- **Surfaces:** the new and edit event forms ("Who is it for?"), planner chips
  and detail, and Today rows ("For Casey" replaces "Added by" when set).
- **Lifecycle:** deleting the event, the account or the profile cascades the
  row. Leaving the household or archiving a profile hides it on read. Household
  deletion clears the table before events. The database refuses a
  foreign-household account or profile and any edit of a row's identity.
- **Not included:** imported (ICS) events stay read-only; provider sync does
  not map attendees; the ICS feed does not emit `ATTENDEE`; schedule review and
  preparation are unchanged.

## Repeating events (source authored; default-off, not activated)

An event can repeat. Each repeat is a real `Event` row, so every existing read
(planner, Today, device board, feed, search) shows it with no extra code.
`EventSeries` holds the rule and the template the rows are written from.

- **Switch:** `FAMILY_EVENT_REPEAT_READY=1`. Off, `POST /api/events` refuses a
  `repeat` and `PATCH`/`DELETE` refuse `series_scope: "following"` with
  `409 EVENT_REPEAT_UNSUPPORTED` before any write, nothing is written ahead,
  and the forms do not show "Repeat".
- **Rule:** a closed set, not RRULE: `every` is `day`, `week`, `2weeks`,
  `month` or `year`, with an optional last day (`until`, a local date) and the
  author's IANA `time_zone`. Repeats keep the same local time across
  daylight-saving changes. A month or year repeat on a day that does not exist
  (the 31st, Feb 29) skips that month or year.
- **No scheduler:** create writes repeats about 120 days ahead (at most 400
  rows). Calendar, Today and device reads top the household up first, up to two
  years past now, at most 400 rows per series per read. The top-up never fails
  a read. Row ids are derived from the series and start time, so concurrent
  top-ups write each repeat once and a deleted repeat is not written again.
- **Edit and delete:** "This event" changes or deletes one row. "This and later
  events" (`series_scope: "following"`) ends the old series the day before,
  replaces every later row (including ones changed on their own, so no day
  ends up with two), and starts a new series from the edited event; `repeat`
  may change the rule and `repeat: null` stops repeating. From the first event
  it replaces or removes the whole series. Parent-only, like other event edits.
- **People:** the series stores the chosen people; each repeat gets them, and a
  top-up skips people who have since left or been archived.
- **Lifecycle:** deleting a series keeps past rows as one-off events
  (`series_id` set null). Household deletion clears events, then series. The
  database refuses a row that points at another household's series.
- **Not included:** turning a saved one-off event into a repeating one from the
  edit form; imported (ICS) and provider-synced events are unchanged and keep
  their own preserved-rule handling; the ICS feed emits each repeat as its own
  event, not an `RRULE`; assistant-proposed changes cannot use
  `series_scope: "following"`.

## In-app event reminders (source authored; default-off, not activated)

A person gets one inbox row for each event of theirs that starts within the
next 24 hours. In-app only: no push, email, sound or lock-screen surface.

- **Switch:** `FAMILY_EVENT_REMINDERS_READY=1`. Off, inbox reads write nothing
  and the bell shows no unread dot.
- **No scheduler:** the first page of `GET /api/notifications` writes the due
  reminders for the signed-in account before it reads. With the switch on, the
  top-bar bell asks for one unread row on each page change, which both shows an
  unread dot and makes reminders appear without opening the inbox. A failure
  never fails the read. At most 10 rows are written per read.
- **Who:** an event with nobody named is for the whole family. Otherwise the
  accounts named are reminded, and a parent is reminded when it names a person
  without an account. With people on events off, every event is the whole
  family's. Imported events count like any other event.
- **Text:** `Coming up: <title>` and `Today|Tomorrow at <time>`, type `event`,
  linking to `/dashboard/calendar?focus=<id>`. Times use the browser's zone,
  sent as `X-Herewoven-Time-Zone`; without it, a zone the person saved for
  quiet hours or the morning summary; with neither, nothing is written. Text is
  stored in English, like every other inbox row.
- **Once only:** `EventReminder` (event, account) is the lasting proof, written
  in the same transaction/batch as the inbox row. Deleting the inbox row does
  not bring the reminder back. With event notifications muted the proof is
  still written and no row is, so unmuting never replays old events. Quiet
  hours do not hold an in-app row. Moving an event does not remind again.
- **Lifecycle:** deleting the event or the account cascades the proof;
  household deletion clears it before events. The database refuses a
  foreign-household account and any edit of a row's identity.
- **Not included:** per-event or per-person lead times; push or email;
  reminders for chores or meals; an unread count.
- **Evidence:** `npm run cloudflare:test:reads -- --only=event-participants`
  (local workerd/D1), `src/lib/__tests__/event-participants.integration.test.ts`
  (PostgreSQL), unit tests for the rules, validation and picker. No edge,
  production or device acceptance is claimed.
