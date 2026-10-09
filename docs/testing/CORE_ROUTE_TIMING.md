# Core API timing adoption (#417)

Seven existing exports reuse `withRouteTelemetry` with fixed public templates: GET `/api/chores`, GET `/api/events`, GET `/api/lists`, GET `/api/family/board-version`, POST `/api/auth/login`, GET `/api/device/today`, GET `/api/device/today/version`. Only imports/export wrapping change. Original handler bodies, unrelated write exports, authentication, rate limits, device gates, recurring top-up, payloads and cookies remain unchanged.

## Local evidence

Protected base `7e2f20d4fcf34987e0fb830104b55e7969a3a17d`; actual committed app build `bcb972a8a620dc9d8b065afc73e4292f514fd8da`, built `2026-10-09T01:33:02.639Z`. `/api/version` readback verifies that runtime. Later documentation changes do not create a new app-build claim.

- Regression-first: all 15 actual-handler tests fail on original unwrapped exports. Successful/refused handler statuses and bodies already match before the timing/header assertions fail.
- After wrapping: 61 actual-handler/primitive cases pass. Off/on comparisons preserve response bodies, cache/retry headers and login cookie options. Exact timing fields, absent fabricated sensitive data, zero-rate sampling and sanitized 5xx are checked.
- Full gate: 360 suites/4,400 cases pass; 38 suites/188 existing opt-in cases skipped. Prisma generation, types, full lint, repository format and production build pass.
- Exported committed tree and one new commit pass the existing secret scanner/config. Run the exported tree scan from its root so existing anchored fixture paths apply; no scanner rules or fixture/source contents were changed.
- Selected existing browser cases cover sign-in (wrong password, offline, loading, success), household/child isolation and shared-tablet pairing, elevation, revocation, offline-cache/reconnect, retry and axe at phone 390×844, portrait 800×1280 and fridge 1280×800. The first run has 59 passes and one failure at trace close caused by `ENOSPC`. After the completed checkout build cache was removed and free disk space checked, that exact failed fridge axe case passes. Preserve both results; no assertion/trace policy/retry setting changed.
- Default-off server logs contain no `http.request` line across original and recovered browser runs. Isolated opt-in runtime probes verify 12 lines: all seven refused route templates and successful login/four person reads. Exact fields, status, request ID, numeric duration and bounded source release match; fabricated URL/query/header/cookie/household values and credentials are absent. Only this isolated local server enabled the flag.
- Nine grocery-recovery screenshots retain their exact bcb972a source label; the 817-image review gallery preserves all previous 808 identities. Exact image paths, manifest and full ZIP CRC are verified. Route/HTTP status was not separately recorded for those nine captures.

## Commands and outputs

From this checkout using the existing isolated test environment (Node 22, loopback PostgreSQL, existing fixtures):

```bash
npx prisma generate
npm run typecheck
npm run lint
npm test -- --runInBand
npm run format:check
npm run build
npx jest --runInBand --runTestsByPath src/app/api/__tests__/core-route-timing.test.ts src/lib/__tests__/observability.test.ts
npx playwright test e2e/journeys.spec.ts e2e/device.spec.ts --project=phone-390x844 --project=tablet-portrait-800x1280 --project=fridge-landscape-1280x800 --grep 'signed out|collection APIs return|never renders Family B|Family B list id|parent-only APIs refuse|Shared tablet' --grep-invert '@visual'
npx playwright test e2e/device.spec.ts --project=fridge-landscape-1280x800 --grep 'axe: pair, removed, elevated banner and device list' --no-deps
```

The recovery command is justified by the recorded disk failure and changed free-space condition, rather than an unchanged application failure. Browser runs reuse the same committed production build; they do not rebuild or enable artificial expanded-copy mode. Raw evidence is retained in the current task workspace (`417-*.log`, runtime readback/probe JSON, browser reports and screenshot manifest).

## Limits and rollback

Timing remains off by default. The wrapper, accepted correlation-ID policy, sampling and 5xx policy remain unchanged. No production logging/sampling setting, retention/provider, scheduler, schema, native contract or household data changes. These checks establish local instrumentation and existing affected journeys, not production p95, availability, 30-day history, capacity, recovery readiness, physical Android or real-household acceptance. Parent #137 retains its wider original requirements. Exact-head hosted build/image/E2E/review and normal protected merge remain required before closure.

Rollback reverts seven wrapping/import additions and their tests/docs. No migration or data repair is necessary.

## Accepted-main integration

#416 merged normally as `5a325ce608afe17a6f2407e02ef859417899b83f` at `2026-10-09T01:43:02Z` after its original 863 hosted journeys and 28 visuals passed, with strict/admin/conversation gates verified. Its five original #415 criteria are checked/closed; only its owned local/remote branch was removed. Ordinary merge `7d8b3a2f2fb8edef0995d75442873434d8f0e355` includes that accepted main in this timing candidate.

The actual integrated production build reports commit 7d8b3a2 and builtAt `2026-10-09T01:45:14.460Z`. Prisma/types/lint/repository format and 363 suites/4,408 cases pass (188 existing opt-in skips). The selected 60 affected browser cases pass in one run across phone/portrait/fridge, with no disk failure. All 36 unchanged core budget cases pass across all six configured viewports. Default-off server logs remain silent. These integrated results supplement the preserved original bcb972a regression/runtime/privacy evidence above; older images retain their original source. Later documentation changes do not invent another local app build. Hosted checks on the integrated final source remain required before closure; replacing the earlier published head is justified by actual accepted-main source integration.
