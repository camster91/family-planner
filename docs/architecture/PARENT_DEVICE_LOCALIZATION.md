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

## Original requirement map and late-response continuation — 2026-10-20

Source reconciliation against original #445:

| Original requirement | Current source | Remaining acceptance |
| --- | --- | --- |
| Full typed management/pairing/missing-household/helpers/date/audit/wait copy | device-management.ts, DevicesManager/DevicesNoHousehold, PairTabletDialog and optional presentation helpers; own-property audit reason mapping retains neutral unknown audit text and literal unknown stored row reasons | Original EN/ES ordinary/expanded/helper/count/date/native and copy-inventory checks deferred |
| Mounted language preserves drafts, names/codes/reasons/private values and work | Semantic feedback keys and text ref; new-opening label initialization; no locale dependency in canonical effects/loaders/poll/countdown | Full mounted actual-route locale/draft/pending/late/focus/request/callback/clock proof deferred |
| Canonical household/session/parent/kill-switch and replacement policy | Server Devices page, existing APIs and single household/device/session model unchanged | Original role, device, two-household, queue/elevation/privacy/security/integration and real native proof deferred |
| Exact-source ordinary/expanded builds and guarded browser matrix | Existing original harness, fixture/refusal/normal/visual/release infrastructure retained, without changing galleries or old reports | Current source/tree/build identity, full tests/types/lint/copy/security, captures/Axe/native/role/provider isolation and hosted acceptance still required |
| Review, protected normal merge, merged-served acceptance and scoped closure | Existing release policy; no rollout/provider/credential or issue-closure change | Fresh exact-head review/hosted/protection/conversation/ancestry/served evidence; no historical proof reused |

A confirmed lifecycle defect was found during this source pass: pairing polling
checked cancellation after fetch but before streamed JSON, so a late body could
advance a dialog after expiry, closing or a new opening. Create/confirm/replacement
recovery also could apply an older opening's completion to a newer one.

The dialog now owns an attempt generation, invalidated on close/unmount/reopen/
replacement/new-code and deliberate denial. Poll and countdown effects stop when
closed. Polling rechecks after JSON and advances only the matching active step/
pairing ID through a functional state update, so an already queued expiry also
wins over a late response. Confirm does the same after response/error-body reads.
Create, confirm and replacement recovery have immediate operation guards; stale
finally handlers cannot clear a newer pending operation. Deliberate denial
supersedes local confirmation results while the server still serializes requests.
If a create response reveals its ID only after its dialog was abandoned, the
existing cancellation endpoint retires that exact abandoned code; a newly opened
code is not cancelled. No server/session/auth/role/credential protocol changes.

This is a bounded lifecycle correction separate from localization. Existing
poll interval, countdown interval, expiry/backoff values, request URLs/methods/
bodies, replacement decision and caller success callbacks remain. Locale does
not appear in lifecycle dependencies; no locale-triggered work was added.
Fresh-opening initialization also clears the old replacement-retry presentation.

`pair-dialog-lifecycle.test.tsx` is authored with fabricated mocked endpoints for
late claimed/paired bodies after expiry, close/reopen with no closed polling,
abandoned-create-only cancellation, immediate create/confirm guards and late
confirmation after expiry. No new case was run. Full EN/ES, native focus/reason,
replacement/deny/failure/timer/count/helper, role/privacy, actual route and physical
hardware/store/customer acceptance remain unproven. No tests, types, lint, build,
browser/native/schema/CI/provider/device/pairing operations, push, merge or deploy
were executed by this source pass; old gallery objects/archive bytes were not
edited or asserted freshly verified. Full implementation goal remains active.
