# Chore photo recovery

Scope: create/edit forms under #499/#128. Native upload alerts become localized
inline `role="alert"` errors associated with the photo action. Error copy follows
the current locale; household text, permissions, recurrence and API contracts
are unchanged. A refused, malformed or external-URL response leaves prior photos
and draft fields untouched. The file input is cleared to allow same-file retry.
A synchronous upload guard blocks premature form submission; Save, photo choice
and removal stay disabled while busy.

Two mounted regressions (create EN, edit ES) verify refusal, invalid receipt,
same-file retry, pending submission, previous-photo retention and the final
photo in the chore payload. Both failed before implementation at the missing
inline error; both pass after. All35 affected photo/profile/turn-taking checks
pass; full types, scoped ESLint and diff checks pass.

The existing weekly schedule browser cases extend synthetic photo recovery on
phone390 and desktop in EN/light and ES/dark. They retain the original weekday,
role, no-write, runtime/source, accessibility and capture assertions. Photo
requests are intercepted: no real upload or chore persistence is claimed by
these browser checks. There are still15 declared cases including setup.

Actual optimized build, rendered browser execution, independent screenshot
review and original hosted gates remain pending. Local disk headroom prevents
a fresh optimized build; no passing local build or release is claimed.

Commands:

```sh
npx jest --runInBand src/app/dashboard/chores/__tests__/photo-recovery.test.tsx src/app/dashboard/chores/__tests__/profile-target-form.test.tsx src/app/dashboard/chores/__tests__/take-turns-form.test.tsx
npx tsc --noEmit --incremental false
npx eslint src/app/dashboard/chores/create/CreateChoreForm.tsx src/app/dashboard/chores/edit/EditChoreForm.tsx src/app/dashboard/chores/__tests__/photo-recovery.test.tsx e2e/weekly-chore-schedule.spec.ts
npx playwright test e2e/weekly-chore-schedule.spec.ts --list --reporter=list
```
