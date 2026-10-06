# Calendar planning UI — local execution handoff

## Implemented scope

- Actual Day timed grid, Monday-based Week timed grid, and seven-day Agenda. Wide screens default to Week; phones default to Agenda after mount. Explicit `view=day|week|agenda` wins.
- Today / Previous / Next and `date=YYYY-MM-DD`; legacy numeric month/year URLs and exported `calendarMonthHref` are preserved. Legacy month links anchor to the first day, rather than retaining the old month-only agenda.
- Deterministic UTC SSR loading shell, then viewer-local calendar arithmetic and bounded API reads after mount. SSR no longer serializes the incomplete start-only month query.
- Fetches all cursor pages until complete or the explicit ten-page budget (up to 2,000 rows). Aborts stale requests, rejects repeated/missing cursors and bad envelopes, and presents a truncation warning with a Day action. Filtered empty partial results are explicitly qualified.
- All / In-app / generic Connected / individual subscription-ID filters. In-app requires both origin identifiers absent. Subscription listing discovers calendars with no events. No provider connection metadata request.
- Multi-day clipped segments, continuation labels and true stored instants in detail `<time datetime>` elements; timezone abbreviations distinguish detail times. No all-day inference, attendees, drag-rescheduling or local RRULE expansion.
- Real event detail for parents and teens; existing create/editor/delete routes retained. Parents may edit local/provider-origin rows; subscription-origin rows remain read-only. Child SSR is refused. Canonical shell/nav/device/API/auth/schema are untouched.
- Capture, import dialog, import Undo and canonical sync status primitives retained.

## Design references

Loaded `skill://figma/figma-design-to-code/SKILL.md` before Figma context. Read exact private file `hh0JHIvHtvWvsdAWfFOUdM`, Week `7:37`, phone Agenda `7:175`, with `resource:figma-design-to-code` and screenshots. Adapted reference into React 18, semantic markup, scoped CSS grid/flex and existing Herewoven tokens/Fraunces/Inter. No Figma writes, screenshot-as-UI assets, generated assets or external providers.

## Observed verification (not release approval)

Pinned executable: `C:/Users/camst/DesignStudio/tools/node-v22.23.3-win-x64/node.exe`.

- Own `npm ci --ignore-scripts --script-shell=bash` and Prisma generation succeeded. npm reported 42 audit findings (8 moderate, 34 high); no dependency changes made.
- `node node_modules/jest/bin/jest.js --runInBand src/app/dashboard/calendar/__tests__ src/lib/calendar-planning/__tests__`: **11 suites / 93 tests passed**, before subsequent narrow layout/status tests and final CSS fix.
- Later focused `planning.test.tsx`: **3 tests passed** (four overlapping target widths, continuing timed labels, bounded source/detail/status path).
- New view-helper RED/GREEN runs passed the initial **7 tests**, including fixed clock lanes. Fetch RED/GREEN: **4 tests passed**, including pages, repeat cursor, cap, abort/malformed response.
- Full `tsc --noEmit` and scoped ESLint passed after adding the E2E spec, before the final CSS/selector-only fixes and readiness condition.
- Actual local HTTP/render capture: Week 1280×800, phone Agenda 390×844, portrait Week 800×1280, dark phone Agenda: HTTP 200, no page errors, no document horizontal overflow.
- Actual interaction probe passed: clock geometry (2px delta, 60×121.56px target), long-title detail, parent editor link, Escape/focus restoration, source-filter empty, active filter retained across Next, network-error-not-empty, retry recovery, held real-request loading, actual teen create/view-only.
- Real New York Day requests: March 8, 2026 `[05:00Z, March 9 04:00Z)` = 23h; November 1, 2026 `[04:00Z, November 2 05:00Z)` = 25h.
- New `e2e/calendar-planning.spec.ts`: last meaningful run **3/5 passed**. Parent test failed only on duplicate text-selector strictness; corrected to the active copy. Light axe passed; dark axe found selected-view text using `--label-inverse` (3.49:1). Scoped fix now uses canonical `--on-accent`. **These final fixes are not re-verified**: user requested stopping resource-heavy work and parent stopped the preview for RAM pressure. Connection-refused runs after server shutdown are not product test results.

## Private local evidence handles

All under `C:/Users/camst/AppData/Local/hermes/cache/scratch/`:

- `calendar-ui-evidence.json`, `calendar-ui-interactions.json`.
- `calendar-ui-week.png`, `calendar-ui-phone-agenda.png`, `calendar-ui-portrait-week.png`, `calendar-ui-dark-agenda.png`.
- `calendar-ui-detail-long.png`, `calendar-ui-teen-detail.png`, `calendar-ui-empty.png`, `calendar-ui-loading.png`, `calendar-ui-error.png`.
- `calendar-ui-probe.cjs`, `calendar-ui-interactions.cjs` (real API, external network blocked; only abort/hold failures simulated, never fake JSON).
- `calendar-planning.playwright.cjs` and `calendar-planning-e2e-results/` for the persistent spec.

Captures use canonical **synthetic January 5–11, 2026 fixture data, not the current day**. Captures precede the final dark selected-text correction/status polish; do not call them final AA evidence.

## Preview safety and status

Preview **stopped at user/parent request**; do not claim an active URL. Preserved bootstrap `calendar-planning-server.cjs` uses the private parent wrapper `C:/Users/camst/DesignStudio/family-planner-rebrand-evidence/local-env.sh`; it refuses any DB except loopback hostname, port `55439`, database `family_planner_rebrand_dev`, and removes calendar/import/provider keys. It serves only loopback port `3217`.

The earlier ad hoc name guard refused before connection. Switched to the exact parent-verified target, not a broadened guard. Before restart, prior tracked process had exited and port was verified unused. Last inspected owned tree was bootstrap PID 45624 and Next child PID 42060, tracked as `proc_bdee08645421`; parent stopped that tree to free RAM. No rebrand or production process was touched.

## Review-blocker fixes (focused RED/GREEN)

- **Clock-change policy:** if any viewer-local day in the requested range is not 24 elapsed hours, render that exact Day/Week range as Agenda, with an explicit clock-change notice. Keep the requested view/date/navigation semantics and actual API bounds; do not invent a repeated-hour grid. Card times show zones throughout that range. The New York November 1 fold `05:30Z–06:15Z` now reads `1:30 AM EDT – 1:15 AM EST`, not an ordinary two-track grid block. Spring-forward ranges also fall back.
- **Late-target policy:** starts in the final half-hour (`23:30` onward) cannot fit a two-track minimum target. Put them in an explicitly labelled, dated **Late events** list outside the clock grid, using the existing Agenda target styles (minimum 56px height). Keep exact times and details; never shift a late start earlier or add an implicit track. Other grid cards remain bounded by lines 1–49, with overlap lanes unchanged. Unit cases cover 23:30–23:45, overlapping late events, 23:59 zero duration, and overlapping final in-grid cards.
- **Supported-range policy:** validate both complete visible bounds after conversion to UTC: finite instants, UTC years 1–9999, positive span at most 45 elapsed days. Unsupported ranges make no event request and show a specific unsupported-date state, not empty/error/retry; Today recovers. Previous/Next and view switches are disabled if their complete target range is unsupported, and the move handler checks again. Tests exercise local UTC+14/UTC−12 boundaries, including cases where an input-year-only check would wrongly accept or reject a range.
- Source identity, subscription discovery, parent/teen capabilities, provider editing, ICS read-only details, event instants, display-locale formatting, pagination/abort/truncation contracts and backend/schema are unchanged. CSS was read but not modified; the late list reuses existing Agenda rules. New strings remain English.

Observed narrow RED runs failed for the intended missing notice/fallback, late row `48 / 50`, and unsupported range/navigation. Subsequent GREEN runs passed. Final sequential verification using the pinned Node 22 executable and npm `--script-shell=bash`:

```text
npm test -- --runInBand src/app/dashboard/calendar/__tests__ src/lib/calendar-planning/__tests__
Test Suites: 13 passed, 13 total
Tests:       115 passed, 115 total
npm run typecheck
> tsc --noEmit
exit 0
```

Jest's existing `--forceExit` script prints its open-handle advisory. Windows/Jest timezone regressions set the real Node process timezone with `node:vm` and restore the original resolved zone; sandboxed `process.env` or shell-only `TZ` did not reliably change the runtime zone. Component tests mock the API and CSS: these are not real HTTP or rendered target-size evidence.

**Browser verification remains pending.** No preview, server, browser, remote action, full-repository test/build, commit or push was run for these fixes. Earlier captures are stale and do not verify these fixes or the final dark-theme change.

## Remaining checks / honest boundaries

When resources permit, parent should run one isolated preview and rerun the focused Jest command, typecheck, and five-case spec using the saved scratch runner. Verify dark contrast fix, parent editor form end-to-end, latest screenshots and final full release gates after integration. No live provider writes or hardware/device behavior is claimed. Actual subscribed/provider-origin permission semantics are covered with synthetic unit inputs; the local rendered dataset did not contain connected/subscription records. Cap/repeat-cursor behavior is unit-tested rather than seeded with thousands of records. New planner strings are English; date/time formatting uses the existing display-locale hook. No commit, push, merge, deploy, schema/API/nav/global-theme change occurred.

## October 6, 2026 — current-source focused re-verification

This section supersedes the earlier **browser pending** handoff for the production planner source. It does **not** declare the latest expanded browser spec or release gates complete.

Verified checkout: `8c65845d17800a97e1627969e887295b06bbff0b` (existing local merge), with the uncommitted planner source. This verification worker changed **only this document and `e2e/calendar-planning.spec.ts` in the repository**; no production source regression was found or fixed, and no commit/push/merge/deploy was made.

### Sequential source gates

From `C:/Users/camst/DesignStudio/family-planner-calendar`, using the pinned Node executable above:

```bash
node node_modules/jest/bin/jest.js --runInBand --forceExit src/app/dashboard/calendar/__tests__ src/lib/calendar-planning/__tests__
# 13 suites / 115 tests passed; last run 18.761 s, exit 0
node node_modules/typescript/bin/tsc --noEmit
# exit 0, no diagnostics
node node_modules/eslint/bin/eslint.js src/app/dashboard/calendar/CalendarPageClient.tsx src/app/dashboard/calendar/CalendarPlanner.tsx src/app/dashboard/calendar/page.tsx src/app/dashboard/calendar/__tests__ src/lib/calendar-planning e2e/calendar-planning.spec.ts
# exit 0, no diagnostics
```

These ran sequentially, not concurrently with the preview browser job. Typecheck and scoped lint were repeated after the final spec additions and passed. Jest retained the existing force-exit advisory. No full repository test/build/CI or release gate is claimed.

### Observed browser results against unchanged final production source

One guarded Next preview, one Playwright Chromium worker, loopback `http://127.0.0.1:3217`, real canonical fixture login forms and real fixture API. External browser requests blocked; preview bootstrap verified the exact disposable database and disabled provider/import keys. January captures are **synthetic January 5–11, 2026 fixtures, not the current day**; March/November edge events were explicitly synthetic local verification rows.

```bash
source C:/Users/camst/DesignStudio/family-planner-rebrand-evidence/local-env.sh
node C:/Users/camst/AppData/Local/hermes/cache/scratch/calendar-planning-server.cjs
# separate sequential foreground browser command:
CALENDAR_PLANNING_EDGE_FIXTURES=1 node node_modules/@playwright/test/cli.js test --config=C:/Users/camst/AppData/Local/hermes/cache/scratch/calendar-planning.playwright.cjs --reporter=list,json
```

- Original five-case spec: warm rerun **5/5 passed (31.2 s)**. Real parent sign-in, editor form title and Delete affordance; real teen view-only details/create affordance; phone Agenda default and explicit Week; focus restoration, source-filter empty and retained filter, real request failure/Retry; light and dark planner-region axe AA.
- Expanded eight-case spec at **16:13:24 UTC**: **8/8 passed, zero skipped (47.7 s)**, before subsequent additional Week-late/dark and parent screenshot assertions. **Production source did not change afterwards.**
- Real API-created/read-back fold event displayed `1:30 AM EDT – 1:15 AM EST`; spring event displayed `1:30 AM EST – 3:15 AM EDT`. Requested **Day and Week** both preserved their selection/range, displayed the clock-change Agenda notice, and had **no timed day grids**.
- Real late events at 23:30, overlapping 23:35 and zero-duration 23:59 appeared as three separate targets in the dated Tuesday, January 6 Late events list, outside the clock grid. Day grid had exactly **48 tracks / 1,536 px**, no implicit rows; both overlapping final in-grid fixtures were bounded to `47 / 49` with **60 px** target height. All measured targets met the assertions (grid >=44 px each dimension; late-list >=56 px height).
- UTC+14 and UTC−12 browser contexts: unsupported complete range sent **zero event requests**, disabled invalid navigation and showed Unsupported calendar date without Retry. Adjacent supported Day sent one real request, disabled invalid navigation/view destinations; Today recovered with a second real request and actual canonical fixture events.
- Production CSS/theme guards passed. Selected Agenda paints: light foreground `rgb(255, 253, 249)` / background `rgb(50, 44, 67)`; dark foreground `rgb(255, 253, 249)` / background `rgb(121, 99, 151)`; 44 px minimum control height. **Light and dark axe violations: zero.**
- Seven synthetic rows were created via the real local event API and verified by GET; completed edge runs deleted all seven and verified each GET returned **404**. Existing local fixture events were not edited/deleted. Local activity/usage audit records from those operations remain in the disposable database; no production or provider writes occurred.

### Failures, evidence retention and outstanding assertions

- Initial cold five-case run: 4/5, parent login URL readiness timed out at 5 s. Warm unchanged rerun passed all five. This is retained, not reported as a planner pass.
- First expanded run: 7/8; the added geometry test incorrectly counted canonical fixture cards along with its two edge fixtures. Corrected the test to identify its two fixtures while retaining geometry/target assertions for **all** cards. No production fix or weakened geometry assertion.
- After the all-eight pass, added **Week** late-grid 48-track/target checks, a dark Week-late axe check, and parent Week/editor screenshots. Their next run returned 4/8 because actual `/api/auth/login` returned **429** for later cases. These are auth-rate-limit failures, **not** evidence for or against those new assertions. Trace showed `Retry-After: 416`. The worker waited for the natural expiry; no limiter reset, auth bypass, fabricated API payload or disabled gate.
- Stopped the owned preview during that cooldown. Restart was refused by the live resource check (**92% RAM, 1.71 GiB available**; final check 92%, 1.74 GiB). Do not start a heavyweight preview until resources permit. **Latest expanded persistent spec is therefore not fully green:** rerun all eight cases with the opt-in fixture flag after integration; do not treat the earlier 8/8 as proof of the later added assertions.
- Final phone light/dark, fold Day and late Day screenshots from the all-eight pass were visually inspected: readable controls, coherent list reflow, clock notice and correct fold labels, distinct dated late targets. **Evidence handling mistake:** the next Playwright invocation cleared those successful screenshots/full report. The all-eight result survives actual terminal output and this explicitly labelled record, not a preserved complete report. Retained snapshots/report from the prior 7/8 run prove light/dark and boundary cases and show the actual late-list scene; they do **not** prove the full all-eight run. No baseline was adopted or updated.

Frozen private evidence: `C:/Users/camst/AppData/Local/hermes/cache/scratch/calendar-planning-final-verification/`:

- `manifest.json`: SHA-256 hashes of **21** verified source/test files, actual observed totals, cleanup and limitations.
- `calendar-planning-final-jest.txt`.
- `ad-hoc-verification.txt`: temporary `hermes-verify-*.py` run passed Python syntax and real evidence-generator execution, checked all 21 SHA-256 hashes against current files, transpiled the final expanded spec with zero syntax diagnostics, and discovered all eight Playwright tests. **Ad-hoc only, not browser behavior or suite green.** Temporary script removed after exit 0; allocated in Hermes scratch using `tempfile` to honor the workspace temporary-file policy.
- `calendar-planning-final-first-run/`: cold login timeout evidence.
- `calendar-planning-final-edge-first-run/output.txt` plus screenshots/traces: 7/8 run, inline light/dark computed paints and zero axe violations, cleanup 7/7, actual boundary requests. Phone images under `calendar-planning-actual-p-6ab73-light-and-dark-phone-states/phone-light.png` and `phone-dark.png`; late scene under `calendar-planning-real-edg-7f5f4-bounded-late-event-geometry/test-failed-1.png` is explicitly a failed **test-count assertion** capture, not a baseline.
- `calendar-planning-final-rate-limit-run/` and `calendar-planning-final-browser-output.txt`: latest 4/8 run and actual 429 traces.
- `calendar-planning.playwright.cjs`: persistent isolated runner copy, workers=1, retries=0.

Preview session `proc_52e3077212c2` was stopped; owned bootstrap PID **3128** and Next PID **41256** no longer existed at read-back, and loopback port 3217 returned connect error **10061** (no listener). No unrelated process was closed. Handoff is **stopped**, not a live preview URL.

Remaining release checks belong to parent after explicit-allowlist integration: latest eight-case browser rerun with preserved complete screenshots/report, independent source/visual review, regression CI/full build and required release gates. Connected-provider/ICS rendered data, thousands-row pagination stress, hardware/device behavior and real production reads remain unverified; new planner strings remain English.

## October 6, 2026 — remaining browser gap closed

The **latest expanded persistent spec** ran against the unchanged final planner source at **16:32:41 UTC** with the existing guarded fixture preview/runner: **8 passed, 0 failed, 0 skipped, 0 flaky; 67.077 seconds; exit 0**. This supersedes the outstanding Week-late/dark browser gap above, not the unrelated release gates.

```bash
CALENDAR_PLANNING_EDGE_FIXTURES=1 PLAYWRIGHT_JSON_OUTPUT_FILE=C:/Users/camst/AppData/Local/hermes/cache/scratch/calendar-planning-gap-report.json 'C:/Users/camst/DesignStudio/tools/node-v22.23.3-win-x64/node.exe' node_modules/@playwright/test/cli.js test --config=C:/Users/camst/AppData/Local/hermes/cache/scratch/calendar-planning.playwright.cjs --reporter=list,json
```

- All eight named cases passed: parent range/geometry/source/detail/editor; teen/phone defaults and explicit Week; real 23/25-hour DST requests; actual request failure/Retry recovery; light/dark phone axe; real late/DST fixtures including **new Week-late/dark assertions**; UTC+14 and UTC−12 full-range navigation/Today recovery.
- New Week-late checks actually exercised: **seven grids, each 48 tracks and 1,536 px**, both final overlap targets at least 44 px in both dimensions, three late targets outside the grid, and **zero dark planner-region axe AA violations**. Day measurements: final overlap cards `47 / 49`, **436.5 × 60 px**; late-list targets **944 × 96 px**, outside the clock grid. Canonical dentist Week card **121.5625 × 60 px**, clock delta **2 px**.
- Real computed selected Agenda paints: foreground `rgb(255, 253, 249)`, light background `rgb(50, 44, 67)` → **13.108:1**; dark background `rgb(121, 99, 151)` → **5.111:1**. Both themes had 44 px minimum control height and zero axe AA violations. Contrast ratios were calculated from actual browser-computed RGB values, not token names.
- Day and Week spring/fall fallback notices, zone labels `1:30 AM EST – 3:15 AM EDT` and `1:30 AM EDT – 1:15 AM EST`, requested selections and absence of timed grids all passed. Both unsupported UTC boundary cases issued zero event requests; valid adjacent Day issued one and Today issued a second real request.
- All seven synthetic edge events were created through the real local API, read back, then deleted; each deletion was verified by GET **404**. Existing canonical events were not edited/deleted. No provider or production writes.
- **14 screenshots and complete JSON/text reports are frozen**, outside Playwright's cleared output directory, under `C:/Users/camst/AppData/Local/hermes/cache/scratch/calendar-planning-gap-verification/`. `measurements-manifest.json` retains both timezone records, actual attachments, source SHA-256 hashes and screenshot hashes. `browser-results/` contains parent Week/editor, phone light/dark, late Day/final clock, late Week/final clock/dark, all four DST Day/Week scenes, and both unsupported-bound scenes. Dark Week-late, dark phone and fold Day images were visually inspected; no new planner visual defect found.
- Preview started only after checking available RAM (2,828,868 KiB free of 25,097,128 KiB) and stopped immediately after the successful browser run via owned session `proc_282a0f70ffd5`. Read-back confirmed **port 3217 connect error 10061**, no preview/Next process remaining. No unrelated process was closed.

No production/test source changes were needed, so no new bug-fix RED/GREEN cycle was necessary. This worker modified only this handoff document in the repository and created private evidence files. No commit, remote write, build/CI or release approval occurred. Previous focused Jest/typecheck/lint results remain separately recorded, not substituted for this browser run.
