# Personal display preferences and household defaults

Issue #560 / #561. Implementation candidate, 2026-10-18. QA, migration rehearsal
and release acceptance are deferred with the combined candidate.

## One source of truth

`User.display_preferences` stores a version-1 JSON record with optional `today`,
`favorites` and `quiet` fields. `Family.display_defaults` stores a version-1
`today` default. Each has its own integer revision. These columns are additive,
nullable and owned by the existing User/Family lifecycle; deletion requires no
new orphan store. The personal data export includes only the caller's record.

No record contains permissions, enabled features, household records, account
credentials, selected shared-device identity or native/provider secrets. A
presentation profile does not become a login or a preference actor. The paired
fridge keeps its existing BoardSettings/display contract.

## APIs and concurrency

- `GET /api/users/display-preferences`: authenticated account of any known role;
  returns effective layout, quiet view, default layout, personal/default
  revisions and whether the person may manage household defaults.
- `PATCH /api/users/display-preferences`: `{ expectedRevision, today?, favorites?,
  quiet?, inheritToday?: true }`. `today` and `inheritToday` are exclusive.
- `GET/PATCH /api/family/display-defaults`: current parent in the current
  household only. PATCH accepts `{ expectedRevision, today }`.

All routes refuse paired-device requests before personal auth. Bodies are
strict, bounded and allowlisted; there is no supplied actor/household ID. Each
command takes the existing user-then-household membership locks, pins the User
row, rechecks session generation/current role/membership and uses a revision
compare-and-set. Role-permitted favorites are resolved through canonical
navigation metadata; feature flags still decide what appears in Explore.

A stale revision returns409 `CONFLICT`; unsupported stored versions return409
`DISPLAY_PREFERENCES_UNSUPPORTED`. Unknown JSON keys and invalid layouts fail400.
Responses are `private, no-store`. An explicit state write is not blindly
retried: a lost response may have committed, so refresh the canonical record
before choosing to save again. This path never queues background private writes.

## Defaults and recovery

An account without a `today` override inherits the current household default.
Parents changing defaults affect only inheriting accounts, never existing
personal overrides or paired fridge screens. Reset removes the override;
favorites and quiet view remain personal. Preview changes presentation only.
Save/Undo carry the captured revision, so a late editor or Undo cannot silently
overwrite a newer device. After a refresh changes the revision, the editor
requires an explicit choice to use the latest saved view or retain the draft.

`DisplayPreferencesProvider` reads/writes these APIs. Owner-scoped local storage
is a read cache for an unavailable network, not a competing authoritative store.
Saving is disabled until canonical preferences load. Failure leaves the saved
view and open editor draft intact, with a deliberate Refresh action. Storage
failure does not misreport a successful account save as lost. No provider call,
cron or cross-device polling service is introduced; focus refresh reads current
preferences and household defaults.

## Migration and later QA

The Prisma schema, `scripts/migrate.js` and
`database/migration-display-preferences.sql` add the same four nullable/revision
columns idempotently. Old binaries ignore them. Rollback restores the earlier
code while retaining columns and values; do not drop saved preferences.
Regenerate the private candidate Prisma client in the later QA phase before
checking types/builds. No shared client is regenerated during implementation.

Later consolidated QA must cover all role/direct-API/device/foreign-household
boundaries, missing family, demotion/token revocation/deletion races, two-device
save/Undo conflicts, defaults inheritance, existing personal overrides, corrupt
and future-version records, response loss, offline/cache/read failures, blocked
storage, EN/ES and keyboard/Back/responsive states. This document does not claim
those checks have run.


## Device clock presentation — #142, 2026-10-26, source only

Settings → Language includes Device default /12-hour /24-hour with typed EN/ES
copy, a deterministic UTC example and visit-only feedback when browser storage
cannot retain the choice. Like the existing device language/theme, this is
local presentation, stored under `herewoven:clock-format:v1`; Auto removes that
key. It is not an account-synced preference or a new field in strict version1
account/default records. No API/schema/migration or native capability changes.

The shell starts Auto during SSR/hydration, then reads validated device storage
when its existing persistence option is enabled. Other-tab storage/clear changes
update the mounted shell, with listener cleanup. Unsupported values become Auto;
a blocked save still applies for the visit and is not described as remembered.
`useDisplayLocale` adds the selected h12/h23 Unicode hour-cycle setting to the
existing app-language/device-region locale. Existing Intl consumers of that hook
inherit it; explicit hour12/hourCycle options remain authoritative. Older Intl
implementations that lack the Locale option keep the usable device format.

Stored UTC instants, date-only records, time zones, recurrence, input parsing,
account display revisions and explicit fridge clock settings are unchanged.
Direct formatters that do not use this hook still need the broader #142 pass;
this is not complete all-screen/native clock coverage. No QA/tests/checks/build/
browser/DB/CI/push/merge/deploy ran. Later checks must cover Auto/reset, noon/
midnight, EN/ES/region changes, hydration, blocked/invalid storage, other-tab
changes, unmount cleanup, explicit format overrides and representative devices.
