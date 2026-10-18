# Browser test consolidation

This cleanup reduces repeated transport and form-mutation journeys while
keeping responsive product coverage and the release gates intact. It does not
remove a role, household-isolation, idempotency, malformed-response, draft,
accessibility, focus, or persistence assertion.

The six Playwright projects remain configured and continue to run the complete
overview and empty-state journeys. The child home journey also remains at all
six sizes. Only the browser repetition described below is limited to
representative sizes:

| Spec and journey                                                                                    | Before | Active after | Representative projects                                                  | Retained equivalent                                                                                                             |
| --------------------------------------------------------------------------------------------------- | -----: | -----------: | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `rewards-recovery.spec.ts`: empty surface plus malformed claim, dropped claim, and approval retries |     48 |           18 | Empty: all six. Recovery: `phone-390x844`                                | Rewards board/create mounted recovery tests, reward API idempotency tests, and PostgreSQL receipt/authority tests               |
| `budget-recovery.spec.ts`: synthetic transport and draft recovery                                   |     12 |            4 | `phone-390x844`, `desktop-1366x768`                                      | Full six-size `budget-overview-states.spec.ts`, BudgetDashboard/TransactionForm tests, and budget transaction integration tests |
| `reward-create-sheet.spec.ts`: direct and sheet refusal, pending retry, and persisted cleanup       |     12 |            4 | `phone-390x844`, `desktop-1366x768`                                      | Reward create mounted tests, full six-size Rewards overview, and reward API/receipt tests                                       |
| `kid-home-localization.spec.ts`: child home plus parent routine rows                                |     24 |           16 | Child: all six. Parent routine rows: `phone-390x844`, `desktop-1366x768` | KidHome/KidRoutines mounted tests and the six-size child journey                                                                |

These four files therefore change from 96 declared project cases to 42 active
journey cases; 54 cases become intentional viewport skips. Both `en` and `es`
remain covered for every active case, with the existing light/dark mapping.
The performance-only `initial-js-budget.spec.ts` selection is separately
reduced from 36 declared route/viewport cases to 12 active cases: all six
routes still run in `phone-390x844` and `desktop-1366x768`, while the four
other viewport projects are intentional skips. The full E2E workflow, six
viewport projects, one-worker fixture isolation, visual jobs, budget
thresholds and measurement logic, aggregate result, and all other specs are
unchanged. This is a test-selection change only; it is not a test-failure or
timeout waiver.

The representative choices preserve the smallest phone for touch, wrapping,
focus, and narrow-layout behavior and the support desktop for wide-layout and
keyboard behavior. The all-size overview/empty/child journeys remain the
responsive regression net. If a future UI change affects the recovery form or
transport contract, expand its scoped project selection in the same change
and record the corresponding rendered evidence before updating this map.

## Additional transport consolidation — 2026-10-18

Cameron requested further test reduction. Dates (`anniversaries-recovery.spec.ts`)
and Babysitter Handoff (`handoff-recovery.spec.ts`) now run their EN/light and
ES/dark recovery journeys on the smallest phone and keyboard desktop only.
Each file changes from 12 active viewport cases to 4: together, 24 → 8,
removing 16 repeated browser executions (67% of these two suites).

All recovery assertions, source/runtime guards, fixture cleanup, privacy checks,
and Axe checks remain unchanged. Dates overview and deletion, and Handoff
deletion still cover all six configured sizes. Mounted recovery, role/isolation,
and API tests remain intact. Together with the earlier audited group, this
removes 94 of 156 audited repeated executions (60%); it does not claim that
60% of the repository's entire test suite was deleted.

Verification: Playwright collection passes (27 declared cases including setup;
8 recovery cases are selected at execution). All 68 focused mounted/copy/privacy
checks across six suites pass, as do scoped lint, formatting and diff checks.
Hosted execution remains a release gate.
No application code, required CI job, retries, timeout, or pass criterion changes.
