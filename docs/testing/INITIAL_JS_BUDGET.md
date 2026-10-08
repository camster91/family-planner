# Core initial JavaScript budgets

Issue #413, parent #137. The existing limits in [SLO_AND_PERFORMANCE.md](../engineering/SLO_AND_PERFORMANCE.md) are unchanged: Today 250,000 gzip bytes; calendar, chores, lists, meals and settings 300,000 each.

`e2e/initial-js-budget.spec.ts` opens each authenticated route in a fresh Playwright context with fabricated parent fixtures. It records script responses from navigation through hydration, proves a React-controlled user-menu interaction works, then waits for network idle. This includes chunks requested by the initial serialized React payload and automatic prefetch; it does not estimate first load from the union of every client-reference manifest entry or parse household text for chunk names. It runs in every configured viewport in the existing CI journeys job, against the production build. A missing, failed, empty, inconsistent or unexpected script response fails the check.

`scripts/initial-js-budget.ts` deduplicates identical assets by public path and gzip-compresses decoded response bodies using Node's default gzip level. Results therefore do not depend on the server's HTTP transfer encoding. The attached `initial-js-budget` JSON contains only the route, fixed limit, public asset paths and sizes. No cookies, household content or query parameters are included. Modern Chromium skips `nomodule` scripts itself; the attachment records those DOM paths separately. Any legacy script actually requested is counted. These measurements do not assert legacy-browser, physical-device, slow-network, capacity or production SLO acceptance.

Use the fixture/database prerequisites and environment in [E2E.md](E2E.md), then run:

```bash
npx playwright test e2e/initial-js-budget.spec.ts
npm test -- --runInBand src/lib/__tests__/initial-js-budget.test.ts src/components/providers/__tests__/posthog-provider.test.tsx
```

The root analytics component loads `posthog-js` only when the existing public analytics key is configured. It keeps the original key, custom/default host and initialization options. Application children remain mounted while the SDK loads or fails. There are no current consumers of PostHog's React context in this app; a future context consumer must explicitly integrate without replacing/remounting the application subtree. This change does not enable analytics or add events.

The child's existing notification dialog also loads its controls only when opened. Its original loading and API-error/retry presentation is shared with the chunk loader. A failed module download stays inside the dialog and can be retried; closing the dialog ignores a late resolution. Menu role restrictions, Escape/focus behavior, preference APIs, idempotency, quiet hours and morning-summary policy remain unchanged. This does not change any saved preference or scheduler.

If a route exceeds its budget, inspect the attachment's largest files and reduce the actual initial dependencies. Keep the thresholds and fail-closed assertions. Rollback is reverting this scoped change; no API, schema, household-data, provider or production configuration migration is required. Wider #137 timing, fleet, network and reliability evidence remains separate.
