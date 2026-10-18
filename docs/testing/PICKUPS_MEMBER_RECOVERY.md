# Pickups member controls and recovery

Progresses #499/#128 using the approved herewoven shared rows and short confirmation sheets. Canonical Pickup/User APIs and D9 role policy are unchanged: signed-in family members read/create/complete; parents delete; paired tablets are refused.

Parents receive a labelled delete control and confirmation. Rows are removed only after an HTTP success with the canonical `{ ok: true }` receipt; pending deletion blocks duplicate submission/dismissal. Failure retains the row and confirmation. A read-only refresh action closes only after a valid list response, with no optimistic deletion or queued destructive write.

Member-list loading now has an explicit error/retry state, preserves the pickup draft, and prevents saving while members are unavailable. Pickup and member failures are processed independently, including simultaneous failures. A malformed pickup list cannot become a false empty state. Copy is typed in English and Spanish; household text remains verbatim.

## Observed local checks

- Full TypeScript check: pass.
- Scoped ESLint, Prettier and `git diff --check`: pass.
- Three affected UI/API suites:29 cases pass. Existing child/teen parameter cases also verify successful creation; case count is not multiplied.
- Browser collection:21 cases including3 setup and5 declared viewport scopes. Existing six-size EN/ES parent matrix is retained. Delete recovery is added inside its existing smallest-phone/desktop cases; one desktop/EN smoke renders both child and teen create/complete without parent-only delete controls.
- Independent source review found and verified repairs for simultaneous request failures and failed refresh dismissal. Final review is clear.

## Still required

A fresh compiled runtime, rendered browser execution/capture inspection, original hosted checks and normal PR review remain required. Local disk is constrained; collection and unit results do not claim rendered acceptance. No production, database/schema, scheduler, provider or native-release change is included. Rollback is a UI/test/copy revert; canonical API/data contracts are unchanged.
