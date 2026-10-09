# Core initial JavaScript budgets

Issue #413, parent #137. The existing limits in [SLO_AND_PERFORMANCE.md](../engineering/SLO_AND_PERFORMANCE.md) are unchanged: Today 250,000 gzip bytes; calendar, chores, lists, meals and settings 300,000 each.

`e2e/initial-js-budget.spec.ts` opens each authenticated route in a fresh Playwright context with fabricated parent fixtures. It records script responses from navigation through hydration, proves a React-controlled user-menu interaction works, then waits for network idle. This includes chunks requested by the initial serialized React payload and automatic prefetch; it does not estimate first load from the union of every client-reference manifest entry or parse household text for chunk names. It runs in every configured viewport in the existing CI journeys job, against the production build. A missing, failed, empty, inconsistent or unexpected script response fails the check.

`scripts/initial-js-budget.ts` deduplicates identical assets by public path and gzip-compresses decoded response bodies using Node's default gzip level. Results therefore do not depend on the server's HTTP transfer encoding. The attached `initial-js-budget` JSON contains only the route, fixed limit, public asset paths and sizes. No cookies, household content or query parameters are included. Modern Chromium skips `nomodule` scripts itself; the attachment records those DOM paths separately. Any legacy script actually requested is counted. These measurements do not assert legacy-browser, physical-device, slow-network, capacity or production SLO acceptance.

Use the fixture/database prerequisites and environment in [E2E.md](E2E.md), then run:

```bash
npx playwright test e2e/initial-js-budget.spec.ts
npm test -- --runInBand src/lib/__tests__/initial-js-budget.test.ts src/components/providers/__tests__/posthog-provider.test.tsx
```

## Observed local production-build comparison

2026-10-08, fabricated parent household, cold modern Chromium contexts. Baseline build `d278267` (2026-10-08T23:04:46.244Z) failed all six budgets on the phone. Candidate build `cb12393` (2026-10-08T23:45:06.412Z) passed all **36 route/viewport combinations**. These are actual build identities, not a claim that later documentation/test commits were locally rebuilt. Final PR-head hosted results remain a separate gate.

| Route    | Baseline gzip bytes | Candidate maximum across six viewports |  Budget |
| -------- | ------------------: | -------------------------------------: | ------: |
| Today    |             352,683 |                                249,900 | 250,000 |
| Calendar |             324,756 |                                221,973 | 300,000 |
| Chores   |             333,636 |                                230,853 | 300,000 |
| Lists    |             308,686 |                                205,903 | 300,000 |
| Meals    |             343,944 |                                241,161 | 300,000 |
| Settings |             318,756 |                                219,797 | 300,000 |

Today has only 100 bytes of headroom; future changes must keep passing the gate. Its three largest files were `3794-83acfce05009cf38.js` (65,797 gzip bytes), `4bd1b696-8a4ab4fdf0ae305a.js` (63,375), and `8401-626586a7c3eb8db8.js` (15,650), all under `/_next/static/chunks/`. The attachment retains the complete public file breakdown. Initial automatic prefetch downloads are conservatively included; later user navigation is never performed during measurement.

The existing notification browser cases passed at their original phone/desktop projects (6 cases); the new forced module-download failure/retry check passed on phone, portrait and fridge (3 cases), preserving dialog focus, Escape dismissal, 44px retry targets and scoped accessibility checks. Configured skips retain their existing project rationale. No household or production acceptance is inferred.

The root analytics component loads `posthog-js` only when the existing public analytics key is configured. It keeps the original key, custom/default host and initialization options. Application children remain mounted while the SDK loads or fails. There are no current consumers of PostHog's React context in this app; a future context consumer must explicitly integrate without replacing/remounting the application subtree. This change does not enable analytics or add events.

The child's existing notification dialog also loads its controls only when opened. Its original loading and API-error/retry presentation is shared with the chunk loader. A failed module download stays inside the dialog and can be retried; closing the dialog ignores a late resolution. Menu role restrictions, Escape/focus behavior, preference APIs, idempotency, quiet hours and morning-summary policy remain unchanged. This does not change any saved preference or scheduler.

If a route exceeds its budget, inspect the attachment's largest files and reduce the actual initial dependencies. Keep the thresholds and fail-closed assertions. Rollback is reverting this scoped change; no API, schema, household-data, provider or production configuration migration is required. Wider #137 timing, fleet, network and reliability evidence remains separate.

## Hosted failure and targeted follow-up — 2026-10-09

Original #414 head `3f5f731` passed hosted Build/Test and the checked image, but E2E run `37861641705` failed all six Today viewport budget cases: **250,123 gzip bytes against 250,000**, with **842 other journeys passing** and 685 configured skips. The thresholds and capture rules remain unchanged. This is an actual bundle-budget failure, not a workflow timeout; the job ran 30 minutes within its existing 40-minute limit.

The follow-up removes the child's account-deletion controls from the shared navigation's eager startup dependency. The existing role-gated menu action loads the same dialog on demand. Its original loading and account-details retry presentation is shared with the module loader; a failed download supports retry and Escape dismissal, ignores late resolution after close, and cannot perform deletion. The caller explicitly returns focus to the menu button. Settings keeps its original direct dialog import. Password/typed-confirmation gates, export, household restrictions, mutation APIs and idempotency remain unchanged. Three existing copy records move to the shared presentation; one additional fallback title occurrence is explicitly tracked (1,737 total). This is not a copy translation or waiver.

New unit coverage checks closed/no-download, failure/retry and dismissal/late resolution. The new browser case aborts the cold account-controls chunk, checks the recoverable dialog and 44px retry/accessibility, loads the original controls on retry, confirms deletion remains disabled without confirmation, dismisses with Escape/focus restoration, and asserts no DELETE request. Original account-deletion journeys remain intact. Follow-up local measurements and exact-head hosted outcomes must be recorded separately before merge.

Actual follow-up ordinary build `ca9e326`, built2026-10-09T00:28:51.917Z, passes all36 core browser budgets. Maximum gzip bytes: Today247,059 (2,941 headroom), calendar219,132, chores228,012, lists203,062, meals237,513 and settings221,482. Full public asset breakdown is retained in the Playwright JSON attachments. The combined local run passes54 cases with30 configured skips:36 budgets,6 original isolated account-deletion journeys,9 notification cases and3 account-controls failure/retry cases. Full359 unit suites/4,384 cases pass;188 existing opt-in cases skipped. Prisma/types/full plus final scoped lint/format/build/inventory/exported-tree and new-history secret checks pass. Later documentation commits do not claim a new local build; final exact-head hosted gates remain required.

Review found an account-dialog lifetime regression in the first budget follow-up: unmounting loaded controls on close could discard an uncertain deletion’s retry key. The new real-dialog regression failed with two keys after close/reopen; keeping the loaded controls mounted while closed passes with one key and the original401-as-already-deleted behavior. Closed unused controls still do not download; late unloaded-dialog resolution is ignored. The browser recovery case additionally closes/reopens the real controls, verifies blank confirmation and disabled deletion, and returns focus with Escape without a DELETE request.

Actual reviewed ordinary build5d6bfe0, built2026-10-09T00:39:57.223Z, passes54 browser cases (30 configured skips) and all36 core budgets: Today247,074 (2,926 headroom), calendar219,147, chores228,027, lists203,077, meals maximum238,335, settings221,497 gzip bytes.19 affected cases and full359 suites/4,385 cases pass;188 original opt-in cases skipped. Prisma/types/full lint/format/build/inventory/tree/history secrets pass. The reviewed correction supersedes3536; exact final-head hosted checks/normal protected merge remain a separate required gate. Numeric limits, original tests, idempotency and API contracts are unchanged.
