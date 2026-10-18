# Parent device management localization

Issue #445. Local implementation, 2026-10-18; consolidated QA remains deferred.

`src/i18n/device-management.ts` owns typed EN/ES vocabulary for DevicesManager,
PairTabletDialog and the missing-household server presentation. Successful,
failed, late and pending feedback is kept as semantic keys plus literal values,
so changing language renders the current state without replaying an operation.

The pairing suggestion is initialized in the current language only when a new
pairing opens. Replacements and persisted/edited labels stay literal. No locale
or translation function is added to a canonical fetch/poll/countdown/reset effect.
Codes, digits, IDs, origins, versions, labels, actor names and unknown future
values remain data. Native reason values, remove-old selection and callback,
expiry, retry/backoff, cancellation and replacement contracts are retained.
The shared wait helper takes optional scoped copy; default English output and
other device callers retain their original policy. Date helpers keep explicit
viewer locale; numeric copy uses localized formatting without modifying digits
or credentials.

The device audit reason mapping now uses own-property lookup. An unknown or
prototype-shaped reason gets neutral audit wording; an unknown persisted reason
on a device row stays a literal value. Unknown event types stay neutral. This
repairs the issue's documented inherited lookup behavior without expanding the
audit schema or private fields.

Only the three migrated parent UI files were removed from the existing
untranslated-copy inventory. Other debt, startup guards, API/session/elevation
boundaries and paired-device copy callers remain unchanged.

Later consolidated QA must exercise mounted language changes in each step,
native reason controls, disclosure/modal/focus state, delayed responses, request
counts, polling/countdown lifetimes, replacement recovery, long text, raw values,
unknown/prototype reason keys, current and default-English helper output,
ordinary/expanded EN/ES and permitted/denied server states. No such tests,
browser/build, hosted checks, migration, pairing, credential or production
mutation was run for this code-only checkpoint.
