# Open Issue Triage

**Snapshot verified:** 2026-09-01
**Open issues:** 2
**Candidate:** PR #100, `codex/launch-readiness-gaps`

| Issue                                                           | Priority    | Current evidence                                                                                                                                                                                                                                                                                                                                                | Closure condition                                                                                                                                                                                                                                      |
| --------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #85 — Restore required release validation                       | P0          | `master` protection requires strict `Ashbi release gate`, `Build & Test`, and `Build APK`; exact PR head `9f37aa2` passed those checks, deployed from its workflow artifact in run `33518730116`, retained a database backup and prior container, and passed the live register-to-reward smoke. | Latest PR #100 head passes every required check, evidence summary identifies the exact commit, and the merged `master` head retains the same protection.                                                                                               |
| #84 — Consolidate Family Planner into a reliable family release | P0 umbrella | Source repositories are archived; consolidated imports cover ChoreChamps, Meal Planner, and Budget App; search, recovery, privacy, export/deletion, audit, notifications, and beta telemetry are implemented. Review passed the automated core loop and reports degraded only because transactional email is unconfigured.                           | #85 closes; approved real exports are reconciled or explicitly recorded as empty/unavailable; production email provider is verified; mobile QA and the five-household beta entry checklist are complete; exact candidate receives production approval. |

## Closed/superseded issue reconciliation

Earlier implementation issues #16, #34, #36, #37, #53-#60, and #96-#99 are
closed. Their regression coverage now belongs to the required release gate and
the product program rather than duplicate issues. A passing narrow unit test is
not enough to reopen or close the umbrella issues; the exact candidate must pass
the complete gate.

## Current external inputs

- Production transactional email still needs an approved provider credential
  and verified sender. CI log delivery is not production evidence.
- No approved ChoreChamps or Budget App database export is present locally. The
  retained Meal Planner SQLite source currently contains zero rows. Do not
  invent source data or claim a production migration occurred.
- Recruiting and contacting five design-partner households is an external action
  requiring separate operator approval. The runbook and privacy-safe scorecard
  can be prepared beforehand.

## Issue update rule

Update #85 with exact run URLs and commit identity only after all required checks
finish. Close neither issue before PR #100 is merged. A merge is not production
deployment; deployment remains a separate exact-artifact approval and release
record.
