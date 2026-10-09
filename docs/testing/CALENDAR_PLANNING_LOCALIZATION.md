# Calendar planning, import and sync localization (#424)

The existing planner, import dialog/page and shared sync presentation now use typed EN/ES dictionaries. Owned computed/accessibility labels, validation, confidence, source badges, undo and relative ages localize through the existing scoped translation layer. Household/provider text, timezone IDs, ISO instants and raw server errors remain verbatim. No API, schema, provider, authorization, polling or native contract changes.

## State and compatibility evidence

Mounted component checks preserve date/view/source selection, selected dialog/focus, loadedAt, pending reads, reviewed drafts, original commit idempotency key and undo token across locale changes without extra requests. Shared relative-time/sync helpers retain compatible English defaults and existing invalid/future/minute/hour/day thresholds. Draft-helper errors alone map to owned validation keys; raw provider messages do not. Parent edit permissions, bounded paging, partial/error recovery, DST fallback, continuing/late events and timestamp preservation retain their existing behavior.

Regression-first untranslated tests fail before implementation. The final full unit run passes 369 suites/4490 cases, with 38 suites/188 existing opt-in skips. Prisma, types, lint, repository formatting, ordinary build and unchanged tree/history secret checks pass. Copy inventory drops 1678 to1590 occurrences only in four owned components; unrelated records and guard policy are unchanged. Source review caught the implicit shared-dialog English close label and an edit label; meaningful failing checks preceded their fixes.

## Actual browser and screenshot evidence

Actual compiled app source is6d892bbbda04642f31a89a22dcd626783d4036dc, built2026-10-09T04:44:33.412Z. Final ordinary30 and artificial expanded-copy30 planner/import checks pass across phone390×844, portrait800×1280 and fridge1280×800. Private expanded pages assert the actual mode marker. Existing affected planner/timestamp/form/budget checks pass75 cases with3 configured edge skips. All36 unchanged JS budgets pass across all six viewports. These totals describe separate runs and may overlap; they are not one aggregated unique test count.

The import suggestions are fabricated fixtures. Actual commit, lost-response retry, idempotency replay, signed undo and exact GET absence checks use isolated PostgreSQL. Runtime uses an invalid fixture provider key and daily provider budget zero. No real provider, production data or external communication is exercised. Without the explicit local import-fixture flag the browser spec verifies the default-off import gate, preserving ordinary hosted coverage without paid-provider dependence.

Each capture retains actual runtime/build identity. 306 new final images (102 ordinary planning,102 existing regressions,102 expanded planning) extend the local gallery to1309. All1003 original records/pixels are unchanged; unique paths, PNG dimensions/SHA, archived manifest and ZIP CRC pass. Dialogs use viewport images; other pages use full-page images. Inspected ordinary/expanded Spanish phone review and planner states preserve private fields and reachable controls. Full-page fixed navigation can appear within the stitched image. This is representative browser QA, not every interaction, human translation, full-app language, native device, provider or release acceptance.

## Preserved failures and reproducibility

Initial24 browser attempts fail401 before app rendering because reused auth was stale. Existing real auth setup then passes3 cases. Reviewed run passes18/fails6 because the test's global alert locator matches both the route announcer and import alert; scoping to the owned dialog fixes the harness without app changes. A draft cleanup URL was corrected before successful authenticated mutation to actual GET /api/events?id= and DELETE /api/events with eventId. Later capture coverage adds continuing/late states. Original logs/results and harness backups remain in the task's424-* evidence files.

A stale guessed server PID failed to stop the ordinary server; the attempted expanded start failed EADDRINUSE. Both records are preserved. Fresh process inspection identified the owned wrapper, which was stopped before the same compiled app restarted in expanded mode. Runtime identities match exactly. Both owned app and PostgreSQL services are now stopped and ports verified empty.

```sh
npx jest --runInBand --runTestsByPath src/app/dashboard/calendar/__tests__/planning-localization.test.tsx src/i18n/__tests__/calendar-planning-keys.test.tsx
npx playwright test e2e/calendar-planning-localization.spec.ts --project=phone-390x844 --project=tablet-portrait-800x1280 --project=fridge-landscape-1280x800
npx playwright test e2e/initial-js-budget.spec.ts --no-deps
```

Use the existing guarded Node22 fixture environment and GNU date shim for full units. Local import/expanded runs require the documented fixture server flags and isolated fake household; hosted default-off coverage does not enable them. Accepted #423 main857b50c3749d2683d03881cc5105fe123494f231 is integrated normally after local services stop; app/build inputs remain byte-identical to the tested6d892bbb source. Exact publication-head checks and normal merge must be observed before closing original #424 criteria.

## Rollback and remaining scope

Revert these scoped dictionaries/wiring/tests/inventory changes to restore prior English presentation. No stored-data rewrite or migration. Original #142 remains open with1590 detectable occurrences and wider locale/date/units/RTL/native/store/human work. Original #134 and #377 remain open. Production/provider/native/store/scheduler/security and external acceptance retain their explicit owner gates.
