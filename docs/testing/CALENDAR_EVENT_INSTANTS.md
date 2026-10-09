# Calendar event instant preservation (#419)

Manual calendar forms now reject normalized invalid civil dates and nonexistent local minutes. Metadata-only edits preserve the exact valid canonical start/end instants originally fetched for that event, including either fall-back occurrence and stored seconds/milliseconds. An edited local minute retains the existing runtime-local first-occurrence policy. The editor clears previous fields on ID changes and ignores obsolete fetch completion; save/delete require the currently loaded record. No new fold selector, timezone model, API/schema/provider/import policy or production/native data change.

## Regression and integrated source evidence

Original helper/form tests failed 23 cases before the repair. Added real record-navigation regressions then failed on stale fields and obsolete responses; those failures are retained. The affected nine-suite gate passes 130 cases; the strengthened actual mounted locale-switch component gate passes 16. Stable integrated source a616b8cf7600003a463f63987c433ab87d064e88 includes protected main 4ced2d14042321ecae39065bb4da635493c7f3a2 through an ordinary merge. Prisma generation, types, full lint, repository format, 365 suites/4,448 unit cases (38 suites/188 existing opt-in skips), production build, unchanged inventory and exported-tree/new-history secret checks pass. Public localDateTimeToISO and capture/handoff/import consumers are unchanged.

Actual app build a616b8cf7600003a463f63987c433ab87d064e88 reports builtAt 2026-10-09T02:31:24.105Z. Later changes are test/docs only; app-source byte identity is recorded. The initial server omitted runtime RELEASE_SHA and reported unknown; its readback and first browser failures remain preserved. The corrected server passes the exact build SHA at runtime and reports the same baked build time. This identifies an actual committed build; it does not claim a new build for later documentation.

## Browser evidence

The first new-spec run has 7 passes and 14 harness failures: mobile scrollIntoViewIfNeeded left an action under the fixed tab area, the error locator also matched Next route announcements, and fixed-clock resource timing returned zero entries. Corrected checks center-scroll before unchanged hit-center/44px assertions, scope the actual error to main, and await the actual delayed HTTP response body before verifying the current editor. The next run passes all 18 cases plus three setup checks in 49 seconds. Real Toronto browser contexts, EN/ES persisted language, API-created/read-back/deleted synthetic events cover first/second/cross fold, ordinary precision and year boundaries, gap rejection with zero POST, and late previous-record responses. Every created event is deleted and read back 404. Unit locale switching uses the real translation hook on the mounted form; unsupported storage-event behavior is not claimed.

Existing planner, date-boundary, error/Retry, teen, child and two-household browser checks pass 39 cases (including three setup checks), with three existing edge-project skips. All 36 unchanged core JavaScript budgets pass across six viewports. No tests, baseline, byte limit, retry or trace policy were relaxed. Logging remains off and local servers use only guarded fabricated households; external requests are blocked.

Screenshot inspection found full-page capture origins could place the fixed header midway across the image after reachability scrolling. The final capture-only test revision resets document scroll to zero before screenshots and retains the action/accessibility checks. Its actual rerun and gallery evidence are appended after completion; older failure/capture artifacts remain in the task workspace.

## Commands

```bash
npx prisma generate
npm run typecheck
npm run lint
npm run format:check
npm test -- --runInBand
npm run build
npx playwright test e2e/calendar-event-instants.spec.ts --project=phone-390x844 --project=tablet-portrait-800x1280 --project=fridge-landscape-1280x800
npx playwright test e2e/calendar-planning.spec.ts e2e/journeys.spec.ts --project=phone-390x844 --project=tablet-portrait-800x1280 --project=fridge-landscape-1280x800 --grep 'planning:|phone defaults|23- and 25-hour|failed real request|actual planning region|edge fixtures|unsupported range|calendar shows|collection APIs return|never renders Family B|parent-only APIs refuse|calendar.*child|capture API refuses' --grep-invert '@visual'
npx playwright test e2e/initial-js-budget.spec.ts --no-deps
```

Commands use the existing guarded loopback PostgreSQL/Node22 environment and fixed fixture date, reusing this committed production build. Full Jest uses the configured GNU date shim. Exported-tree gitleaks runs from that tree root with unchanged anchored fixture rules, and history scans start at accepted protected main. Original logs, reports, fixture cleanup attachments and exact build readbacks are retained as 419-* task evidence.

## Acceptance and rollback

Exact final-head hosted Build/Test, checked image, E2E and review/protection gates remain required before normal merge and original #419 closure. Parent #142 remains open for all wider externalization, locale/data paths, pseudolocale/RTL/units/human and native/store acceptance. This is local host evidence, not native, production, provider or real-household acceptance. Revert the scoped dates helper, editor/error-role wiring, tests and docs without migration or rewriting stored data.

## Final capture revision

Test-only head220577af5ed912488de35546c1af5f17a1ccba7f passes all21 checks (18 journeys plus3 setup,52.7s), preserving every timestamp/no-submit/stale-response/44px/hit-center/axe assertion. Its app src is byte-identical to actual a616b8c build. Final representative phone/editor and fridge/error images were visually inspected after resetting the capture origin: the header remains at the top and the existing error is legible. Gallery883 preserves all817 earlier entries plus48 final form and18 existing planner images. All new PNG hashes/dimensions, manifest paths, exact archived manifest and ZIPCRC pass; old source labels remain intact. Default-off server logs remain silent. The owned local server and guarded PostgreSQL were stopped, and port3161 has no listener.

## Verified protected completion — 2026-10-09

PR #420 exact47b1209140495a036d95ad46af6e82428b12dfcb passed original Build/Test37875709577, fresh checked-image validation and E2E37875709527 (881 journeys/718 configured skips;28 visuals/11 existing skips), GitGuardian/resolved threads and strict/admin/conversation protection. Normal mergeb53e5f109c8e438166a640176a80432d1e53ed21 completed03:16:29UTC. All five original #419 criteria are checked/closed preserving wording/history and coupled record-binding follow-up; only its exact owned branch was cleaned. Earlier pending paragraphs are historical. Publish/VPS skipped; parent142 wider requirements remain open. Cloud review connector reported account usage limit, so no cloud review success is claimed.
