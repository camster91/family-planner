# Sick days sheets

The Sick days page uses the shared `Dialog` form variant for its three write
sheets: starting a sick day, logging a temperature, and adding a medication.
Each sheet keeps its in-memory draft while dismissed, places actions in the
fixed footer, and blocks close, Escape, Cancel, and duplicate submits while a
save is pending. Clinical values remain user-entered. A dose log is guarded per
medication while its existing PATCH is in flight.

The page treats the three reads independently. A sick-day read failure keeps
the page in an explicit retry state. Member or medication read failures remain
visible as retryable dependency errors; when the medication read fails, the
medication records already embedded in the sick-day response remain visible.
Malformed successful payloads use the same truthful failure paths, and a
sequence guard prevents an older retry from replacing a newer read. No
automatic clinical retry or schedule inference is added.
The canonical `SickDay.temperature_log` field remains nullable JSON; a null
log is accepted as an empty display while malformed JSON is rejected.

The new recovery, form, pending, severity, and schedule placeholder copy is
present in both the English and Spanish `sickDays` message blocks in
`src/i18n/index.tsx`; no data migration, provider, or schema change is part
of this slice.

Role boundaries stay server-authoritative: parents manage temperatures,
medication records, and recovery; teens and children see and dose only their
own records and may report only themselves. The existing API isolation tests
remain the contract evidence for those boundaries. Until `/api/auth/me`
returns a valid role and id, the page remains read-only and shows a retryable
localized authority error when that request fails.

Focused checks:

```bash
npx jest src/app/dashboard/sick-days/__tests__/sick-days-detail.test.tsx src/app/dashboard/sick-days/__tests__/sick-days-errors.test.tsx --runInBand
npm run typecheck
npx eslint src/app/dashboard/sick-days/page.tsx src/app/dashboard/sick-days/__tests__/sick-days-detail.test.tsx src/app/dashboard/sick-days/__tests__/sick-days-errors.test.tsx src/i18n/index.tsx
```

Rendered phone and authenticated household acceptance remain separate gates.
