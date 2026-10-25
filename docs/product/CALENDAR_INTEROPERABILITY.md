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
UIDs, timestamps, recurrence grammar, date range and cache headers are unchanged.
Multibyte/emoji, newline-escaping and ASCII-boundary cases are authored/unrun.
No provider access, sync, QA/build/browser/API/database or release ran.

The export's existing2,000-row cap can still truncate a dense matching feed. It
has no continuation/overflow contract; correct Unicode formatting does not prove
complete synchronization or safe deletion semantics. Complete large-feed delivery,
query/format/parser/native/provider acceptance and all original #124 gates remain.

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
