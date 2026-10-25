# Calendar interoperability source and acceptance map

2026-10-20, #124/#109/#128; current source re-read, not provider or rendered QA.
Existing implemented ICS (#232) and gated OAuth sync (#264) are preserved.
Discovery, current-provider configuration/permission, household beta evidence and
acceptance remain separate. No account/provider call, credential read/change,
sync, calendar write, migration, scheduler or activation occurred in this pass.

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
