# Handoff sheets and share recovery

The parent Handoff create/edit flow uses the shared form-dialog variant. Form
content scrolls independently while Save/Delete actions remain in the fixed
footer. The form remains mounted after a refused or failed save so the entered
draft stays available for correction or retry. Save, delete and share-link
regeneration use the existing mutation guard and cannot overlap.
Sitter name and arrival/departure stay visible in the short form; phone, care,
house and general notes stay in a localized optional-details disclosure and
retain their values when an existing handoff is edited.

The dashboard list treats a non-OK response or a malformed successful response
as a recoverable load error. Retry is explicit and never invents a list. The
public sitter link distinguishes a missing or expired token (`404`, shown as
invalid) from a transient `5xx`, offline or malformed response (shown with a
localized retry action). The public endpoint, expiry policy, bearer token,
role shaping and paired-device refusal are unchanged.

Share controls and transient public-link recovery copy are available in English
and Spanish. Household names, sitter details and notes remain verbatim data.
Displayed handoff times use the app/device display locale.

Scoped checks:

```sh
npx jest --runInBand --runTestsByPath \
  src/app/dashboard/handoff/__tests__/handoff-share.test.tsx \
  'src/app/handoff/[token]/__tests__/HandoffClient.test.tsx'
npx tsc --noEmit --incremental false
npx eslint \
  src/app/dashboard/handoff/page.tsx \
  'src/app/handoff/[token]/HandoffClient.tsx' \
  src/app/dashboard/handoff/__tests__/handoff-share.test.tsx \
  'src/app/handoff/[token]/__tests__/HandoffClient.test.tsx' \
  src/i18n/handoff-recovery.ts
```

Rendered phone/desktop capture and hosted release checks remain separate gates.
The paired `e2e/handoff-recovery.spec.ts` cases also cover malformed list and
public-share recovery, the short-form pending-save draft, and the synthetic
write-interception receipt across the existing English/Spanish representative
projects. Collection can be checked without starting a browser with:

```sh
npx playwright test e2e/handoff-recovery.spec.ts --list
```

Rendered QA at61045 found that the public page added a default nested I18nProvider over the root persisted-locale provider, resetting Spanish to English. Removing that redundant wrapper preserves print/token/privacy behavior and lets the public viewer keep their locale. The same existing ES browser case is the regression. The first harness's fieldset matcher was replaced with disabled assertions on actual controls; no behavior assertion or case was removed. Final repaired-source execution remains pending.
